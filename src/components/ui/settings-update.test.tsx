// ============================================================================
// 模块说明（中文）
// 「版本更新」页的双端分流测试（node 环境，renderToStaticMarkup + 替身）。
// 与 settings-appearance.test.tsx 同一套手法：静态渲染不跑 useEffect，
// getVersion / invoke 都不会被真正调用。
//
// 锁三件事（2026-10-03 移动端放开更新页）：
//   1. 桌面走 updater 检查按钮；移动端走「打开发布页」引导（updater 插件移动端不存在）；
//   2. 移动端即使 store 里残留 available 状态也不渲染「最新版本」行（不误导用户）；
//   3. 两个分支用 data-settings-update 标记区分 —— 标题与按钮文案同名，
//      只看文本无法区分分流是否生效。
// ============================================================================

import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { SETTINGS_TEXT } from './settingsText'
import { SettingsUpdatePage } from './settings-update'

/** 替身状态：由用例改写（vi.mock 工厂提升，经可变对象间接传值） */
const runtimeMock: { mobile: boolean } = { mobile: false }
const updaterMock: { status: string; version: string | null } = { status: 'idle', version: null }

vi.mock('@/core/utils/runtime', () => ({
  isMobileRuntime: () => runtimeMock.mobile,
}))

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: async () => '0.10.0',
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => undefined),
}))

vi.mock('@/core/store/updaterStore', () => ({
  useUpdaterStore: (selector: (state: never) => unknown) =>
    selector({
      status: updaterMock.status,
      version: updaterMock.version,
      check: () => undefined,
    } as never),
}))

const render = () => renderToStaticMarkup(<SettingsUpdatePage />)

afterEach(() => {
  runtimeMock.mobile = false
  updaterMock.status = 'idle'
  updaterMock.version = null
})

describe('版本更新页的双端分流', () => {
  it('桌面：渲染 updater 检查按钮，不渲染移动端引导', () => {
    const html = render()
    expect(html).toContain('data-settings-update="desktop"')
    expect(html).toContain(SETTINGS_TEXT.checkNow)
    expect(html).not.toContain(SETTINGS_TEXT.updateMobileHint)
    expect(html).not.toContain(SETTINGS_TEXT.openReleasePage)
  })

  it('移动端：渲染发布页引导，不渲染检查按钮（updater 插件移动端不存在）', () => {
    runtimeMock.mobile = true
    const html = render()
    expect(html).toContain('data-settings-update="mobile"')
    expect(html).toContain(SETTINGS_TEXT.updateMobileHint)
    expect(html).toContain(SETTINGS_TEXT.openReleasePage)
    expect(html).toContain(SETTINGS_TEXT.currentVersion)
    expect(html).not.toContain('data-settings-update="desktop"')
  })

  it('移动端即使 store 残留 available 状态也不显示「最新版本」行（不误导用户）', () => {
    runtimeMock.mobile = true
    updaterMock.status = 'available'
    updaterMock.version = '0.11.0'
    const html = render()
    expect(html).not.toContain(SETTINGS_TEXT.latestVersion)
    expect(html).not.toContain('v0.11.0')
  })

  it('桌面发现新版时显示最新版本行', () => {
    updaterMock.status = 'available'
    updaterMock.version = '0.11.0'
    const html = render()
    expect(html).toContain(SETTINGS_TEXT.latestVersion)
    expect(html).toContain('v0.11.0')
  })
})
