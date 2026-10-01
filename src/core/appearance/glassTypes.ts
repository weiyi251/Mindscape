// ============================================================================
// 模块说明（中文）
// 毛玻璃外观的可调参数：类型、默认值、取值范围与归一化（2026-10-01 用户需求：
// 「高度自定义的毛玻璃风格」，设置 → 外观）。
//
// 可调项一览（作用范围见 glassAppearance.ts 的 .glass-panel / .glass-chip）：
//   alpha       面板不透明度 0.05 ~ 0.95，默认 0.75 —— 直接决定玻璃「透多少」；
//               取 0.75 是可读性下限的实测权衡：米白玻璃叠纯黑背景时，
//               近黑文字的对比度仍 ≥ 5:1（WCAG AA）。
//   blurPx      模糊强度 0 ~ 40 px，默认 14 —— **只作用于覆盖层浮窗**（打开时
//               画布不交互）；画布常驻小浮件一律不模糊（17.11 教训：
//               backdrop-filter 落在高频重绘区域上 WebView2 会严重掉帧）。
//   saturate    模糊层的饱和度增益 1 ~ 2，默认 1.15 —— 毛玻璃「透亮感」来源，
//               1 = 与背景同饱和。
//   tintLight   浅色模式玻璃底色（hex，默认 #F8F6F2，第十二章米白基调微提净）。
//   tintDark    深色模式玻璃底色（hex，默认 #262321，与 .dark 背景 --background
//               同族暖炭，玻璃叠在内容上时保持同一气质）。
//   borderAlpha 边框高光强度 0 ~ 1，默认 0.55（0 = 无边框）；边框恒为白色高光，
//               深色模式由 CSS 把强度自动收敛到 0.4 倍（白边在暗底上会扎眼）。
//   shadow      阴影档位 none / soft / medium / strong，默认 medium。
//   bgDim       背景图遮罩强度 0 ~ 0.6，默认 0.3 —— 黑色遮罩压暗背景图，
//               保证画布分区文字与顶栏在花哨壁纸上仍可读。
//
// 存储口径：偏好整体存 localStorage（与主题偏好同一先例，见 glassAppearance.ts）；
// 背景图文件本体存 %APPDATA%\Mindscape\appearance\（fs:scope 白名单内），
// 偏好里只记**文件名** —— 资源绝对路径不落盘（用户裁决）。
//
// 本文件是纯函数 + 常量，node 环境可测。hex 字面量出现在这里是「给用户挑的
// 数据」（与 partitions.ts 的分区调色板同一豁免口径，architecture 规则 3）。
// ============================================================================

/** 阴影档位（设置页的四个档位按钮） */
export type GlassShadowLevel = 'none' | 'soft' | 'medium' | 'strong'

/** 毛玻璃外观完整配置（localStorage 里的形态与之逐字段对应） */
export interface GlassAppearance {
  /** 玻璃面板不透明度（0.05 ~ 0.95） */
  alpha: number
  /** 覆盖层模糊半径（0 ~ 40 px） */
  blurPx: number
  /** 模糊层饱和度增益（1 ~ 2） */
  saturate: number
  /** 浅色模式玻璃底色（#rrggbb 小写） */
  tintLight: string
  /** 深色模式玻璃底色（#rrggbb 小写） */
  tintDark: string
  /** 边框高光强度（0 ~ 1，0 为无边框） */
  borderAlpha: number
  /** 阴影档位 */
  shadow: GlassShadowLevel
  /** 背景图文件名（相对 %APPDATA%\Mindscape\appearance\）；null = 未设置 */
  bgFileName: string | null
  /** 背景图黑色遮罩强度（0 ~ 0.6） */
  bgDim: number
}

/** 默认外观：出来即是协调的毛玻璃观感，深浅两色都可直接使用 */
export const GLASS_DEFAULTS: GlassAppearance = {
  alpha: 0.75,
  blurPx: 14,
  saturate: 1.15,
  tintLight: '#f8f6f2',
  tintDark: '#262321',
  borderAlpha: 0.55,
  shadow: 'medium',
  bgFileName: null,
  bgDim: 0.3,
}

/** 各数值参数的取值范围（设置页滑杆的 min/max 也从这里取，保证两处一致） */
export const GLASS_LIMITS = {
  alpha: { min: 0.05, max: 0.95 },
  blurPx: { min: 0, max: 40 },
  saturate: { min: 1, max: 2 },
  borderAlpha: { min: 0, max: 1 },
  bgDim: { min: 0, max: 0.6 },
} as const

/** 阴影档位清单（设置页档位按钮的渲染顺序） */
export const SHADOW_LEVELS: readonly GlassShadowLevel[] = ['none', 'soft', 'medium', 'strong']

/** 阴影档位 → box-shadow 里的黑色不透明度 */
export const SHADOW_OPACITY: Record<GlassShadowLevel, number> = {
  none: 0,
  soft: 0.1,
  medium: 0.2,
  strong: 0.32,
}

/**
 * 把用户手选/取色器给出的 hex 归一成 `R G B` 空格三元组（CSS 变量的存储形态，
 * 与 globals.css 语义变量的 `H S% L%` 三元组约定同思路）。
 * 不是合法 #rrggbb 时返回 null（调用方回落默认值）。
 */
export function hexToRgbTriple(hex: unknown): string | null {
  if (typeof hex !== 'string') return null
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return null
  const n = Number.parseInt(m[1], 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}

/** 数值收敛：非数值或越界时取「贴边值」（越界收进范围）而不是默认 —— 手改配置文件只该被拦住，不该被吞 */
export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

/** hex 收敛：非法时回落指定默认色 */
export function normalizeHexColor(value: unknown, fallback: string): string {
  return hexToRgbTriple(value) !== null ? (value as string).trim().toLowerCase() : fallback
}

/**
 * 任意来源（localStorage JSON / 未来同步）的原始对象 → 完整合法配置。
 * 缺字段回落默认（向前兼容：老版本存档没有新字段），坏字段收进范围或回落。
 */
export function normalizeGlassAppearance(raw: unknown): GlassAppearance {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const shadow = SHADOW_LEVELS.includes(source.shadow as GlassShadowLevel)
    ? (source.shadow as GlassShadowLevel)
    : GLASS_DEFAULTS.shadow
  const bg = source.bgFileName
  return {
    alpha: clampNumber(source.alpha, GLASS_LIMITS.alpha.min, GLASS_LIMITS.alpha.max, GLASS_DEFAULTS.alpha),
    blurPx: clampNumber(
      source.blurPx,
      GLASS_LIMITS.blurPx.min,
      GLASS_LIMITS.blurPx.max,
      GLASS_DEFAULTS.blurPx,
    ),
    saturate: clampNumber(
      source.saturate,
      GLASS_LIMITS.saturate.min,
      GLASS_LIMITS.saturate.max,
      GLASS_DEFAULTS.saturate,
    ),
    tintLight: normalizeHexColor(source.tintLight, GLASS_DEFAULTS.tintLight),
    tintDark: normalizeHexColor(source.tintDark, GLASS_DEFAULTS.tintDark),
    borderAlpha: clampNumber(
      source.borderAlpha,
      GLASS_LIMITS.borderAlpha.min,
      GLASS_LIMITS.borderAlpha.max,
      GLASS_DEFAULTS.borderAlpha,
    ),
    shadow,
    bgFileName: typeof bg === 'string' && bg.length > 0 ? bg : null,
    bgDim: clampNumber(source.bgDim, GLASS_LIMITS.bgDim.min, GLASS_LIMITS.bgDim.max, GLASS_DEFAULTS.bgDim),
  }
}
