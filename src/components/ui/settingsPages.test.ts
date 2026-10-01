// ============================================================================
// 模块说明（中文）
// 设置页注册表按平台裁剪的单元测试（2026-09-21 移动端适配 M1）。
// 纯数据 + 纯函数，node 环境直接断言，不需要渲染。
// ============================================================================

import { describe, expect, it } from 'vitest'

import { SETTINGS_PAGES, visibleSettingsPages } from './settingsPages'

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; M2012K11AC Build/UKQ1) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36'
const WINDOWS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0'

const idsOf = (userAgent: string) => visibleSettingsPages(userAgent).map((page) => page.id)

describe('visibleSettingsPages', () => {
  it('桌面：四页齐全且顺序不变（外观页插入第二位）', () => {
    expect(idsOf(WINDOWS_UA)).toEqual(['shortcuts', 'appearance', 'update', 'plugins'])
  })

  it('Android：快捷键页与更新页整页隐藏，剩外观与插件两页', () => {
    expect(idsOf(ANDROID_UA)).toEqual(['appearance', 'plugins'])
  })

  it('默认页取第一张可见页（移动端不会停在快捷键页上）', () => {
    expect(visibleSettingsPages(ANDROID_UA)[0].id).toBe('appearance')
  })

  it('上次选的页在移动端不可见时回落到第一张可见页', () => {
    const pages = visibleSettingsPages(ANDROID_UA)
    const active = pages.find((page) => page.id === 'shortcuts') ?? pages[0]

    expect(active.id).toBe('appearance')
  })
})

describe('SETTINGS_PAGES 注册表', () => {
  it('每页都有 id、中文页签文案与组件', () => {
    for (const page of SETTINGS_PAGES) {
      expect(page.id).toBeTruthy()
      expect(page.label.length).toBeGreaterThan(0)
      expect(typeof page.Component).toBe('function')
    }
  })

  it('id 不重复（否则页签 key 与回落逻辑都会错乱）', () => {
    expect(new Set(SETTINGS_PAGES.map((page) => page.id)).size).toBe(SETTINGS_PAGES.length)
  })
})
