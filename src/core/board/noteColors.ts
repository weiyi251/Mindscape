// ============================================================================
// 模块说明（中文）
// 便签自定义颜色（2026-09-15 用户需求「添加自定义便签颜色功能」）。
//
// 存放约定：与标签 tags / 悬浮标记 hoverLabel 同一条路 —— 走 4.2 的 meta
// 自由扩展位（card.meta.noteColor），不新增 schema 字段，随卡片 zod 往返落盘。
//
// 【为什么色板住在 core/board】与 PARTITION_PALETTE（partitions.ts）同理：
//   色值是「给用户挑的数据」而不是组件样式，渲染层（core/registry/cardTypes.ts）
//   与菜单层（pages/board/contextMenus.tsx）都要读它，放 board 层正向依赖。
//   架构守卫规则 3 的 RAW_COLOR_ALLOWLIST 已为登记本文件留了条目。
//
// 【渲染方式】不用原色铺满卡片 —— 底色取「色值 + 33」（约 20% 透明度）、
//   边框取「色值 + 99」（约 60% 透明度），与分区框同款做法：
//   浅色主题下是淡淡的着色便签纸，深色主题下是微微着色的暗面，
//   文字始终走语义 token（text-foreground），两种主题都可读。
//   未选色（meta 无该键）= 默认便签纸（globals.css 的 --note 语义变量）。
//
// 纯函数，可单元测试。
// ============================================================================

import type { Meta } from '@/core/types'

/** 便签颜色在 meta 里的键名（`card.meta.noteColor`） */
export const NOTE_COLOR_META_KEY = 'noteColor'

/** 7 色低饱和柔和色板（数据本身，调整只改这里；与分区色板刻意区分色系） */
export const NOTE_PALETTE = [
  '#E7C873', // 奶黄
  '#E8A87C', // 蜜橙
  '#D98C8C', // 豆沙粉
  '#9BC4A0', // 抹茶绿
  '#8FB8D8', // 雾蓝
  '#B39DDB', // 藕紫
  '#C9B896', // 亚麻
] as const

/** 便签底色的透明度后缀（约 20%，叠在主题画布上） */
export const NOTE_BG_ALPHA = '33'

/** 便签边框的透明度后缀（约 60%，比底色实一些，勾勒轮廓） */
export const NOTE_BORDER_ALPHA = '99'

/** 合法色值格式：#RRGGBB（菜单只会传色板值，这里兜底脏数据） */
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

/**
 * 读某张便签的自定义颜色。无该键 / 非法格式一律返回 null（= 默认便签纸）。
 * 接受任何合法 #RRGGBB 而不仅限当前色板：色板将来调整时，旧数据仍能正常渲染。
 */
export function noteColorOfMeta(meta: Meta): string | null {
  const value = meta[NOTE_COLOR_META_KEY]
  if (typeof value !== 'string' || !HEX_COLOR_RE.test(value)) return null
  return value
}

/**
 * 生成带（或去掉）自定义颜色的 meta 快照（不改动原对象）。
 * color 传 null = 回到默认便签纸（把键从快照里删掉，meta 不留 null 脏值）。
 */
export function metaWithNoteColor(meta: Meta, color: string | null): Meta {
  const next = { ...meta }
  if (color === null) {
    delete next[NOTE_COLOR_META_KEY]
  } else {
    next[NOTE_COLOR_META_KEY] = color
  }
  return next
}
