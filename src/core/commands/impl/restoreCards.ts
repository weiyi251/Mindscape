// ============================================================================
// 模块说明（中文）
// 「恢复卡片」命令（T2.8）。对应第七章 7.2「恢复」：
//   文件从 `_已移除\…` 移回 originalPath 对应位置 + 卡片回到画布 + removed 记录移除。
//
// 【7.4】undo 同样回滚文件：把文件再移回 `_已移除`、卡片退回已移除视图。
//
// 与 removeCards 的关系：restore = remove 的逆操作，但入口不同
// （remove 从画布发起、restore 从已移除视图发起），因此独立成命令。
//
// 【性能】文件移动走 provider.moveFiles **批量**接口：整批只有一次 IPC 往返，
//   单项失败不影响其余项（Rust 侧 move_files 返回成功 / 失败清单）。
//
// 【恢复后的卡片数据】已移除视图里的卡片 filePath 指向 `_已移除\…`，
//   恢复时必须把 filePath **和 originalPath 一起**改回原位置，并重新登记资源表
//   （cardAssets 的缩略图 / 原图绝对路径），否则：
//     · filePath 不改 → 放回画布的卡片会读到已失效的 `_已移除` 路径（图裂）；
//     · originalPath 不改 → 复制 / 粘贴按它取源路径，拼出 `_已移除\…` → 「不是文件」。
//
// 【记录匹配以 movedTo 为准】（2026-09-11 修复）
//   历史数据里 removed 记录可能出现重复 id（新建卡片的 id 种子漏算了 removed，
//   见 boardStore.loadSpace）。若按 id 匹配，恢复会命中**错误的旧记录**
//   （其文件早已回到原位），报「不是文件」而真正要恢复的条目永远轮不到。
//   灰卡的 filePath 就是 movedTo（磁盘上的真实落点，天然唯一），因此：
//   先按 movedTo 精确匹配，匹配不到才退回按 id 匹配。
//
// 实现任务：T2.8 / T2.9。
// ============================================================================

import type { Card, RemovedEntry } from '@/core/types'
import type { Command } from '../types'
import type { DirEntry, MovePair, StorageProvider } from '@/core/storage/StorageProvider'
import { joinPath } from '@/core/utils/paths'
import { REMOVE_BATCH_ASYNC_LIMIT } from './removeCards'
import { collectThumbnails } from '@/core/board/thumbnails'
import { registerCardAssets } from '@/core/board/cardAssets'

export interface RestoreCardsContext {
  spacePath: string
  provider: StorageProvider
  /** do 的应用：卡片放回画布 + removed 记录移除 */
  applyRestore: (payload: { cards: Card[]; entryIds: string[] }) => void
  /** undo 的应用：卡片从画布消失 + removed 记录追加 */
  applyRemove: (payload: { cards: Card[]; entries: RemovedEntry[] }) => void
  onNotice?: (message: string) => void
  /** 大批量（> REMOVE_BATCH_ASYNC_LIMIT）时的进度回调（已完成 / 总数） */
  onProgress?: (done: number, total: number) => void
}

/**
 * 创建「恢复卡片」命令。
 *
 * @param cards   已移除视图的卡片（filePath = movedTo，id = removed 记录 id）
 * @param entries 对应的 removed 记录（提供 originalPath 目的地）
 */
export function createRestoreCardsCommand(
  cards: readonly Card[],
  entries: readonly RemovedEntry[],
  context: RestoreCardsContext,
): Command {
  /** 路径分隔符归一（磁盘记录里可能是 `\`，卡片里是 `/`） */
  const normalize = (value: string): string => value.replace(/\\/g, '/')

  /**
   * 找灰卡对应的移除记录：**优先按 movedTo 匹配**（灰卡的 filePath 就是 movedTo），
   * 匹配不到才退回按 id。见文件顶部「记录匹配以 movedTo 为准」。
   */
  const entryFor = (card: Card): RemovedEntry | undefined =>
    entries.find((item) => normalize(item.movedTo) === normalize(card.filePath)) ??
    entries.find((item) => item.id === card.id)

  /**
   * 批量恢复：整批一次 provider.moveFiles 调用（单次 IPC）。
   * 找不到移除记录的项直接记失败；文件移动失败的项按 moveFiles 返回的失败清单记录。
   */
  const restoreBatch = async (
    list: readonly Card[],
  ): Promise<{ restored: Card[]; failed: string[] }> => {
    const failed: string[] = []
    const pairs: MovePair[] = []
    /** pairs[i] 对应的卡片与记录，用于把结果映射回卡片 */
    const pending: { card: Card; entry: RemovedEntry }[] = []

    for (const card of list) {
      const entry = entryFor(card)
      if (!entry) {
        failed.push(`${card.filePath}（找不到移除记录）`)
        continue
      }
      pairs.push({
        from: joinPath(context.spacePath, entry.movedTo),
        to: joinPath(context.spacePath, entry.originalPath),
      })
      pending.push({ card, entry })
    }

    if (pairs.length === 0) return { restored: [], failed }

    const result = await context.provider.moveFiles(pairs)

    // moveFiles 的 failed[].path 就是传入的 from（源绝对路径），据此映射回记录
    const failedFrom = new Set(result.failed.map((item) => item.path))
    for (const item of result.failed) {
      const hit = pending.find((one) => {
        const entry = one.entry
        return joinPath(context.spacePath, entry.movedTo) === item.path
      })
      const label = hit ? hit.entry.originalPath : item.path
      failed.push(`${label}（${item.reason}）`)
    }

    const restored = pending
      .filter((one) => !failedFrom.has(joinPath(context.spacePath, one.entry.movedTo)))
      // 恢复后 filePath 与 originalPath 都指回原位置
      // （filePath 原值是 `_已移除\…`；originalPath 是早期版本漏改留下的脏值）
      .map((one) => ({
        ...one.card,
        filePath: one.entry.originalPath,
        originalPath: one.entry.originalPath,
      }))

    // 大批量的进度：批量接口一次返回，这里补一次「完成」上报
    if (list.length > REMOVE_BATCH_ASYNC_LIMIT) {
      context.onProgress?.(restored.length, list.length)
    }

    return { restored, failed }
  }

  /** 重新登记资源表：恢复后的图片卡片按原路径取缩略图 / 原图（缩略图已存在则直接复用） */
  const reregisterAssets = async (restoredCards: readonly Card[]): Promise<void> => {
    const imageCards = restoredCards.filter((card) => card.type === 'image' && card.filePath !== '')
    if (imageCards.length === 0) return

    const fakeEntries: DirEntry[] = imageCards.map((card) => ({
      name: card.filePath,
      path: joinPath(context.spacePath, card.filePath),
      isDir: false,
      size: 0,
      modifiedAt: null,
    }))
    const thumbs = await collectThumbnails(fakeEntries, context.spacePath, context.provider)
    // ⚠️ 必须在 applyRestore（写 store）之前完成，渲染时才能读到正确路径
    registerCardAssets(imageCards, context.spacePath, thumbs)
  }

  return {
    type: 'restore',

    async do() {
      const { restored, failed } = await restoreBatch(cards)

      if (restored.length === 0 && failed.length > 0) {
        throw new Error(`恢复失败：${failed.join('；')}`)
      }
      if (failed.length > 0) {
        context.onNotice?.(`已恢复 ${restored.length} 张，以下恢复失败：${failed.join('；')}`)
      }

      await reregisterAssets(restored)

      context.applyRestore({
        cards: restored,
        entryIds: restored.map((card) => card.id),
      })
    },

    async undo() {
      const pairs: MovePair[] = []
      const pending: { card: Card; entry: RemovedEntry }[] = []

      for (const card of cards) {
        const entry = entryFor(card)
        if (!entry) continue
        pairs.push({
          from: joinPath(context.spacePath, entry.originalPath),
          to: joinPath(context.spacePath, entry.movedTo),
        })
        pending.push({ card, entry })
      }

      const moved: Card[] = []
      const movedEntries: RemovedEntry[] = []

      if (pairs.length > 0) {
        const result = await context.provider.moveFiles(pairs)
        const failedFrom = new Set(result.failed.map((item) => item.path))
        for (const one of pending) {
          if (!failedFrom.has(joinPath(context.spacePath, one.entry.originalPath))) {
            moved.push(one.card)
            movedEntries.push(one.entry)
          }
        }
      }

      if (moved.length === 0 && cards.length > 0) {
        throw new Error('撤销恢复失败：文件无法移回 _已移除')
      }

      context.applyRemove({ cards: moved, entries: movedEntries })
    },
  }
}
