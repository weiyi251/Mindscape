// ============================================================================
// 模块说明（中文）
// 「彻底删除」的编排层（2026-09-15 用户需求：添加彻底删除「已移除」中文件的功能）。
//
// 【7.3 的「永不提供永久删除」为何在此破例】画布右键的「移除」仍是可恢复的
// 移入 `_已移除`；本功能只在**已移除视图**里提供，且必须经原生确认框 ——
// 用户显式选择了「永久丢弃」，属于垃圾管理动线，与画布上的误触保护不冲突。
//
// 【不可撤销】与「插件现画的二进制文件」（Board 的 undoable:false 先例）同理：
// 文件已物理删除，redo 没有源文件可恢复，因此本操作**不走命令栈** ——
// 确认 → 逐个 deleteFile → 清 store（applyDeleteRemovedCards）→ 落盘。
//
// 【记录匹配以 movedTo 为准】（restoreCards.ts 的 2026-09-11 修复先例）：
// 历史数据里 removed 记录可能有重复 id，灰卡的 filePath 就是 movedTo
// （磁盘真实落点，天然唯一）—— 优先按 movedTo 匹配，匹配不到才退回按 id。
//
// 【部分失败】逐个删除，失败的项保留在 store（用户可重试或先恢复），
// 只清成功项；全部失败时 store 不动。
//
// 依赖全部以参数注入（不直接 import store / 确认框实现），可在 node 环境单测。
// ============================================================================

import type { Card, RemovedEntry } from '@/core/types'
import type { StorageProvider } from '@/core/storage/StorageProvider'
import { joinPath } from '@/core/utils/paths'

/** 用户可见文案常量表（集中一处便于校对） */
export const PERMANENT_DELETE_TEXT = {
  /** 原生确认框标题 */
  confirmTitle: '彻底删除',
  /** 原生确认框正文（带数量） */
  confirmMessage: (count: number) =>
    `将永久删除 ${count} 个文件（含硬盘上的原件），此操作无法撤销。确定继续吗？`,
  /** 部分失败（中文，可直接展示） */
  partialFailed: (failed: string[]) => `以下文件删除失败（已保留）：${failed.join('；')}`,
} as const

export interface PermanentDeleteDeps {
  spacePath: string
  provider: StorageProvider
  /** 已移除视图的灰卡（filePath = movedTo） */
  removedCards: readonly Card[]
  /** removed 记录（提供 movedTo 与 originalPath） */
  removedEntries: readonly RemovedEntry[]
  /** 原生确认框（Board 传 confirmDialog；测试注入桩） */
  confirm: (messageText: string, title: string) => Promise<boolean>
  /** 失败提示（Board 传 setActionError） */
  onError: (message: string) => void
  /** 清 store（Board 传 useBoardStore.getState().applyDeleteRemovedCards） */
  applyDelete: (payload: { cardIds: string[]; entryIds: string[] }) => void
  /** 请求落盘（Board 传 writer.schedule） */
  schedule: () => void
}

/** 一张灰卡配对的 removed 记录（找不到记录的项无法定位文件，跳过并报错） */
function pairFor(
  card: Card,
  entries: readonly RemovedEntry[],
): RemovedEntry | undefined {
  const normalize = (value: string): string => value.replace(/\\/g, '/')
  return (
    entries.find((item) => normalize(item.movedTo) === normalize(card.filePath)) ??
    entries.find((item) => item.id === card.id)
  )
}

/**
 * 彻底删除「已移除」中选中的文件（真删硬盘文件，不可撤销）。
 *
 * 流程：按 id 取灰卡与记录 → 无目标早退 → 原生确认框 → 逐个 deleteFile →
 * 只清成功项 → 落盘。返回是否全部成功（部分失败返回 false 且已清理成功项）。
 *
 * @param ids 已移除视图的卡片 id（选中集合或单卡 id）
 */
export async function runPermanentDelete(
  ids: readonly string[],
  deps: PermanentDeleteDeps,
): Promise<boolean> {
  if (ids.length === 0) return true

  // 找不到记录的项无法定位文件：不进入确认与删除流程，直接记为失败。
  // 全部缺失时不弹确认（没什么可删的），直接报错返回。
  const failed: string[] = []
  const pairs = deps.removedCards
    .filter((card) => ids.includes(card.id))
    .map((card) => ({ card, entry: pairFor(card, deps.removedEntries) }))
  const targets = pairs.filter((pair): pair is { card: Card; entry: RemovedEntry } => {
    if (pair.entry) return true
    failed.push(`${pair.card.filePath}（找不到移除记录）`)
    return false
  })
  if (targets.length === 0) {
    if (failed.length > 0) deps.onError(PERMANENT_DELETE_TEXT.partialFailed(failed))
    return false
  }

  const confirmed = await deps.confirm(
    PERMANENT_DELETE_TEXT.confirmMessage(targets.length),
    PERMANENT_DELETE_TEXT.confirmTitle,
  )
  if (!confirmed) return true

  const succeeded: { cardId: string; entryId: string }[] = []
  for (const { card, entry } of targets) {
    try {
      await deps.provider.deleteFile(joinPath(deps.spacePath, entry.movedTo))
      succeeded.push({ cardId: card.id, entryId: entry.id })
    } catch (error) {
      failed.push(
        `${entry.originalPath}（${error instanceof Error ? error.message : String(error)}）`,
      )
    }
  }

  if (succeeded.length > 0) {
    deps.applyDelete({
      cardIds: succeeded.map((item) => item.cardId),
      entryIds: succeeded.map((item) => item.entryId),
    })
    deps.schedule()
  }
  if (failed.length > 0) {
    deps.onError(PERMANENT_DELETE_TEXT.partialFailed(failed))
    return false
  }
  return true
}
