// ============================================================================
// 模块说明（中文）
// 外观配置 → CSS 变量的映射与偏好持久化。
//
// 【CSS 变量族】（globals.css 的 .glass-panel / .glass-chip 消费）
//   --glass-alpha       玻璃底色不透明度
//   --glass-blur        覆盖层模糊半径（带 px 单位）
//   --glass-sat         模糊层饱和度增益
//   --glass-tint-light  浅色玻璃底色（R G B 三元组）
//   --glass-tint-dark   深色玻璃底色（R G B 三元组）
//   --glass-border      边框高光强度（CSS 侧在 .dark 下自动收敛为 0.4 倍）
//   --glass-shadow      阴影黑色不透明度
//   --glass-bg-dim      背景图遮罩强度
//
//   底色的深浅切换不经过 JS：JS 同时写 light/dark 两个变量，
//   globals.css 里 `:root { --glass-tint: var(--glass-tint-light) }`、
//   `.dark { --glass-tint: var(--glass-tint-dark) }` 按主题挑选 ——
//   切主题时无需重新 apply，深浅两个取色器也互不覆盖。
//
// 【持久化】localStorage（key: mindscape-appearance），与主题偏好同一先例：
//   偏好是低频小对象，不值得走 fs 落盘；读写都 try/catch，
//   隐私模式等场景降级为「本次会话生效」。
//
// applyGlassToCss 是本模块唯一的 DOM 副作用，且只接受 setProperty 目标，
// node 测试传桩即可覆盖；写入时机：main.tsx 渲染前一次 + store 每次改动。
// ============================================================================

import {
  GLASS_DEFAULTS,
  SHADOW_OPACITY,
  hexToRgbTriple,
  normalizeGlassAppearance,
} from './glassTypes'
import type { GlassAppearance } from './glassTypes'

/** 偏好在 localStorage 里的键（与 mindscape-theme 同一命名族） */
export const APPEARANCE_STORAGE_KEY = 'mindscape-appearance'

/** setProperty 目标的最小接口（document.documentElement 满足；测试传桩） */
interface CssVariableTarget {
  setProperty(name: string, value: string): void
}

/** 配置 → CSS 变量键值表（纯函数，测试主体；apply 只是把它逐条 setProperty） */
export function glassCssVariables(a: GlassAppearance): Record<string, string> {
  return {
    '--glass-alpha': String(a.alpha),
    '--glass-blur': `${a.blurPx}px`,
    '--glass-sat': String(a.saturate),
    // hex 解析失败（理论上游已归一，此处兜底）时回落默认色，绝不写 undefined
    '--glass-tint-light': hexToRgbTriple(a.tintLight) ?? hexToRgbTriple(GLASS_DEFAULTS.tintLight)!,
    '--glass-tint-dark': hexToRgbTriple(a.tintDark) ?? hexToRgbTriple(GLASS_DEFAULTS.tintDark)!,
    '--glass-border': String(a.borderAlpha),
    '--glass-shadow': String(SHADOW_OPACITY[a.shadow]),
    '--glass-bg-dim': String(a.bgDim),
    // 画布整面玻璃比面板更透：面板上要放文字，画布上浮的是自带实色底的卡片。
    // 取面板 alpha 的 0.4 倍并封顶 0.5 —— alpha 拉满时画布也不至于糊成一片。
    '--glass-canvas-alpha': String(Math.min(0.5, Math.round(a.alpha * 0.4 * 100) / 100)),
  }
}

/** 把配置落到文档根元素（settings 页拖滑杆时实时调用 → 全界面即时预览） */
export function applyGlassToCss(a: GlassAppearance, target: CssVariableTarget = documentStyle()): void {
  const variables = glassCssVariables(a)
  for (const [name, value] of Object.entries(variables)) {
    target.setProperty(name, value)
  }
}

function documentStyle(): CssVariableTarget {
  return document.documentElement.style
}

/** 读取持久化偏好；没有 / 坏 JSON / localStorage 不可用都回落默认 */
export function loadGlassAppearance(): GlassAppearance {
  try {
    const raw = localStorage.getItem(APPEARANCE_STORAGE_KEY)
    if (raw === null) return { ...GLASS_DEFAULTS }
    return normalizeGlassAppearance(JSON.parse(raw))
  } catch {
    return { ...GLASS_DEFAULTS }
  }
}

/** 持久化偏好；localStorage 不可用时静默降级为会话内生效（与 saveTheme 同一口径） */
export function saveGlassAppearance(a: GlassAppearance): void {
  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(a))
  } catch {
    // 忽略：隐私模式等场景
  }
}
