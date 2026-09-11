// ============================================================================
// 模块说明（中文）
// 「改卡片备注」命令。对应开发计划书 T3.3 与第 7.4 节（可撤销）。
//
// 备注存在 card.note（4.2 schema 自带字段），随 layout.json 落盘。
// do/undo 都只动 note 字段；apply 由上层注入（boardStore.updateCardNote）。
// 实现任务：T3.3。
// ============================================================================

import type { Command } from '../types'

/** 写回层签名：boardStore.updateCardNote */
export type ApplyCardNote = (id: string, note: string) => void

export function createSetCardNoteCommand(
  id: string,
  from: string,
  to: string,
  apply: ApplyCardNote,
): Command {
  return {
    type: 'note',

    do() {
      apply(id, to)
    },

    undo() {
      apply(id, from)
    },
  }
}
