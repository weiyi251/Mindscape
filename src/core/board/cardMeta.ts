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
// 【悬浮标记 hoverLabel（2026-09-14）】
//   card.meta.hoverLabel: string —— 「鼠标悬停在这张卡上时，在图片区域外显示的短标记」。
//   首个使用方是色卡插件：色卡 PNG 绝不把色号画进图里（用户裁决），改为把色号
//   写进 meta.hoverLabel，由渲染层在悬停时显示在卡片盒**下方外侧左对角**
//   （2026-09-14 第二次裁决：从最初的上外挂层左上角移到下方左下角，与右下角的
//   分辨率徽章左右对称）。
//
//   为什么做成**通用字段**而不是「核心认识色卡」：插件系统有一条铁律 ——
//   core 不认识任何具体插件（见 docs/插件系统-结构与实现要点.md §1）。
//   核心只回答「这张卡有没有一个悬停标记」，至于标记是什么、由谁写的，与核心无关。
//   任何插件（或核心自身的功能）都能往这个字段里写，无需新增扩展点。
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

/** 悬浮标记在 meta 里的键名（`card.meta.hoverLabel`） */
export const HOVER_LABEL_META_KEY = 'hoverLabel'

/**
 * 读某张卡片的悬浮标记。非字符串 / 空串 / 纯空白一律返回 null（脏数据兜底）。
 * 返回的是 trim 之后的文本：它会被当作单行标记渲染，多出来的空白没有意义。
 */
export function hoverLabelOfMeta(meta: Meta): string | null {
  const value = meta[HOVER_LABEL_META_KEY]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** 生成带悬浮标记的 meta 快照（不改动原对象） */
export function metaWithHoverLabel(meta: Meta, label: string): Meta {
  return { ...meta, [HOVER_LABEL_META_KEY]: label }
}

// ---------------------------------------------------------------------------
// 条目锚点表（2026-09-17）：条目级连线的通用协议
// ---------------------------------------------------------------------------

/** 条目锚点表在 meta 里的键名（`card.meta.itemAnchors`） */
export const ITEM_ANCHORS_META_KEY = 'itemAnchors'

/**
 * 读条目锚点表：条目 id → 该条目相对卡片**顶边**的 y 偏移（画布像素）。
 *
 * 【通用协议，core 不认识具体插件】插件（如待办卡）自算每个条目行的 y 偏移
 * 写进 meta，连线端点计算只查这张表：命中的条目连到条目行上，没命中退回
 * 整卡中点。表里的值非有限数、表本身不是普通对象时按缺项兜底——
 * 连线端点计算在渲染循环里，这里绝不抛错。
 */
export function itemAnchorsOfMeta(meta: Meta): Record<string, number> {
  const raw = meta[ITEM_ANCHORS_META_KEY]
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const anchors: Record<string, number> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'number' && Number.isFinite(value)) anchors[key] = value
  }
  return anchors
}

/** 生成带条目锚点表的 meta 快照（不改动原对象） */
export function metaWithItemAnchors(meta: Meta, anchors: Record<string, number>): Meta {
  return { ...meta, [ITEM_ANCHORS_META_KEY]: anchors }
}

// ---------------------------------------------------------------------------
// 卡片锁定（2026-09-20，A–D 优化计划 C4）
// ---------------------------------------------------------------------------

/**
 * 锁定标记在 meta 里的键名（`card.meta.locked`）。
 *
 * 语义（用户裁决范围）：**位置与尺寸冻结** —— 画布上拖不动、拖不小，避免
 * 摆好版面后被误拖；选中、连线、右键菜单、打开原图照常。锁定不是「禁用卡片」，
 * 更不是权限控制，所以也不需要额外的确认流程。
 *
 * 存放走 4.2 的 meta 扩展位（与 tags / noteColor / hoverLabel 同一约定），
 * 不新增 schema 字段、随卡片 zod 往返落盘。
 */
export const LOCKED_META_KEY = 'locked'

/** 这张卡片是否被锁定。只有**布尔真值**算锁定（脏数据一律当未锁定） */
export function lockedOfMeta(meta: Meta): boolean {
  return meta[LOCKED_META_KEY] === true
}

/**
 * 生成带锁定标记的 meta 快照（不改动原对象）。
 * `locked` 为 false 时**删键**而不是写入 false —— 与 noteColor 同一约定：
 * 不留无用字段，布局文件干净（脏数据兜底也更简单）。
 */
export function metaWithLocked(meta: Meta, locked: boolean): Meta {
  if (!locked) {
    const next = { ...meta }
    delete next[LOCKED_META_KEY]
    return next
  }
  return { ...meta, [LOCKED_META_KEY]: true }
}
