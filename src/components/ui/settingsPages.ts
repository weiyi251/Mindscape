// ============================================================================
// 模块说明（中文）
// 设置面板的页面注册表与「按平台可见性」（2026-09-21 移动端适配 M1）。
//
// 为什么单独成文件（与 settingsText.ts 同一先例）：
//   ①注册表含常量与纯函数，留在组件文件里会触发 react-refresh 告警；
//   ②可见性是纯逻辑，必须能在 node 环境（无 jsdom）下直接断言 ——
//     「移动端隐藏了哪几页」是平台能力表的第一个真实消费方，不该只靠真机验收。
//
// 新增设置页：只在 SETTINGS_PAGES 加一项；若该页依赖桌面能力，补 `requires`。
// ============================================================================

import { SettingsAppearancePage } from './settings-appearance'
import { SettingsPluginsPage } from './settings-plugins'
import { SettingsShortcutsPage } from './settings-shortcuts'
import { SettingsUpdatePage } from './settings-update'
import { SETTINGS_TEXT, APPEARANCE_TEXT } from './settingsText'
import { currentUserAgent } from '@/core/utils/runtime'
import { supportsCapability } from '@/core/system/platformCapabilities'
import type { PlatformCapability } from '@/core/system/platformCapabilities'
import type { ReactNode } from 'react'

/** 设置页标识（新增页面时在这里补一个字面量） */
export type SettingsPageId = 'appearance' | 'shortcuts' | 'update' | 'plugins'

export interface SettingsPage {
  id: SettingsPageId
  /** 左侧页签文案 */
  label: string
  Component: () => ReactNode
  /** 该页依赖的平台能力；缺省表示任何环境都显示 */
  requires?: PlatformCapability
}

/** 全部设置页（顺序即页签顺序，第一项是默认页） */
export const SETTINGS_PAGES: SettingsPage[] = [
  {
    id: 'shortcuts',
    label: SETTINGS_TEXT.pageShortcuts,
    Component: SettingsShortcutsPage,
    requires: 'keyboardShortcuts',
  },
  // 外观页双端可见（无 requires）：毛玻璃与壁纸在桌面 / 安卓上都可调
  { id: 'appearance', label: APPEARANCE_TEXT.pageAppearance, Component: SettingsAppearancePage },
  { id: 'update', label: SETTINGS_TEXT.pageUpdate, Component: SettingsUpdatePage, requires: 'autoUpdate' },
  { id: 'plugins', label: SETTINGS_TEXT.pagePlugins, Component: SettingsPluginsPage },
]

/**
 * 当前平台可见的设置页。移动端剩「外观」与「插件」：
 * 没有物理键盘（快捷键页无意义）、APK 侧载没有 updater 渠道（更新页无意义）。
 */
export function visibleSettingsPages(userAgent: string = currentUserAgent()): SettingsPage[] {
  return SETTINGS_PAGES.filter((page) => supportsCapability(page.requires, userAgent))
}
