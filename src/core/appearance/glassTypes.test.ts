// ============================================================================
// 模块说明（中文）
// glassTypes.ts 的单元测试（node 环境，零 DOM）。
// 锁默认值快照、hex 解析、越界收敛与坏数据归一化 —— 外观参数是「设置页滑杆
// min/max」与「CSS 变量写入」的共同上游，这里守不住，两处会一起漂。
// ============================================================================

import { describe, expect, it } from 'vitest'

import {
  GLASS_DEFAULTS,
  GLASS_LIMITS,
  SHADOW_LEVELS,
  SHADOW_OPACITY,
  clampNumber,
  hexToRgbTriple,
  normalizeGlassAppearance,
  normalizeHexColor,
} from './glassTypes'

describe('GLASS_DEFAULTS 默认外观', () => {
  it('与设计定稿逐字段一致（改动默认值必须显式改这里留痕）', () => {
    expect(GLASS_DEFAULTS).toEqual({
      alpha: 0.75,
      blurPx: 14,
      saturate: 1.15,
      tintLight: '#f8f6f2',
      tintDark: '#262321',
      borderAlpha: 0.55,
      shadow: 'medium',
      bgFileName: null,
      bgDim: 0.3,
    })
  })

  it('默认值全部落在各自取值范围内', () => {
    expect(GLASS_DEFAULTS.alpha).toBeGreaterThanOrEqual(GLASS_LIMITS.alpha.min)
    expect(GLASS_DEFAULTS.alpha).toBeLessThanOrEqual(GLASS_LIMITS.alpha.max)
    expect(GLASS_DEFAULTS.blurPx).toBeGreaterThanOrEqual(GLASS_LIMITS.blurPx.min)
    expect(GLASS_DEFAULTS.blurPx).toBeLessThanOrEqual(GLASS_LIMITS.blurPx.max)
    expect(GLASS_DEFAULTS.saturate).toBeGreaterThanOrEqual(GLASS_LIMITS.saturate.min)
    expect(GLASS_DEFAULTS.saturate).toBeLessThanOrEqual(GLASS_LIMITS.saturate.max)
    expect(GLASS_DEFAULTS.borderAlpha).toBeGreaterThanOrEqual(GLASS_LIMITS.borderAlpha.min)
    expect(GLASS_DEFAULTS.borderAlpha).toBeLessThanOrEqual(GLASS_LIMITS.borderAlpha.max)
    expect(GLASS_DEFAULTS.bgDim).toBeGreaterThanOrEqual(GLASS_LIMITS.bgDim.min)
    expect(GLASS_DEFAULTS.bgDim).toBeLessThanOrEqual(GLASS_LIMITS.bgDim.max)
  })
})

describe('hexToRgbTriple', () => {
  it('六位 hex 拆成 R G B 三元组', () => {
    expect(hexToRgbTriple('#f8f6f2')).toBe('248 246 242')
    expect(hexToRgbTriple('#000000')).toBe('0 0 0')
    expect(hexToRgbTriple('#FFFFFF')).toBe('255 255 255')
  })

  it('非 hex 输入一律 null（调用方回落默认色）', () => {
    expect(hexToRgbTriple('')).toBeNull()
    expect(hexToRgbTriple('#fff')).toBeNull()
    expect(hexToRgbTriple('#gggggg')).toBeNull()
    expect(hexToRgbTriple('rgb(1,2,3)')).toBeNull()
    expect(hexToRgbTriple(123)).toBeNull()
    expect(hexToRgbTriple(null)).toBeNull()
  })
})

describe('clampNumber / normalizeHexColor', () => {
  it('越界收进范围而不是吞成默认（手改配置只被拦住）', () => {
    expect(clampNumber(1.5, 0.05, 0.95, 0.75)).toBe(0.95)
    expect(clampNumber(-2, 0.05, 0.95, 0.75)).toBe(0.05)
    expect(clampNumber('0.5', 0.05, 0.95, 0.75)).toBe(0.75)
    expect(clampNumber(Number.NaN, 0, 40, 14)).toBe(14)
  })

  it('hex 非法回落默认，合法则归一成小写', () => {
    expect(normalizeHexColor('#ABCDEF', '#f8f6f2')).toBe('#abcdef')
    expect(normalizeHexColor('bad', '#f8f6f2')).toBe('#f8f6f2')
  })
})

describe('normalizeGlassAppearance', () => {
  it('空对象 / 非对象 → 全默认（首次启用与新装一致）', () => {
    expect(normalizeGlassAppearance({})).toEqual(GLASS_DEFAULTS)
    expect(normalizeGlassAppearance(null)).toEqual(GLASS_DEFAULTS)
    expect(normalizeGlassAppearance('垃圾数据')).toEqual(GLASS_DEFAULTS)
  })

  it('合法字段保留，越界字段收进范围', () => {
    const result = normalizeGlassAppearance({
      alpha: 0.4,
      blurPx: 99,
      saturate: 0.5,
      tintLight: '#FFEECC',
      shadow: 'strong',
    })
    expect(result.alpha).toBe(0.4)
    expect(result.blurPx).toBe(40)
    expect(result.saturate).toBe(1)
    expect(result.tintLight).toBe('#ffeecc')
    expect(result.shadow).toBe('strong')
    // 未给出的字段回落默认
    expect(result.tintDark).toBe(GLASS_DEFAULTS.tintDark)
    expect(result.bgFileName).toBeNull()
  })

  it('坏枚举与坏文件名回落（阴影档位、背景文件名）', () => {
    const result = normalizeGlassAppearance({ shadow: '超大', bgFileName: '' })
    expect(result.shadow).toBe(GLASS_DEFAULTS.shadow)
    expect(result.bgFileName).toBeNull()
  })

  it('背景文件名只收非空字符串（防手改 localStorage 塞对象）', () => {
    expect(normalizeGlassAppearance({ bgFileName: 'wallpaper.png' }).bgFileName).toBe('wallpaper.png')
    expect(normalizeGlassAppearance({ bgFileName: 42 }).bgFileName).toBeNull()
  })
})

describe('档位表', () => {
  it('SHADOW_LEVELS 顺序即设置页按钮顺序，四档都有对应不透明度', () => {
    expect(SHADOW_LEVELS).toEqual(['none', 'soft', 'medium', 'strong'])
    for (const level of SHADOW_LEVELS) {
      expect(SHADOW_OPACITY[level]).toBeGreaterThanOrEqual(0)
      expect(SHADOW_OPACITY[level]).toBeLessThanOrEqual(1)
    }
  })
})
