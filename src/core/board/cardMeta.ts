// ============================================================================
// 模块说明（中文）
// 卡片 meta 的**纯数据读写**（标签是最先落地的一项）。
//
// 【为什么单独成文件（2026-09-14 从 core/commands/impl/setCardMeta.ts 迁出）】
//   这两个函数是纯粹的「读 meta / 生成新 meta」，与「命令 / 撤销栈」毫无关系，
//   却原先住在命令文件里，导致一个方向性错误：
//     core/registry/cardTypes.ts（配置层）为了读标签而 import core/commands/impl（业务层）。
//   迁到 core/board/ 后，配置层只依赖同层的 board 工具，层次恢复正向。
//
// 标签存放约定（17 章未写明具体字段，按 4.2 的 meta 扩展位设计）：
//   card.meta.tags: string[] —— meta 是 4.2 明确的「自由扩展字段」，随卡片一起
//   经 zod 往返落盘；不新增 schema 字段，插件将来读标签也走同一约定。
//
// 纯函数，可单元测试。
// ============================================================================

import type { Meta } from '@/core/types'

/** 读某张卡片的标签（meta.tags）。不是数组时返回空数组（脏数据兜底） */
export function tagsOfMeta(meta: Meta): string[] {
  const tags = meta.tags
  return Array.isArray(tags) ? tags.map(String) : []
}

/** 生成带新标签的 meta 快照（不改动原对象） */
export function metaWithTags(meta: Meta, tags: string[]): Meta {
  return { ...meta, tags }
}
