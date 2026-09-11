// ============================================================================
// 模块说明（中文）
// 「指定分区框颜色」命令。对应开发计划书 T3.9（右键菜单）与第六章（8 色色板）。
//
// color 取值与 partitions.ts 的 PARTITION_COLOR_KEYS 一致；'auto' 表示回到轮换。
// do/undo 只动 color 字段；apply 由上层注入（boardStore.setPartitionColor）。
// 实现任务：T3.9。
// ============================================================================

import type { Command } from '../types'

/** 写回层签名：boardStore.setPartitionColor */
export type ApplyPartitionColor = (id: string, color: string) => void

export function createSetPartitionColorCommand(
  id: string,
  from: string,
  to: string,
  apply: ApplyPartitionColor,
): Command {
  return {
    type: 'partitionColor',

    do() {
      apply(id, to)
    },

    undo() {
      apply(id, from)
    },
  }
}
