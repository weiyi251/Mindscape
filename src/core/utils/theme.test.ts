// ============================================================================
// 模块说明（中文）
// 主题模块的单元测试（2026-09-11 用户裁决「深色模式 + 偏好记忆」）。
// node 环境无 localStorage / document：stub 后固化「读写往返 + class 切换」行为。
// ============================================================================

import { describe, expect, it, vi, beforeEach } from 'vitest'

import { applyTheme, loadTheme, saveTheme, toggleTheme } from './theme'

const storage = new Map<string, string>()

beforeEach(() => {
  storage.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
  })
  vi.stubGlobal('document', {
    documentElement: { classList: { toggle: vi.fn() } },
  })
})

describe('主题偏好（load / save / toggle / apply）', () => {
  it('没有保存过 → 默认浅色', () => {
    expect(loadTheme()).toBe('light')
  })

  it('save 后 load 往返一致', () => {
    saveTheme('dark')
    expect(loadTheme()).toBe('dark')
    saveTheme('light')
    expect(loadTheme()).toBe('light')
  })

  it('保存了非法值 → 兜底浅色', () => {
    storage.set('mindscape-theme', 'blue')
    expect(loadTheme()).toBe('light')
  })

  it('toggle 在深 / 浅之间往返', () => {
    expect(toggleTheme('light')).toBe('dark')
    expect(toggleTheme('dark')).toBe('light')
  })

  it('applyTheme 按主题增删 html 的 dark 类', () => {
    const toggle = vi.fn()
    vi.stubGlobal('document', { documentElement: { classList: { toggle } } })

    applyTheme('dark')
    expect(toggle).toHaveBeenLastCalledWith('dark', true)

    applyTheme('light')
    expect(toggle).toHaveBeenLastCalledWith('dark', false)
  })
})
