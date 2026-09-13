// ============================================================================
// 模块说明（中文）
// 色卡插件的**参数模型与纯函数层**：预设色板、尺寸约束、校验、文件名生成、
// 以及「插件配置 ↔ 参数」的双向映射。
//
// 为什么参数要与界面分开：本项目不引入 jsdom（用户裁决），React 组件在 node 环境
// 测不了。把「默认值 / 合法性 / 夹紧 / 命名」这些真正会被用错的部分抽成纯函数，
// 就能在 node 环境把边界一次性钉死，组件只剩「把值绑到控件上」。
//
// 命名空间约定：配置写在 plugins.json 的该插件 config 里，键名即本文件的 CONFIG_KEY。
// ============================================================================

import { pad2 } from '@/core/utils/time'
import { COLOR_CARD_TEXT, COLOR_PRESET_LABELS, SIZE_PRESET_LABELS } from './text'

/** 色卡尺寸的合法区间（像素） */
export const COLOR_CARD_LIMITS = { minSize: 16, maxSize: 4096 } as const

/**
 * 色板预设。
 * ⚠️ 这些 hex 是**给用户挑的数据**（与 core/board/partitions.ts 的分区调色板同理），
 *    不是组件样式，因此本文件登记在守卫规则 3 的 RAW_COLOR_ALLOWLIST 里。
 */
export interface ColorPreset {
  id: string
  color: string
}

export const COLOR_CARD_COLOR_PRESETS: ColorPreset[] = [
  { id: 'graphite', color: '#3F4145' },
  { id: 'moss', color: '#5A7D6A' },
  { id: 'clay', color: '#B4705A' },
  { id: 'amber', color: '#C9963F' },
  { id: 'indigo', color: '#4C5B8A' },
  { id: 'rose', color: '#A64A57' },
  { id: 'sky', color: '#6E9BB5' },
  { id: 'ivory', color: '#EDE7DA' },
]

/** 尺寸预设 */
export interface SizePreset {
  id: string
  width: number
  height: number
}

export const COLOR_CARD_SIZE_PRESETS: SizePreset[] = [
  { id: 'square-200', width: 200, height: 200 },
  { id: 'square-400', width: 400, height: 400 },
  { id: 'square-800', width: 800, height: 800 },
  { id: 'card-600x400', width: 600, height: 400 },
  { id: 'banner-1200x300', width: 1200, height: 300 },
]

/** 色板预设 id → 中文标签 */
export function colorPresetLabel(id: string): string {
  return COLOR_PRESET_LABELS[id] ?? id
}

/** 尺寸预设 id → 中文标签 */
export function sizePresetLabel(id: string): string {
  return SIZE_PRESET_LABELS[id] ?? id
}

/** 完整的一套生成参数 */
export interface ColorCardOptions {
  /** 归一化后的 #RRGGBB 色值 */
  color: string
  /** 像素宽 */
  width: number
  /** 像素高 */
  height: number
  /** 是否在色卡正中标注色值 */
  showHex: boolean
  /** 文件名前缀（已净化，去掉了 Windows 非法字符） */
  namePrefix: string
  /** 输出文件夹绝对路径；空串表示未选择 */
  outputDir: string
}

export const DEFAULT_COLOR_CARD_OPTIONS: ColorCardOptions = {
  color: '#5A7D6A',
  width: 400,
  height: 400,
  showHex: true,
  namePrefix: '色卡',
  outputDir: '',
}

/** 插件配置里的键名（与 plugins.json 的 config 一一对应） */
export const CONFIG_KEY = {
  color: 'color',
  width: 'width',
  height: 'height',
  showHex: 'showHex',
  namePrefix: 'namePrefix',
  outputDir: 'outputDir',
} as const

// ---------------------------------------------------------------------------
// 色值
// ---------------------------------------------------------------------------

/** 三位简写（#abc / abc） */
const SHORT_HEX = /^#?([0-9a-fA-F]{3})$/
/** 六位完整（#aabbcc / aabbcc） */
const FULL_HEX = /^#?([0-9a-fA-F]{6})$/

/**
 * 把用户输入归一化成 `#RRGGBB`（大写）；非法输入返回 null。
 * 兼容：带不带 `#`、三位简写、大小写混合、前后空格。
 */
export function normalizeHex(input: string): string | null {
  const value = input.trim()

  const short = SHORT_HEX.exec(value)
  if (short) {
    const [r, g, b] = short[1].split('')
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase()
  }

  const full = FULL_HEX.exec(value)
  if (full) return `#${full[1]}`.toUpperCase()

  return null
}

// ---------------------------------------------------------------------------
// 尺寸
// ---------------------------------------------------------------------------

/** 尺寸是否落在合法区间内 */
export function isValidSize(value: number): boolean {
  return Number.isInteger(value) && value >= COLOR_CARD_LIMITS.minSize && value <= COLOR_CARD_LIMITS.maxSize
}

/** 把数字夹进合法区间（非数字回落到默认边长） */
export function clampSize(value: number, fallback = DEFAULT_COLOR_CARD_OPTIONS.width): number {
  if (!Number.isFinite(value)) return fallback
  const rounded = Math.round(value)
  return Math.min(COLOR_CARD_LIMITS.maxSize, Math.max(COLOR_CARD_LIMITS.minSize, rounded))
}

/** 尺寸的展示文案，如 `600 × 400` */
export function describeSize(width: number, height: number): string {
  return `${width} × ${height}`
}

// ---------------------------------------------------------------------------
// 文件名
// ---------------------------------------------------------------------------

/** Windows / POSIX 都不允许出现在文件名里的字符 */
const ILLEGAL_NAME_CHARS = /[\\/:*?"<>|]/g
/** 前缀最大长度（防止用户粘一整段文字当文件名） */
const MAX_PREFIX_LENGTH = 24

/** 净化文件名前缀：去掉非法字符、压缩空白、截断 */
export function sanitizeNamePrefix(input: string): string {
  return input.replace(ILLEGAL_NAME_CHARS, '').replace(/\s+/g, ' ').trim().slice(0, MAX_PREFIX_LENGTH)
}

/**
 * 生成色卡文件名，形如 `色卡-5A7D6A-20260914-0012.png`。
 * 分钟精度；同一分钟内生成两张 → Rust 端 unique_path_in 自动加 `_1` 后缀
 * （与粘贴截图 core/board/ingest.ts 的 pasteFileName 同一套约定）。
 */
export function colorCardFileName(prefix: string, color: string, date: Date): string {
  const safePrefix = sanitizeNamePrefix(prefix) || DEFAULT_COLOR_CARD_OPTIONS.namePrefix
  const hex = (normalizeHex(color) ?? DEFAULT_COLOR_CARD_OPTIONS.color).slice(1)
  const stamp = [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
  ].join('') + `-${pad2(date.getHours())}${pad2(date.getMinutes())}`
  return `${safePrefix}-${hex}-${stamp}.png`
}

// ---------------------------------------------------------------------------
// 参数归一化 / 校验
// ---------------------------------------------------------------------------

/** 把任意（可能残缺、可能越界的）参数补全成一套合法参数 */
export function normalizeOptions(input: Partial<ColorCardOptions>): ColorCardOptions {
  const base = DEFAULT_COLOR_CARD_OPTIONS
  const color = normalizeHex(input.color ?? '') ?? base.color

  return {
    color,
    width: clampSize(input.width ?? base.width),
    height: clampSize(input.height ?? base.height, base.height),
    showHex: input.showHex ?? base.showHex,
    namePrefix: sanitizeNamePrefix(input.namePrefix ?? base.namePrefix) || base.namePrefix,
    outputDir: (input.outputDir ?? '').trim(),
  }
}

/**
 * 校验参数是否可生成（**归一化之后**再调）。
 * @returns 中文错误说明；合法时返回 null
 */
export function validateColorCardOptions(options: ColorCardOptions): string | null {
  if (normalizeHex(options.color) === null) return COLOR_CARD_TEXT.invalidColor
  if (!isValidSize(options.width) || !isValidSize(options.height)) {
    return COLOR_CARD_TEXT.invalidSize(COLOR_CARD_LIMITS.minSize, COLOR_CARD_LIMITS.maxSize)
  }
  if (options.outputDir.trim() === '') return COLOR_CARD_TEXT.missingOutputDir
  return null
}

// ---------------------------------------------------------------------------
// 插件配置 ↔ 参数
// ---------------------------------------------------------------------------

function readString(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key]
  return typeof value === 'string' ? value : undefined
}

function readNumber(config: Record<string, unknown>, key: string): number | undefined {
  const value = config[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readBoolean(config: Record<string, unknown>, key: string): boolean | undefined {
  const value = config[key]
  return typeof value === 'boolean' ? value : undefined
}

/**
 * 从插件配置恢复上次使用的参数（用户下次打开对话框时不必重填）。
 *
 * 两个刻意的设计：
 *   · 配置里的任何坏值都不抛错，一律回落到默认值 —— 配置文件是用户能手改的；
 *   · 配置里没记过输出文件夹时，用调用方给的兜底值（通常是当前空间目录）。
 */
export function optionsFromConfig(
  config: Record<string, unknown>,
  fallbackOutputDir = '',
): ColorCardOptions {
  // 输出目录先 trim 再判断：plugins.json 是用户能手改的，
  // 只剩空白的字符串等于「没设置」，此时才回落到兜底值
  const storedOutputDir = (readString(config, CONFIG_KEY.outputDir) ?? '').trim()

  return normalizeOptions({
    color: readString(config, CONFIG_KEY.color),
    width: readNumber(config, CONFIG_KEY.width),
    height: readNumber(config, CONFIG_KEY.height),
    showHex: readBoolean(config, CONFIG_KEY.showHex),
    namePrefix: readString(config, CONFIG_KEY.namePrefix),
    outputDir: storedOutputDir || fallbackOutputDir,
  })
}

/** 参数 → 写入插件配置的补丁（`api.config.set` 是浅合并，键名与 CONFIG_KEY 一致） */
export function optionsToConfig(options: ColorCardOptions): Record<string, unknown> {
  return {
    [CONFIG_KEY.color]: options.color,
    [CONFIG_KEY.width]: options.width,
    [CONFIG_KEY.height]: options.height,
    [CONFIG_KEY.showHex]: options.showHex,
    [CONFIG_KEY.namePrefix]: options.namePrefix,
    [CONFIG_KEY.outputDir]: options.outputDir,
  }
}
