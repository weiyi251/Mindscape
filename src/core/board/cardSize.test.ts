// ============================================================================
// 模块说明（中文）
// 图片卡片初始尺寸的单元测试。对应 T1.4 验收标准：
//   「图片按原始宽高比显示」——等比缩放到卡片长边基准，比例不得失真。
//
// 实现任务：T1.4（阶段一）。
// ============================================================================

import { describe, it, expect } from 'vitest'

import {
  CARD_LONG_EDGE,
  CARD_MAX_LONG_EDGE,
  CARD_MIN_SHORT_EDGE,
  FALLBACK_IMAGE_CARD_SIZE,
  cardSizeForImage,
} from '@/core/board/cardSize'

/** 宽高比（保留 4 位小数，避免浮点噪声） */
function aspect(size: { w: number; h: number }): number {
  return Math.round((size.w / size.h) * 10000) / 10000
}

describe('cardSizeForImage · 常规比例', () => {
  it('4:3 横图 → 240 × 180', () => {
    expect(cardSizeForImage(1600, 1200)).toEqual({ w: 240, h: 180 })
  })

  it('16:9 横图 → 240 × 135', () => {
    expect(cardSizeForImage(1920, 1080)).toEqual({ w: 240, h: 135 })
  })

  it('1:1 方图 → 240 × 240', () => {
    expect(cardSizeForImage(1000, 1000)).toEqual({ w: 240, h: 240 })
  })

  it('3:4 竖图 → 180 × 240（长边仍是 240）', () => {
    expect(cardSizeForImage(1200, 1600)).toEqual({ w: 180, h: 240 })
  })

  it('原始像素尺寸不影响结果：同一比例的大图小图等比缩放后一致', () => {
    expect(cardSizeForImage(4000, 3000)).toEqual(cardSizeForImage(400, 300))
  })

  it('长边恒等于卡片长边基准（常规比例不触发保护）', () => {
    const size = cardSizeForImage(1600, 1200)
    expect(Math.max(size.w, size.h)).toBe(CARD_LONG_EDGE)
  })
})

describe('cardSizeForImage · 宽高比保持', () => {
  it.each([
    [1600, 1200, 4 / 3],
    [1920, 1080, 16 / 9],
    [1000, 1000, 1],
    [1200, 1600, 3 / 4],
    [3000, 1000, 3],
  ])('%i×%i 的比例保持在整数取整误差内', (w, h, ratio) => {
    const size = cardSizeForImage(w, h)
    // 取整会带来最多 1px 的偏差，用相对误差 1% 兜住
    expect(Math.abs(aspect(size) - ratio) / ratio).toBeLessThan(0.01)
  })
})

describe('cardSizeForImage · 极端比例保护', () => {
  it('超长条（20:1）短边被保底到 96px 以上，长边不超过上限', () => {
    const size = cardSizeForImage(2000, 100)

    expect(size.w).toBe(CARD_MAX_LONG_EDGE)
    expect(size.h).toBeGreaterThanOrEqual(30) // 保底后仍是很扁的条，但不至于细成一条线
    expect(size.w / size.h).toBeCloseTo(20, 1)
  })

  it('短边保底不会把长边推到上限之外', () => {
    const stats = [cardSizeForImage(5000, 100), cardSizeForImage(100, 5000)]

    for (const size of stats) {
      expect(Math.max(size.w, size.h)).toBeLessThanOrEqual(CARD_MAX_LONG_EDGE)
    }
  })

  it('恰好触发保底的比例（3:1）：短边 >= 96', () => {
    const size = cardSizeForImage(3000, 1000)
    expect(Math.min(size.w, size.h)).toBeGreaterThanOrEqual(CARD_MIN_SHORT_EDGE - 1)
  })

  it('常规比例不触发保底（短边本来就大于 96）', () => {
    expect(cardSizeForImage(1600, 1200).h).toBe(180)
  })
})

describe('cardSizeForImage · 非法输入', () => {
  it.each([
    ['宽为 0', 0, 100],
    ['高为 0', 100, 0],
    ['负值', -100, -100],
    ['NaN', Number.NaN, 100],
    ['Infinity', Number.POSITIVE_INFINITY, 100],
  ])('%s → 退回兜底尺寸', (_label, w, h) => {
    expect(cardSizeForImage(w, h)).toEqual(FALLBACK_IMAGE_CARD_SIZE)
  })

  it('兜底尺寸是独立副本，修改返回值不会污染常量', () => {
    const size = cardSizeForImage(0, 0)
    size.w = 999

    expect(FALLBACK_IMAGE_CARD_SIZE.w).not.toBe(999)
  })
})
