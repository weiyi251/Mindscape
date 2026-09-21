// ============================================================================
// 模块说明（中文）
// platformCapabilities（平台能力表）的单元测试：
// 两套 UA 取值各自命中对应能力表、undefined 放行、默认参数确实读 navigator。
// 环境为 node（无 jsdom），故一律用注入 UA 的方式驱动纯函数。
// ============================================================================

import { afterEach, describe, expect, it, vi } from 'vitest'

import { platformCapabilities, supportsCapability } from './platformCapabilities'

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; M2012K11AC Build/UKQ1) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36'
const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1'
const WINDOWS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('platformCapabilities', () => {
  it('桌面 UA：八项里只有触屏手势关闭（现状零回归，画布仍走鼠标 + 快捷键）', () => {
    expect(platformCapabilities(WINDOWS_UA)).toEqual({
      keyboardShortcuts: true,
      autoUpdate: true,
      revealInExplorer: true,
      pointerHover: true,
      touchGestures: false,
      dragAndDropImport: true,
      systemClipboardFiles: true,
      folderPicker: true,
    })
  })

  it('Android UA：桌面专属能力全关，只剩触屏手势开着', () => {
    expect(platformCapabilities(ANDROID_UA)).toEqual({
      keyboardShortcuts: false,
      autoUpdate: false,
      revealInExplorer: false,
      pointerHover: false,
      touchGestures: true,
      dragAndDropImport: false,
      systemClipboardFiles: false,
      folderPicker: false,
    })
  })

  it('M4 三项：关闭的正是移动端的三条替代入口（选择器 / 应用内剪贴板 / 数据目录）', () => {
    expect(supportsCapability('dragAndDropImport', ANDROID_UA)).toBe(false)
    expect(supportsCapability('systemClipboardFiles', ANDROID_UA)).toBe(false)
    expect(supportsCapability('folderPicker', ANDROID_UA)).toBe(false)
  })

  it('iOS UA 同样按移动端取值（iOS 后置，但表先按平台而非按系统版本分）', () => {
    expect(platformCapabilities(IOS_UA).autoUpdate).toBe(false)
  })

  it('空 UA（node 单测 / 浏览器直接打开 dev 地址）按桌面取值', () => {
    expect(platformCapabilities('').keyboardShortcuts).toBe(true)
    // ⚠️ 这条尤其重要：拿不到 UA 时必须是桌面，否则浏览器里调试会误开触屏手势
    expect(platformCapabilities('').touchGestures).toBe(false)
  })

  it('不传参数时读 navigator.userAgent', () => {
    vi.stubGlobal('navigator', { userAgent: ANDROID_UA })
    expect(platformCapabilities().revealInExplorer).toBe(false)
  })
})

describe('supportsCapability', () => {
  it('undefined 表示无需平台能力，任何环境放行', () => {
    expect(supportsCapability(undefined, ANDROID_UA)).toBe(true)
    expect(supportsCapability(undefined, WINDOWS_UA)).toBe(true)
  })

  it('按能力名查表', () => {
    expect(supportsCapability('autoUpdate', WINDOWS_UA)).toBe(true)
    expect(supportsCapability('autoUpdate', ANDROID_UA)).toBe(false)
  })

  it('不传参数时读 navigator.userAgent', () => {
    vi.stubGlobal('navigator', { userAgent: ANDROID_UA })
    expect(supportsCapability('keyboardShortcuts')).toBe(false)
  })
})
