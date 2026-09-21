// ============================================================================
// 模块说明（中文）
// 平台能力表（2026-09-21 移动端适配 M1，对应 docs/移动端适配计划.md §3 M1）。
//
// 为什么要有这张表：Tauri 移动端**同样**注入 `window.__TAURI_INTERNALS__`，
// 于是 `isDesktopRuntime()` 在安卓返回 true —— 全项目 30+ 处
// `assertDesktopRuntime()` / `!isDesktopRuntime()` 分支在移动端全部走桌面路径，
// 文件夹对话框、文件管理器定位、自动更新一个都拦不住。「不是桌面」≠「是移动」，
// 所以平台差异一律查本表，判定入口是 `isMobileRuntime()`（看 UserAgent）。
//
// 用法约定：调用处只写 `supportsCapability('xxx')`，**不要**在业务代码里
// 自己写 `!isMobileRuntime()`；新增差异项时在下表两套取值里各加一行。
//
// 分层：纯函数（userAgent 可注入，node 环境可单测，不碰 DOM）。
// ============================================================================

import { currentUserAgent, isMobileRuntime } from '@/core/utils/runtime'

/**
 * 需要按平台裁剪的能力。
 * M1 先收口三项（快捷键页 / 自动更新 / 文件管理器定位）；
 * M2（手势、悬停）与 M4（文件夹选择器、拖入、跨应用文件剪贴板）再往里加。
 */
export type PlatformCapability = 'keyboardShortcuts' | 'autoUpdate' | 'revealInExplorer'

const CAPABILITY_TABLE: Record<'desktop' | 'mobile', Record<PlatformCapability, boolean>> = {
  desktop: { keyboardShortcuts: true, autoUpdate: true, revealInExplorer: true },
  mobile: {
    // 触屏没有物理键盘，自定义快捷键页在移动端没有意义
    keyboardShortcuts: false,
    // APK 侧载分发渠道没有 updater 机制（计划 §0.2 第 3 项、§6 第一版不做清单）
    autoUpdate: false,
    // Android 没有「在资源管理器中选中该文件」这一概念（opener 的 reveal_item_in_dir 无移动端实现）
    revealInExplorer: false,
  },
}

/** 当前平台的能力取值（注入 userAgent 便于单测） */
export function platformCapabilities(
  userAgent: string = currentUserAgent(),
): Record<PlatformCapability, boolean> {
  return isMobileRuntime(userAgent) ? CAPABILITY_TABLE.mobile : CAPABILITY_TABLE.desktop
}

/**
 * 某项能力是否可用。传 `undefined` 表示「该功能无需平台能力」，任何环境都放行 ——
 * 方便调用方把它接到可选的 `requires` 字段上（见 components/ui/settings-panel.tsx）。
 */
export function supportsCapability(
  capability: PlatformCapability | undefined,
  userAgent: string = currentUserAgent(),
): boolean {
  if (!capability) return true
  return platformCapabilities(userAgent)[capability]
}
