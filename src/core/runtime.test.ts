// ============================================================================
// 模块说明（中文）
// 运行环境判定的单元测试。对应 T1.1 修复：
//   「在浏览器里打开 dev 地址时，错误提示必须是中文且能照做，
//     而不是 Cannot read properties of undefined (reading 'invoke')」
//
// 实现任务：T1.1 修复（阶段一）。
// ============================================================================

import { afterEach, describe, expect, it, vi } from 'vitest'

import { DESKTOP_ONLY_MESSAGE, assertDesktopRuntime, isDesktopRuntime } from '@/core/runtime'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isDesktopRuntime', () => {
  it('没有 window（单元测试 / SSR）→ false', () => {
    expect(typeof window).toBe('undefined')
    expect(isDesktopRuntime()).toBe(false)
  })

  it('浏览器环境（window 上没有 __TAURI_INTERNALS__）→ false', () => {
    vi.stubGlobal('window', { location: { href: 'http://localhost:1173/' } })
    expect(isDesktopRuntime()).toBe(false)
  })

  it('桌面窗口（注入 __TAURI_INTERNALS__）→ true', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: { invoke: () => undefined } })
    expect(isDesktopRuntime()).toBe(true)
  })

  it('__TAURI_INTERNALS__ 为 null 也算非桌面（防御异常注入）', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: null })
    expect(isDesktopRuntime()).toBe(false)
  })
})

describe('assertDesktopRuntime', () => {
  it('非桌面环境 → 抛出中文说明，且说明里包含可执行的启动命令', () => {
    vi.stubGlobal('window', {})

    expect(() => assertDesktopRuntime()).toThrow(DESKTOP_ONLY_MESSAGE)
    expect(DESKTOP_ONLY_MESSAGE).toContain('桌面应用')
    expect(DESKTOP_ONLY_MESSAGE).toContain('pnpm tauri dev')
    // 不出现英文底层报错
    expect(DESKTOP_ONLY_MESSAGE).not.toContain('invoke')
  })

  it('桌面环境 → 不抛错', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
    expect(() => assertDesktopRuntime()).not.toThrow()
  })
})
