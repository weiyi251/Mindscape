// ============================================================================
// 模块说明（中文）
// 「更新插件卡片内容」命令（2026-09-17，待办卡片插件引入）。
//
// 场景：插件卡片（如待办卡）的内容存在 meta 里，条目增删 / 勾选会**同时**改变
// meta 与卡片高度（高度自适应内容）。这两个变化必须原子地同进同出 ——
// 否则撤销后会出现「条目回滚了但高度还留着」或反之的撕裂状态。
//
// 因此做一条独立命令，而不是让插件分别走 setCardMeta + resize 两条命令：
// 两条命令入栈会把一次编辑拆成两步撤销，用户要按两次 Ctrl+Z 才能回到原样。
//
// meta 是**整体替换**（调用方传完整快照）——插件基于自己读到的旧 meta 算出
// 新快照后整体换入；浅合并删不掉键，语义也不干净。
//
// 宽度不在本命令职责内：写回层（setCardSizes）需要完整宽高，故 delta 里带一个
// 原样透传的 width（do/undo 都传同一个值）；高度相同则不动尺寸（省一次落盘）。
// ============================================================================

import type { Command } from '../types'
import type { Meta } from '@/core/types'
import type { ApplyCardMeta } from './setCardMeta'
import type { ApplyCardSizes } from './resizeCards'

/** 一次内容更新的前后快照 */
export interface UpdateCardContentDelta {
  /** 目标卡片 id */
  id: string
  /**
   * 卡片宽度（do/undo 原样透传给写回层 —— 本命令不改变宽度，
   * 但 setCardSizes 需要完整宽高，避免把宽度清零）
   */
  width: number
  /** 旧 meta 完整快照（undo 用） */
  fromMeta: Meta
  /** 新 meta 完整快照（do 用） */
  toMeta: Meta
  /** 旧高度（画布 px） */
  fromH: number
  /** 新高度（高度自适应内容之后） */
  toH: number
}

/** 写回层签名集合：由上层注入（boardStore 的 setCardMeta / setCardSizes） */
export interface ApplyUpdateCardContent {
  meta: ApplyCardMeta
  sizes: ApplyCardSizes
}

/** 创建「更新插件卡片内容」命令：meta 整体替换 + 高度自适应，原子可撤销 */
export function createUpdateCardContentCommand(
  delta: UpdateCardContentDelta,
  apply: ApplyUpdateCardContent,
): Command {
  /** 高度是否真的变了：没变就只换 meta，不再写尺寸（省一次 store 写入与落盘调度） */
  const heightChanged = delta.fromH !== delta.toH

  return {
    type: 'content',

    do() {
      apply.meta(delta.id, delta.toMeta)
      if (heightChanged) {
        apply.sizes([{ id: delta.id, w: delta.width, h: delta.toH }])
      }
    },

    undo() {
      apply.meta(delta.id, delta.fromMeta)
      if (heightChanged) {
        apply.sizes([{ id: delta.id, w: delta.width, h: delta.fromH }])
      }
    },
  }
}
