// ============================================================================
// 模块说明（中文）
// CardResizeController（右下角手柄缩放）单元测试（T2.3）。
// ============================================================================

import { describe, expect, it } from 'vitest'

import { CardResizeController, MIN_CARD_SIZE } from './cardResizeController'
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

function createHarness(initialSize = { w: 240, h: 180 }, zoom = 1) {
  const sizes: Array<{ id: string; w: number; h: number }> = []
  const events: Array<Record<string, unknown>> = []
  let currentZoom = zoom

  const source: CardResizeSource = {
    getCardSize: () => ({ ...initialSize }),
    setCardSize: (cardId, w, h) => sizes.push({ id: cardId, w, h }),
    getZoom: () => currentZoom,
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
