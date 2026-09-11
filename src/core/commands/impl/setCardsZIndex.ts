// ============================================================================
// 模块说明（中文）
// 「置顶 / 置底」命令。对应开发计划书 T3.9（右键菜单）与第 7.4 节（可撤销）。
//
// zIndex 语义：画布按 zIndex 升序渲染（DOM 顺序即层叠顺序）。
//   置顶 = 其它卡片的最大 zIndex + 1；置底 = 其它卡片的最小 zIndex - 1。
//   「已在顶 / 底」的判定必须**严格**越过所有其它卡片 —— 若所有卡片 zIndex 相等
//   （新建空间的常态），任何卡片都不算已在顶，必须能移出，否则功能永远空转。
//   不重排其它卡片的 zIndex —— 撤销只需还原本次改动的卡片，命令负载最小。
//
// apply 由上层注入（写 boardStore.setCardsZIndex），本命令不直接依赖 store。
// 实现任务：T3.9。
// ============================================================================

import type { Command } from '../types'

/** 单张卡片的层叠变化记录 */
export interface CardZIndexDelta {
  id: string
  from: number
  to: number
}

/** 写回层签名：boardStore.setCardsZIndex */
export type ApplyCardZIndex = (updates: { id: string; zIndex: number }[]) => void

/** 由现有卡片数组算出「置顶 / 置底」的 delta。无变化（只有一张卡等）返回空数组 */
export function zIndexDeltasFor(
  cards: { id: string; zIndex: number }[],
  targets: string[],
  to: 'front' | 'back',
): CardZIndexDelta[] {
  if (targets.length === 0 || cards.length === 0) return []

  const targetSet = new Set(targets)
  // 边界只看「其它卡片」：与目标自身比较会让「全部相等」被误判为「已在顶 / 底」
  const others = cards.filter((card) => !targetSet.has(card.id))
  if (others.length === 0) return [] // 画布上只剩目标自己：层叠顺序无意义
  const values = others.map((card) => card.zIndex)
  const bound = to === 'front' ? Math.max(...values) : Math.min(...values)
  const step = to === 'front' ? 1 : -1

  return targets
    .map((id) => {
      const card = cards.find((item) => item.id === id)
      if (!card) return null
      // 已经严格越过所有其它卡片的，不再产生无意义变化
      if (to === 'front' ? card.zIndex > bound : card.zIndex < bound) return null
      return { id, from: card.zIndex, to: bound + step }
    })
    .filter((delta): delta is CardZIndexDelta => delta !== null)
}

export function createSetCardsZIndexCommand(
  deltas: CardZIndexDelta[],
  apply: ApplyCardZIndex,
): Command {
  return {
    type: 'zIndex',

    do() {
      apply(deltas.map((delta) => ({ id: delta.id, zIndex: delta.to })))
    },

    undo() {
      apply(deltas.map((delta) => ({ id: delta.id, zIndex: delta.from })))
    },
  }
}
