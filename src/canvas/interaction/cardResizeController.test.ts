// ============================================================================
// 模块说明（中文）
// CardResizeController（右下角手柄缩放）单元测试（T2.3）。
// ============================================================================

import { describe, expect, it } from 'vitest'

import { CardResizeController, MIN_CARD_SIZE, ratioLockedSize } from './cardResizeController'
import type { CardResizeSource } from './cardResizeController'

function fakePointer(pointerId: number, button: number, clientX: number, clientY: number) {
  return { pointerId, button, clientX, clientY } as PointerEvent
}

function fakeElement() {
  return {
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    hasPointerCapture: () => true,
  } as unknown as HTMLElement
}

function createHarness(initialSize = { w: 240, h: 180 }, zoom = 1, aspectRatio: number | null = null) {
  const sizes: Array<{ id: string; w: number; h: number }> = []
  const events: Array<Record<string, unknown>> = []
  let currentZoom = zoom

  const source: CardResizeSource = {
    getCardSize: () => ({ ...initialSize }),
    setCardSize: (cardId, w, h) => sizes.push({ id: cardId, w, h }),
    getZoom: () => currentZoom,
    getAspectRatio: () => aspectRatio,
  }
  const delegate = {
    onResizeStart: (cardId: string) => events.push({ kind: 'start', cardId }),
    onResizeEnd: (cardId: string, from: { w: number; h: number }, to: { w: number; h: number }) =>
      events.push({ kind: 'end', cardId, from, to }),
  }

  return {
    controller: new CardResizeController(source, delegate),
    sizes,
    events,
    setZoom: (value: number) => {
      currentZoom = value
    },
  }
}

describe('CardResizeController', () => {
  it('非左键按下不接管', () => {
    const harness = createHarness()
    expect(harness.controller.begin(fakePointer(1, 2, 0, 0), 'c1', fakeElement())).toBe(false)
  })

  it('拖手柄按屏幕位移 / zoom 增大宽高，松手交出 from/to', () => {
    const harness = createHarness({ w: 240, h: 180 }, 2)
    harness.controller.begin(fakePointer(1, 0, 0, 0), 'c1', fakeElement())
    harness.controller.move(fakePointer(1, 0, 100, 60))
    harness.controller.end(fakePointer(1, 0, 100, 60))

    // 屏幕 (100,60) ÷ zoom 2 → 画布增量 (50,30)
    expect(harness.sizes.at(-1)).toEqual({ id: 'c1', w: 290, h: 210 })
    expect(harness.events).toEqual([
      { kind: 'start', cardId: 'c1' },
      { kind: 'end', cardId: 'c1', from: { w: 240, h: 180 }, to: { w: 290, h: 210 } },
    ])
  })

  it('宽高不会被缩到最小尺寸以下', () => {
    const harness = createHarness({ w: 100, h: 100 }, 1)
    harness.controller.begin(fakePointer(1, 0, 0, 0), 'c1', fakeElement())
    // 向左上拖 500px → 尺寸应被钳在 MIN_CARD_SIZE
    harness.controller.move(fakePointer(1, 0, -500, -500))
    harness.controller.end(fakePointer(1, 0, -500, -500))

    expect(harness.sizes.at(-1)).toEqual({ id: 'c1', w: MIN_CARD_SIZE, h: MIN_CARD_SIZE })
  })

  it('按下后未移动就松手：尺寸不变，不产生命令', () => {
    const harness = createHarness()
    harness.controller.begin(fakePointer(1, 0, 10, 10), 'c1', fakeElement())
    harness.controller.end(fakePointer(1, 0, 10, 10))

    expect(harness.events).toEqual([{ kind: 'start', cardId: 'c1' }])
    expect(harness.sizes.at(-1)).toEqual({ id: 'c1', w: 240, h: 180 })
  })

  it('cancel 恢复按下时的尺寸', () => {
    const harness = createHarness()
    harness.controller.begin(fakePointer(1, 0, 0, 0), 'c1', fakeElement())
    harness.controller.move(fakePointer(1, 0, 80, 40))
    harness.controller.cancel()

    expect(harness.sizes.at(-1)).toEqual({ id: 'c1', w: 240, h: 180 })
    expect(harness.controller.isResizing).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 比例锁定（2026-09-12）：图片卡片缩放必须保持原图宽高比
// ---------------------------------------------------------------------------

describe('ratioLockedSize（纯函数）', () => {
  it('横向为主导轴时：宽由位移决定，高按比例推出', () => {
    // 16:9 卡片 240×135，向右拖 120 → 宽 360，高 = 360 / (16/9) = 202.5 → 203
    expect(ratioLockedSize({ w: 240, h: 135 }, 16 / 9, 120, 0)).toEqual({ w: 360, h: 203 })
  })

  it('纵向为主导轴时：高由位移决定，宽按比例推出', () => {
    // 16:9 卡片 240×135，向下拖 90（相对变化 90/135=0.67 > 0/240）→ 高 225，宽 = 225 × 16/9 = 400
    expect(ratioLockedSize({ w: 240, h: 135 }, 16 / 9, 0, 90)).toEqual({ w: 400, h: 225 })
  })

  it('两轴同时拖动时取相对变化更大的那一轴（不会出现非线性放大）', () => {
    // 相对变化：宽 60/240 = 0.25，高 45/135 = 0.33 → 高度主导
    const size = ratioLockedSize({ w: 240, h: 135 }, 16 / 9, 60, 45)
    expect(size.h).toBe(180)
    expect(size.w).toBe(320)
  })

  it('缩到极小时按短边保底，且比例不破', () => {
    const size = ratioLockedSize({ w: 240, h: 135 }, 16 / 9, -10000, -10000)
    // 高保底 MIN_CARD_SIZE，宽 = MIN × 16/9 = 71.1 → 71
    expect(size).toEqual({ w: 71, h: MIN_CARD_SIZE })
    expect(Math.abs(size.w / size.h - 16 / 9)).toBeLessThan(0.05)
  })

  it('竖图（比例 < 1）缩到极小时宽保底，高按比例推出', () => {
    // 3:4 竖图 → 比例 0.75；宽保底 40 → 高 = 40 / 0.75 = 53.33 → 53
    expect(ratioLockedSize({ w: 180, h: 240 }, 3 / 4, -10000, -10000)).toEqual({ w: 40, h: 53 })
  })

  it('极端全景比例（20:1）缩小时不会变成看不见的细线', () => {
    const size = ratioLockedSize({ w: 720, h: 36 }, 20, -10000, -10000)
    expect(size.h).toBeGreaterThanOrEqual(MIN_CARD_SIZE)
    expect(Math.abs(size.w / size.h - 20)).toBeLessThan(0.6)
  })

  it('非法比例（0 / NaN）时退回按下时的尺寸，不产生 NaN', () => {
    expect(ratioLockedSize({ w: 240, h: 135 }, 0, 50, 50)).toEqual({ w: 240, h: 135 })
    expect(ratioLockedSize({ w: 240, h: 135 }, Number.NaN, 50, 50)).toEqual({ w: 240, h: 135 })
  })
})

describe('CardResizeController · 比例锁定', () => {
  it('有比例时：宽度主导 → 高度按原图比例跟着变，不出现自由拉伸', () => {
    const harness = createHarness({ w: 240, h: 135 }, 1, 16 / 9)
    harness.controller.begin(fakePointer(1, 0, 0, 0), 'c1', fakeElement())
    harness.controller.move(fakePointer(1, 0, 120, 30))
    harness.controller.end(fakePointer(1, 0, 120, 30))

    // 相对变化：宽 120/240=0.5 > 高 30/135=0.22 → 宽度主导 → 360×203
    expect(harness.sizes.at(-1)).toEqual({ id: 'c1', w: 360, h: 203 })
    expect(harness.events.at(-1)).toMatchObject({
      kind: 'end',
      from: { w: 240, h: 135 },
      to: { w: 360, h: 203 },
    })
  })

  it('有比例时：zoom 换算后再算比例（屏幕位移 ≠ 画布位移）', () => {
    const harness = createHarness({ w: 240, h: 135 }, 2, 16 / 9)
    harness.controller.begin(fakePointer(1, 0, 0, 0), 'c1', fakeElement())
    // 屏幕拖 (240,0) ÷ zoom 2 → 画布增量 120 → 宽 360
    harness.controller.move(fakePointer(1, 0, 240, 0))

    expect(harness.sizes.at(-1)).toEqual({ id: 'c1', w: 360, h: 203 })
  })

  it('无比例（非图片卡片）时保持自由缩放', () => {
    const harness = createHarness({ w: 240, h: 135 }, 1, null)
    harness.controller.begin(fakePointer(1, 0, 0, 0), 'c1', fakeElement())
    harness.controller.move(fakePointer(1, 0, 120, 30))

    expect(harness.sizes.at(-1)).toEqual({ id: 'c1', w: 360, h: 165 })
  })
})
