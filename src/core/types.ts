// ============================================================================
// 模块说明（中文）
// 数据 Schema 类型定义，对应开发计划书第 4 章「数据结构设计（地基）」。
//
//   4.1 空间元数据      → %APPDATA%\Mindscape\spaces.json
//   4.2 画布布局数据    → %APPDATA%\Mindscape\layouts\<空间 id>.json（P1-2 起；
//                          旧位置 `<空间文件夹>\.mindscape\layout.json` 仍可读并自动迁移）
//
// 两个文件都带 version 版本号（用于将来数据迁移），并对每个对象预留 meta 自由字段、
// 顶层预留 extensions 扩展位 —— 将来加功能往这两处塞，不改主结构（第十三章「准备 1」）。
//
// 本模块同时是「读文件时的校验层」：所有从磁盘读入的 JSON 必须经 zod 校验后才可使用，
// 避免脏数据流入内存态、再被写回磁盘造成连锁损坏。
//
// 注意：zod 已在 T0.4 由用户明确批准引入（10.1 技术栈清单未列出）。
// ============================================================================

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

/** Data version of both spaces.json and layout.json. Bump when the shape changes. */
export const DATA_VERSION = 1

/** Free-form extension slot. Plugins put their own data here (decision 1 in ch.13). */
export const zMetaSchema = z.record(z.unknown()).default({})
export type Meta = Record<string, unknown>

/**
 * Card types shipped in v1 (ch.13 "准备 4").
 * Kept as a plain string in the schema so plugins can register new types.
 */
export const CORE_CARD_TYPES = ['image', 'file', 'note'] as const
export type CoreCardType = (typeof CORE_CARD_TYPES)[number]

/**
 * Preset space types (ch.4.1). Deliberately neutral: `type` stays a free string,
 * these are only offered as suggestions in the UI.
 */
export const SPACE_TYPE_PRESETS = ['项目', '参考素材', '灵感库', '课题', '归档'] as const

// ---------------------------------------------------------------------------
// 4.2 layout.json
// ---------------------------------------------------------------------------

/** viewport transform persisted with the space */
export const zCanvasStateSchema = z.object({
  zoom: z.number().positive().default(1),
  offsetX: z.number().default(0),
  offsetY: z.number().default(0),
})
export type CanvasState = z.infer<typeof zCanvasStateSchema>

export const zCardSchema = z.object({
  id: z.string(),
  /** card type key, resolved through the card-type registry */
  type: z.string(),
  /** current on-disk path, relative to the space folder */
  filePath: z.string(),
  /** path before it was moved into `_已移除` (used to restore) */
  originalPath: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  rotation: z.number().default(0),
  zIndex: z.number().default(0),
  note: z.string().default(''),
  /** owning partition name, if any */
  group: z.string().optional(),
  meta: zMetaSchema,
})
export type Card = z.infer<typeof zCardSchema>

export const zPartitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** sub-folder path, relative to the space folder */
  folderPath: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  /** 'auto' = pick from the soft palette, otherwise an explicit colour key */
  color: z.string().default('auto'),
  collapsed: z.boolean().default(false),
  meta: zMetaSchema,
})
export type Partition = z.infer<typeof zPartitionSchema>

export const zConnectionSchema = z.object({
  id: z.string(),
  /** source card id */
  from: z.string(),
  /** target card id */
  to: z.string(),
  label: z.string().default(''),
  color: z.string().default('gray'),
  meta: zMetaSchema,
})
export type Connection = z.infer<typeof zConnectionSchema>

/** Record of a card moved into `_已移除`; the only way back is `originalPath`. */
export const zRemovedEntrySchema = z.object({
  id: z.string(),
  originalPath: z.string(),
  movedTo: z.string(),
})
export type RemovedEntry = z.infer<typeof zRemovedEntrySchema>

export const zLayoutSchema = z.object({
  version: z.number().default(DATA_VERSION),
  canvas: zCanvasStateSchema.default({}),
  cards: z.array(zCardSchema).default([]),
  partitions: z.array(zPartitionSchema).default([]),
  connections: z.array(zConnectionSchema).default([]),
  removed: z.array(zRemovedEntrySchema).default([]),
  /** top-level extension slot for future modules */
  extensions: zMetaSchema,
})
export type Layout = z.infer<typeof zLayoutSchema>

// ---------------------------------------------------------------------------
// 4.1 spaces.json
// ---------------------------------------------------------------------------

export const zSpaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** free-form type, see SPACE_TYPE_PRESETS */
  type: z.string().default('项目'),
  /** absolute path of the bound folder (desktop app: no handle needed) */
  folderPath: z.string(),
  createdAt: z.string(),
  lastOpenedAt: z.string(),
  /** 收藏（P1-5）：列表里排在未收藏空间前面；旧数据无此字段 → false（向后兼容） */
  favorite: z.boolean().default(false),
  meta: zMetaSchema,
})
export type Space = z.infer<typeof zSpaceSchema>

export const zSpacesFileSchema = z.object({
  version: z.number().default(DATA_VERSION),
  spaces: z.array(zSpaceSchema).default([]),
})
export type SpacesFile = z.infer<typeof zSpacesFileSchema>

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

/** Empty layout, returned when a space has no layout.json yet (17.5 read_layout). */
export function createEmptyLayout(): Layout {
  return zLayoutSchema.parse({})
}

/** Empty spaces file, used on first launch. */
export function createEmptySpacesFile(): SpacesFile {
  return zSpacesFileSchema.parse({})
}

// ---------------------------------------------------------------------------
// Parse helpers (never throw — callers decide the recovery policy)
// ---------------------------------------------------------------------------

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

function parseJsonWith<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, text: string): ParseResult<T> {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return { ok: false, error: `JSON 解析失败：${(err as Error).message}` }
  }

  const result = schema.safeParse(raw)
  if (!result.success) {
    return { ok: false, error: `数据校验失败：${result.error.issues.map(describeIssue).join('；')}` }
  }
  return { ok: true, data: result.data }
}

function describeIssue(issue: z.ZodIssue): string {
  const path = issue.path.length > 0 ? issue.path.join('.') : '(根)'
  return `${path}: ${issue.message}`
}

/** Validate raw layout.json text (ch.4.2). */
export function parseLayout(text: string): ParseResult<Layout> {
  return parseJsonWith(zLayoutSchema, text)
}

/** Validate raw spaces.json text (ch.4.1). */
export function parseSpacesFile(text: string): ParseResult<SpacesFile> {
  return parseJsonWith(zSpacesFileSchema, text)
}
