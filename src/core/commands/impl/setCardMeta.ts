// ============================================================================
// 模块说明（中文）
// 「改卡片 meta」命令。对应开发计划书 T3.9「编辑标签」与第 7.4 节（可撤销）。
//
// 标签存放决策（17 章未写明具体字段，按 4.2 的 meta 扩展位设计）：
//   card.meta.tags: string[] —— meta 是 4.2 明确的「自由扩展字段」，随卡片
//   一起经 zod 往返落盘；不新增 schema 字段，插件将来读标签也走同一约定。
//
// do/undo 都整体替换该卡片的 meta（调用方保证传入完整 meta 快照）。
// 实现任务：T3.9。
// ============================================================================

import type { Command } from '../types'
import type { Meta } from '@/core/types'

/** 写回层签名：boardStore.setCardMeta */
export type ApplyCardMeta = (id: string, meta: Meta) => void

export function createSetCardMetaCommand(
  id: string,
  from: Meta,
  to: Meta,
  apply: ApplyCardMeta,
): Command {
  return {
    type: 'meta',

    do() {
      apply(id, to)
    },

    undo() {
      apply(id, from)
    },
  }
}

/** 读某张卡片的标签（meta.tags）。不是数组时返回空数组（脏数据兜底） */
export function tagsOfMeta(meta: Meta): string[] {
  const tags = meta.tags
  return Array.isArray(tags) ? tags.map(String) : []
}

/** 生成带新标签的 meta 快照（不改动原对象） */
export function metaWithTags(meta: Meta, tags: string[]): Meta {
  return { ...meta, tags }
}
