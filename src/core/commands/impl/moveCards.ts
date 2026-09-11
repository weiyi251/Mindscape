// ============================================================================
// 模块说明（中文）
// 「移动卡片」命令。对应开发计划书 T2.2（单卡拖动）/ T2.3（多选拖动）与第 7.4 节。
//
// 松手时卡片坐标已经通过 DOM 直写生效（17.3），这里负责把它**固化进状态**并支持
// 撤销 / 重做：do() 应用 to、undo() 应用 from。apply 由上层注入（写 boardStore），
// 本命令不直接依赖 store，保持可单测。
//
// 多选拖动时一次拖拽产生一条命令（内含多张卡的位移）—— 撤销一步整组还原（11.2）。
// 实现任务：T2.2 / T2.3 / T2.9。
// ============================================================================

import type { Command } from '../types'

/** 单张卡片的位移记录：按下时坐标 → 松手时坐标（画布坐标） */
export interface CardMoveDelta {
  id: string
  from: { x: number; y: number }
  to: { x: number; y: number }
}

/** 写回层签名：把一组卡片坐标写入状态（boardStore.setCardPositions） */
export type ApplyCardPositions = (positions: { id: string; x: number; y: number }[]) => void

/** 拖动结束后坐标是否真的变了；没变就不该产生命令（否则撤销栈被无意义操作占满） */
export function hasMeaningfulMove(moves: CardMoveDelta[]): boolean {
  return moves.some((move) => move.from.x !== move.to.x || move.from.y !== move.to.y)
}

/**
 * 创建「移动卡片」命令。
 *
 * 用法（Canvas 松手时）：
 *   const cmd = createMoveCardsCommand(deltas, apply)
 *   await history.execute(cmd)   // execute 内部会再调一次 do()，幂等
 */
export function createMoveCardsCommand(
  moves: CardMoveDelta[],
  apply: ApplyCardPositions,
): Command {
  return {
    type: 'move',

    do() {
      apply(moves.map((move) => ({ id: move.id, x: move.to.x, y: move.to.y })))
    },

    undo() {
      apply(moves.map((move) => ({ id: move.id, x: move.from.x, y: move.from.y })))
    },
  }
}
