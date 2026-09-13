// ============================================================================
// 模块说明（中文）
// CardResizeController（缩放手柄）单元测试（T2.3；四向边缩放为 2026-09-13 增补）。
// ============================================================================

import { describe, expect, it } from 'vitest'

import {
  CardResizeController,
  edgeResizeOutcome,
  MIN_CARD_SIZE,
  ratioLockedSize,
} from './cardResizeController'
import type { CardResizeEdge, CardResizeSource } from './cardResizeController'

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

function createHarness(
  initialSize = { w: 240, h: 180 },
  zoom = 1,
  aspectRatio: number | null = null,
  initialPos = { x: 100, y: 80 },
) {
  const sizes: Array<{ id: string; w: number; h: number }> = []
  const positions: Array<{ id: string; x: number; y: number }> = []
  const events: Array<Record<string, unknown>> = []
  let currentZoom = zoom

  const source: CardResizeSource = {
    getCardSize: () => ({ ...initialSize }),
    setCardSize: (cardId, w, h) => sizes.push({ id: cardId, w, h }),
    getCardPosition: () => ({ ...initialPos }),
    setCardPosition: (cardId, x, y) => positions.push({ id: cardId, x, y }),
    getZoom: () => currentZoom,
    getAspectRatio: () => aspectRatio,
  }
  const delegate = {
    onResizeStart: (cardId: string) => events.push({ kind: 'start', cardId }),
    onResizeEnd: (
      cardId: string,
      from: { w: number; h: number },
      to: { w: number; h: number },
      position?: { from: { x: number; y: number }; to: { x: number; y: number } },
    ) => events.push({ kind: 'end', cardId, from, to, position }),
  }

  return {
    controller: new CardResizeController(source, delegate),
    sizes,
    positions,
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

// ---------------------------------------------------------------------------
// 四向边缩放（2026-09-13）：便签支持上/下/左/右边中点手柄
// ---------------------------------------------------------------------------

describe('edgeResizeOutcome（纯函数）', () => {
  const start = { x: 100, y: 80, w: 240, h: 180 }

  it('e：左上角固定，宽随位移增长', () => {
    expect(edgeResizeOutcome(start, 'e', 60, 30)).toEqual({ x: 100, y: 80, w: 300, h: 180 })
  })

  it('s：左上角固定，高随位移增长', () => {
    expect(edgeResizeOutcome(start, 's', 60, 30)).toEqual({ x: 100, y: 80, w: 240, h: 210 })
  })

  it('w：右边缘固定，宽收缩时 x 右移联动', () => {
    // 向右拖 60 → 宽 240-60=180，x = 100 + (240-180) = 160（右缘 340 不动）
    expect(edgeResizeOutcome(start, 'w', 60, 0)).toEqual({ x: 160, y: 80, w: 180, h: 180 })
  })

  it('n：下边缘固定，高收缩时 y 下移联动', () => {
    // 向下拖 30 → 高 180-30=150，y = 80 + (180-150) = 110（下缘 260 不动）
    expect(edgeResizeOutcome(start, 'n', 0, 30)).toEqual({ x: 100, y: 110, w: 240, h: 150 })
  })

  it('w 向左拖（放大）：x 左移，右缘仍固定', () => {
    // 宽 240+60=300，x = 100 + (240-300) = 40（右缘 340 不动）
    expect(edgeResizeOutcome(start, 'w', -60, 0)).toEqual({ x: 40, y: 80, w: 300, h: 180 })
  })

  it('n 向上拖（放大）：y 上移，下缘仍固定', () => {
    expect(edgeResizeOutcome(start, 'n', 0, -30)).toEqual({ x: 100, y: 50, w: 240, h: 210 })
  })

  it('w 拖过头被 MIN 抬回时位置同步停住（不会滑走）', () => {
    // 向右拖 500 → 宽被钳在 40，x = 100 + (240-40) = 300
    const outcome = edgeResizeOutcome(start, 'w', 500, 0)
    expect(outcome.w).toBe(MIN_CARD_SIZE)
    expect(outcome.x).toBe(start.x + (start.w - MIN_CARD_SIZE))
  })

  it('n 拖过头被 MIN 抬回时位置同步停住', () => {
    const outcome = edgeResizeOutcome(start, 'n', 0, 500)
    expect(outcome.h).toBe(MIN_CARD_SIZE)
    expect(outcome.y).toBe(start.y + (start.h - MIN_CARD_SIZE))
  })

  it('se：位置不变（历史行为）', () => {
    expect(edgeResizeOutcome(start, 'se', 60, 30)).toEqual({ x: 100, y: 80, w: 300, h: 210 })
  })

  it('非法位移（NaN）不产生 NaN 尺寸', () => {
    const outcome = edgeResizeOutcome(start, 'e', Number.NaN, 0)
    expect(outcome.w).toBe(MIN_CARD_SIZE)
  })

  it('每条边只动自己那一轴（拖 e 不改高、拖 s 不改宽）', () => {
    expect(edgeResizeOutcome(start, 'e', 100, 100).h).toBe(start.h)
    expect(edgeResizeOutcome(start, 's', 100, 100).w).toBe(start.w)
  })
})

describe('CardResizeController · 四向边缩放', () => {
  it('e 手柄：只改宽，位置不动，delegate 不带 position', () => {
    const harness = createHarness(undefined, 1, null, { x: 100, y: 80 })
    harness.controller.begin(fakePointer(1, 0, 0, 0), 'c1', fakeElement(), 'e')
    harness.controller.move(fakePointer(1, 0, 60, 0))
    harness.controller.end(fakePointer(1, 0, 60, 0))

    expect(harness.sizes.at(-1)).toEqual({ id: 'c1', w: 300, h: 180 })
    expect(harness.positions).toEqual([]) // 位置没变：不直写 transform
    expect(harness.events.at(-1)).toEqual({
      kind: 'end',
      cardId: 'c1',
      from: { w: 240, h: 180 },
      to: { w: 300, h: 180 },
      position: undefined,
    })
  })

  it('w 手柄：宽度与位置联动直写 DOM，松手交出位置快照', () => {
    const harness = createHarness(undefined, 1, null, { x: 100, y: 80 })
    harness.controller.begin(fakePointer(1, 0, 0, 0), 'c1', fakeElement(), 'w')
    harness.controller.move(fakePointer(1, 0, 60, 0))
    harness.controller.end(fakePointer(1, 0, 60, 0))

    expect(harness.sizes.at(-1)).toEqual({ id: 'c1', w: 180, h: 180 })
    expect(harness.positions.at(-1)).toEqual({ id: 'c1', x: 160, y: 80 })
    expect(harness.events.at(-1)).toMatchObject({
      kind: 'end',
      to: { w: 180, h: 180 },
      position: { from: { x: 100, y: 80 }, to: { x: 160, y: 80 } },
    })
  })

  it('n 手柄：高度与位置联动，zoom 参与换算', () => {
    const harness = createHarness(undefined, 2, null, { x: 100, y: 80 })
    harness.controller.begin(fakePointer(1, 0, 0, 0), 'c1', fakeElement(), 'n')
    // 屏幕向下拖 60 ÷ zoom 2 → 画布 30 → 高 150，y 110
    harness.controller.move(fakePointer(1, 0, 0, 60))
    harness.controller.end(fakePointer(1, 0, 0, 60))

    expect(harness.sizes.at(-1)).toEqual({ id: 'c1', w: 240, h: 150 })
    expect(harness.positions.at(-1)).toEqual({ id: 'c1', x: 100, y: 110 })
  })

  it('n 手柄拖过头：尺寸钳在 MIN，位置同步停住', () => {
    const harness = createHarness(undefined, 1, null, { x: 100, y: 80 })
    harness.controller.begin(fakePointer(1, 0, 0, 0), 'c1', fakeElement(), 'n')
    harness.controller.move(fakePointer(1, 0, 0, 500))
    harness.controller.end(fakePointer(1, 0, 0, 500))

    expect(harness.sizes.at(-1)).toEqual({ id: 'c1', w: 240, h: MIN_CARD_SIZE })
    expect(harness.positions.at(-1)).toEqual({ id: 'c1', x: 100, y: 80 + 180 - MIN_CARD_SIZE })
  })

  it('边手柄不锁比例：即便 getAspectRatio 有值（防御）也走自由缩放', () => {
    const harness = createHarness({ w: 240, h: 180 }, 1, 16 / 9)
    harness.controller.begin(fakePointer(1, 0, 0, 0), 'c1', fakeElement(), 'e')
    harness.controller.move(fakePointer(1, 0, 60, 0))

    // 若误走锁比例分支，高度会跟着宽变 —— 边手柄只应动单轴
    expect(harness.sizes.at(-1)).toEqual({ id: 'c1', w: 300, h: 180 })
  })

  it('边手柄 cancel：恢复按下时的尺寸与位置', () => {
    const harness = createHarness(undefined, 1, null, { x: 100, y: 80 })
    harness.controller.begin(fakePointer(1, 0, 0, 0), 'c1', fakeElement(), 'w')
    harness.controller.move(fakePointer(1, 0, 60, 0))
    harness.controller.cancel()

    expect(harness.sizes.at(-1)).toEqual({ id: 'c1', w: 240, h: 180 })
    expect(harness.positions.at(-1)).toEqual({ id: 'c1', x: 100, y: 80 })
    expect(harness.controller.isResizing).toBe(false)
  })

  it('边手柄原地点一下：尺寸位置均不变，不产生命令', () => {
    const harness = createHarness(undefined, 1, null, { x: 100, y: 80 })
    harness.controller.begin(fakePointer(1, 0, 10, 10), 'c1', fakeElement(), 'w')
    harness.controller.end(fakePointer(1, 0, 10, 10))

    expect(harness.events).toEqual([{ kind: 'start', cardId: 'c1' }])
    expect(harness.sizes.at(-1)).toEqual({ id: 'c1', w: 240, h: 180 })
    expect(harness.positions).toEqual([])
  })

  it('begin 缺省 edge 为 se（旧调用零改动）', () => {
    const harness = createHarness({ w: 240, h: 180 }, 1, null)
    harness.controller.begin(fakePointer(1, 0, 0, 0), 'c1', fakeElement())
    harness.controller.move(fakePointer(1, 0, 60, 30))

    expect(harness.sizes.at(-1)).toEqual({ id: 'c1', w: 300, h: 210 })
    expect(harness.positions).toEqual([])
  })
})

// 类型守卫：CardResizeEdge 枚举成员齐全（编译期即校验，运行期做一次形状断言）
describe('CardResizeEdge', () => {
  it('覆盖 n / s / e / w / se 五个方向', () => {
    const edges: CardResizeEdge[] = ['n', 's', 'e', 'w', 'se']
    expect(new Set(edges).size).toBe(5)
  })
})
