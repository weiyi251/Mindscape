// ============================================================================
// 模块说明（中文）
// 「移除卡片」命令（T2.7）。对应第七章 7.1「移除卡片（默认操作）」：
//   ① 从画布消失（视图层）
//   ② 硬盘移动：原路径 → `_已移除\原文件夹结构\原文件名`
//      （保留原文件夹结构天然避免同名冲突；目录不存在自动创建 —— moveFile 兜底）
//   ③ layout.json 的 removed 数组记录 { id, originalPath, movedTo }
//
// 【7.4 撤销含文件回滚】undo 时把文件从 `_已移除` **移回原位**、卡片原样放回画布，
// 完全还原 —— 不允许出现「画布上有图、硬盘上找不到」的状态。
//
// 【部分失败】7.4 原则：宁可「部分移除 + 明确告知」，也不要卡死不动。
// 单卡失败不影响其余；全部失败时抛错（命令不入栈）。
//
// 【级联断开连线】（2026-09-11 用户裁决）
//   卡片被移除后，指向它的连线就成了「悬空线」（from / to 目标已不在画布上）。
//   因此 do() 在成功移除卡片后，会把与这批卡片相连的**所有**连线一并删掉；
//   undo() 撤销「卡片移除」时把这些连线原样放回 —— 即移除操作整体可撤销。
//   注意：从「已移除」视图恢复卡片（restoreCards.ts）**不会**把连线带回来，
//   因为连线在移除那一刻就已从 layout 里真正删除并落盘。
//
// 【性能保护预告】T2.10 将对大批量（>50 张）加异步 + 进度；本版 ≤50 张同步执行。
//
// 实现任务：T2.7 / T2.9。
// ============================================================================

import type { Card, Connection, RemovedEntry } from '@/core/types'
import type { Command } from '../types'
import type { StorageProvider } from '@/core/storage/StorageProvider'
import { joinPath, relativePathOf } from '@/core/utils/paths'
import { runWithConcurrency } from '@/core/board/thumbnails'

/** 被移除文件在 `_已移除` 下的相对路径：保留原文件夹结构（7.1） */
export function removedPathFor(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  return `_已移除/${normalized}`
}

/**
 * 找出与这些卡片相连的所有连线（from 或 to 命中任意一张即算相连）。
 * 卡片被移除时必须级联断开，否则会留下指向已移除卡片的悬空连线。
 */
export function connectionsTouchingCardIds(
  cardIds: readonly string[],
  connections: readonly Connection[],
): Connection[] {
  const targets = new Set(cardIds)
  return connections.filter(
    (connection) => targets.has(connection.from) || targets.has(connection.to),
  )
}

/**
 * 三级性能保护（7.4）的批量阈值：
 *   ≤ 50 张 → 逐项同步执行（数量小，耗时可忽略）；
 *   > 50 张 → 并发执行（DEFAULT_THUMBNAIL_CONCURRENCY 路）+ onProgress 进度回调。
 * 单文件失败：无论哪一档都跳过并记录（不中断批次）。
 */
export const REMOVE_BATCH_ASYNC_LIMIT = 50

export interface RemoveCardsContext {
  spacePath: string
  provider: StorageProvider
  /** do 的应用：从画布移除这批卡片 + 把 entries 追加进 removed 记录 */
  applyRemove: (payload: { cards: Card[]; entries: RemovedEntry[] }) => void
  /** undo 的应用：卡片按原对象放回画布 + 按 id 移除 removed 记录 */
  applyRestore: (payload: { cards: Card[]; entryIds: string[] }) => void
  /** 读取当前连线快照（do 时调用；redo 也取最新，保证级联集合始终正确） */
  getConnections: () => readonly Connection[]
  /** 级联断开连线（boardStore.removeConnections） */
  applyRemoveConnections: (ids: string[]) => void
  /** undo 时把级联断开的连线原样放回（boardStore.addConnections） */
  applyAddConnections: (connections: Connection[]) => void
  /** 部分失败提示（中文，可直接展示）；全部失败时命令抛错、不入栈 */
  onNotice?: (message: string) => void
  /** 大批量（> REMOVE_BATCH_ASYNC_LIMIT）时的进度回调（已完成 / 总数） */
  onProgress?: (done: number, total: number) => void
}

/**
 * 创建「移除卡片」命令。do / undo 都是**视图 + 文件一起动**（7.4）。
 */
export function createRemoveCardsCommand(
  cards: readonly Card[],
  context: RemoveCardsContext,
): Command {
  let movedCards: Card[] = []
  let entries: RemovedEntry[] = []
  /** 本次级联断开的连线（undo 时原样放回）；do 每次重新计算 */
  let cascadedConnections: Connection[] = []
  /** 无文件的卡片（T3.4 文字便签，filePath 为空）：没有文件可移，undo 直接恢复卡片 */
  const virtualCards: Card[] = cards.filter((card) => card.filePath === '')

  /** 单张卡片的移动；成功返回记录，失败返回 null（原因写入 failed） */
  const moveOne = async (
    card: Card,
    failed: string[],
  ): Promise<RemovedEntry | null> => {
    const srcAbs = joinPath(context.spacePath, card.filePath)
    const destRel = removedPathFor(card.filePath)
    try {
      const actualAbs = await context.provider.moveFile(
        srcAbs,
        joinPath(context.spacePath, destRel),
      )
      // moveFile 重名时可能加 _1 后缀：movedTo 必须记**实际**落点
      return {
        id: card.id,
        originalPath: card.filePath,
        movedTo: relativePathOf(actualAbs, context.spacePath),
      }
    } catch (error) {
      failed.push(`${card.filePath}（${error instanceof Error ? error.message : String(error)}）`)
      return null
    }
  }

  return {
    type: 'remove',

    async do() {
      const failed: string[] = []
      const list = [...cards.filter((card) => card.filePath !== '')]

      // 三级性能保护：大批量走并发 + 进度（7.4），小批量逐项同步
      if (list.length > REMOVE_BATCH_ASYNC_LIMIT) {
        let done = 0
        const results = new Array<RemovedEntry | null>(list.length).fill(null)
        await runWithConcurrency(list, 6, async (card, index) => {
          results[index] = await moveOne(card, failed)
          done += 1
          context.onProgress?.(done, list.length)
        })
        entries = []
        movedCards = []
        results.forEach((entry, index) => {
          if (entry) {
            entries.push(entry)
            movedCards.push(list[index])
          }
        })
      } else {
        for (const card of list) {
          const entry = await moveOne(card, failed)
          if (entry) {
            movedCards.push(card)
            entries.push(entry)
          }
        }
      }

      if (movedCards.length === 0 && failed.length > 0) {
        throw new Error(`移除失败：${failed.join('；')}`)
      }
      if (failed.length > 0) {
        context.onNotice?.(`已移除 ${movedCards.length} 张，以下卡片移除失败：${failed.join('；')}`)
      }

      // 级联断开连线：与这次**真正移走**的卡片相连的连线一并删除（悬空线会指向不存在的卡片）
      cascadedConnections = connectionsTouchingCardIds(
        [...movedCards, ...virtualCards].map((card) => card.id),
        context.getConnections(),
      )
      if (cascadedConnections.length > 0) {
        context.applyRemoveConnections(cascadedConnections.map((connection) => connection.id))
      }

      // 便签等无文件卡片：只从画布移除，不产生 removed 记录（undo 直接放回）
      context.applyRemove({ cards: [...movedCards, ...virtualCards], entries })
    },

    async undo() {
      const restored: Card[] = [...virtualCards]
      const failed: string[] = []

      for (const entry of entries) {
        try {
          await context.provider.moveFile(
            joinPath(context.spacePath, entry.movedTo),
            joinPath(context.spacePath, entry.originalPath),
          )
          const card = movedCards.find((item) => item.id === entry.id)
          if (card) restored.push(card)
        } catch (error) {
          failed.push(
            `${entry.originalPath}（${error instanceof Error ? error.message : String(error)}）`,
          )
        }
      }

      if (restored.length === 0 && entries.length > 0) {
        throw new Error(`撤销移除失败：${failed.join('；')}`)
      }
      if (failed.length > 0) {
        context.onNotice?.(`部分卡片未能还原：${failed.join('；')}`)
      }

      context.applyRestore({ cards: restored, entryIds: entries.map((entry) => entry.id) })

      // 撤销「卡片移除」= 整体回滚：级联断开的连线一并放回（用户裁决 2026-09-11）
      if (cascadedConnections.length > 0) {
        context.applyAddConnections(cascadedConnections)
      }
    },
  }
}
