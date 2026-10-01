// ============================================================================
// 模块说明（中文）
// glassAppearance.ts 的单元测试（node 环境，无 DOM）。
// 重点锁「配置 → CSS 变量」的映射快照与 localStorage 读写的容错口径。
// ============================================================================

import { afterEach, describe, expect, it, vi } from 'vitest'

import { GLASS_DEFAULTS } from './glassTypes'
import {
  APPEARANCE_STORAGE_KEY,
  applyGlassToCss,
  glassCssVariables,
  loadGlassAppearance,
  saveGlassAppearance,
} from './glassAppearance'

describe('glassCssVariables 配置 → CSS 变量', () => {
  it('默认配置映射快照（改动映射必须显式更新这里）', () => {
    expect(glassCssVariables(GLASS_DEFAULTS)).toEqual({
      '--glass-alpha': '0.75',
      '--glass-blur': '14px',
      '--glass-sat': '1.15',
      '--glass-tint-light': '248 246 242',
      '--glass-tint-dark': '38 35 33',
      '--glass-border': '0.55',
      '--glass-shadow': '0.2',
      '--glass-bg-dim': '0.3',
    })
  })

  it('自定义配置全量生效（blur 带 px 单位，阴影档位转不透明度）', () => {
    const variables = glassCssVariables({
      ...GLASS_DEFAULTS,
      alpha: 0.5,
      blurPx: 0,
      saturate: 2,
      tintLight: '#aabbcc',
      tintDark: '#112233',
      borderAlpha: 0,
      shadow: 'strong',
      bgDim: 0.6,
    })
    expect(variables['--glass-alpha']).toBe('0.5')
    expect(variables['--glass-blur']).toBe('0px')
    expect(variables['--glass-sat']).toBe('2')
    expect(variables['--glass-tint-light']).toBe('170 187 204')
    expect(variables['--glass-tint-dark']).toBe('17 34 51')
    expect(variables['--glass-border']).toBe('0')
    expect(variables['--glass-shadow']).toBe('0.32')
    expect(variables['--glass-bg-dim']).toBe('0.6')
  })
})

describe('applyGlassToCss', () => {
  it('把全部变量逐条 setProperty 到目标（测试传桩，不碰 document）', () => {
    const written: Record<string, string> = {}
    applyGlassToCss(GLASS_DEFAULTS, {
      setProperty: (name, value) => {
        written[name] = value
      },
    })
    expect(Object.keys(written)).toHaveLength(8)
    expect(written['--glass-alpha']).toBe('0.75')
  })
})

describe('localStorage 读写', () => {
  /** 与主题测试同款的最小 localStorage 替身 */
  let backing: Map<string, string> | null = null

  function installStorage(): void {
    backing = new Map()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => ({
        getItem: (key: string) => backing!.get(key) ?? null,
        setItem: (key: string, value: string) => void backing!.set(key, value),
        removeItem: (key: string) => void backing!.delete(key),
      }),
    })
  }

  afterEach(() => {
    vi.restoreAllMocks()
    delete (globalThis as { localStorage?: unknown }).localStorage
    backing = null
  })

  it('save 后 load 原样回来（round-trip）', () => {
    installStorage()
    const custom = { ...GLASS_DEFAULTS, alpha: 0.4, blurPx: 30, shadow: 'soft' as const }
    saveGlassAppearance(custom)
    expect(loadGlassAppearance()).toEqual(custom)
    expect(backing!.get(APPEARANCE_STORAGE_KEY)).toContain('"alpha":0.4')
  })

  it('没有存档时返回默认（不是共享引用）', () => {
    installStorage()
    const loaded = loadGlassAppearance()
    expect(loaded).toEqual(GLASS_DEFAULTS)
    expect(loaded).not.toBe(GLASS_DEFAULTS)
  })

  it('坏 JSON 回落默认；写不进（隐私模式）静默降级不抛错', () => {
    installStorage()
    backing!.set(APPEARANCE_STORAGE_KEY, '{{{不是 JSON')
    expect(loadGlassAppearance()).toEqual(GLASS_DEFAULTS)

    vi.spyOn(console, 'error').mockImplementation(() => {})
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('隐私模式')
      },
    })
    expect(() => saveGlassAppearance(GLASS_DEFAULTS)).not.toThrow()
    expect(loadGlassAppearance()).toEqual(GLASS_DEFAULTS)
  })
})
