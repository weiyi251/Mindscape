// ============================================================================
// 模块说明（中文）
// 「调整分区框矩形」命令（2026-09-11 用户裁决「分区框大小自定义」）。
// 与 T2.5 的 movePartitions 不同：拖拽边缘只改 w / h（x / y 不动，框内卡片
// 也不动），所以 delta 只记录尺寸变化；from / to 仍带全量矩形以便 undo 精确还原。
//
// apply 由上层注入（写 boardStore.setPartitionRects），保持可单测。
// ============================================================================

import type { Command } from '../types'

export interface PartitionRectDelta {
  id: string
  from: { x: number; y: number; w: number; h: number }
  to: { x: number; y: number; w: number; h: number }
}

/** 尺寸没变就不产生命令（原地单击手柄） */
export function hasMeaningfulRectChange(delta: PartitionRectDelta): boolean {
  return delta.from.w !== delta.to.w || delta.from.h !== delta.to.h
}

export function createSetPartitionRectsCommand(
  deltas: PartitionRectDelta[],
  apply: (updates: { id: string; x: number; y: number; w: number; h: number }[]) => void,
): Command {
  return {
    type: 'resize',

    do() {
      apply(deltas.map((delta) => ({ id: delta.id, ...delta.to })))
    },

    undo() {
      apply(deltas.map((delta) => ({ id: delta.id, ...delta.from })))
    },
  }
}
