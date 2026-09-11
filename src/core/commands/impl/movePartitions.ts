// ============================================================================
// 模块说明（中文）
// 「移动分区框」命令（T2.5）。拖框 = 整组移动框内卡片（第六章），
// 因此一条命令同时记录**框位移 + 框内所有卡片位移**，撤销 / 重做时整组还原
// —— 保证框与卡片永远相对静止，不会出现「框回去了、卡片没回去」的错位。
//
// apply 由上层注入（写 boardStore 的 setPartitionPositions + setCardPositions），
// 本命令不直接依赖 store，保持可单测。
//
// 实现任务：T2.5 / T2.9。
// ============================================================================

import type { Command } from '../types'
import type { CardMoveDelta } from './moveCards'
import { hasMeaningfulMove } from './moveCards'

/** 一次拖框的完整位移记录 */
export interface PartitionMoveDelta {
  partitionId: string
  from: { x: number; y: number }
  to: { x: number; y: number }
  /** 框内卡片位移 */
  cardMoves: CardMoveDelta[]
}

/** 写回层签名：同时写框位置与卡片位置 */
export type ApplyPartitionMove = (payload: {
  partitions: { id: string; x: number; y: number }[]
  cards: { id: string; x: number; y: number }[]
}) => void

/** 拖框后是否真的有位移（框或任一卡片） */
export function hasMeaningfulPartitionMove(delta: PartitionMoveDelta): boolean {
  const boxMoved = delta.from.x !== delta.to.x || delta.from.y !== delta.to.y
  return boxMoved || hasMeaningfulMove(delta.cardMoves)
}

/**
 * 创建「移动分区框」命令（框 + 卡片整组）。
 */
export function createMovePartitionsCommand(
  delta: PartitionMoveDelta,
  apply: ApplyPartitionMove,
): Command {
  const toPartitions = [{ id: delta.partitionId, x: delta.to.x, y: delta.to.y }]
  const fromPartitions = [{ id: delta.partitionId, x: delta.from.x, y: delta.from.y }]
  const toCards = delta.cardMoves.map((move) => ({ id: move.id, x: move.to.x, y: move.to.y }))
  const fromCards = delta.cardMoves.map((move) => ({ id: move.id, x: move.from.x, y: move.from.y }))

  return {
    type: 'move',

    do() {
      apply({ partitions: toPartitions, cards: toCards })
    },

    undo() {
      apply({ partitions: fromPartitions, cards: fromCards })
    },
  }
}
