// ============================================================================
// 模块说明（中文）
// CardDragController 单元测试（T2.2 / T2.3）。
//
// vitest 环境是 node（无 DOM），因此：
//   · PointerEvent / HTMLElement 用最小形状的假对象代替；
//   · DOM 写入经 CardDragSource 注入，测试直接断言「写入了什么值」。
// 覆盖点：4px 判定（5.1）、屏幕→画布换算（17.4）、影子开关（11.6）、
// 松手回调（17.3：松手才交坐标）、cancel 回滚、并发保护、多选组拖动（11.2）。
// ============================================================================

import { describe, expect, it } from 'vitest'

import { CardDragController, DRAG_OPACITY, DRAG_THRESHOLD_PX } from './cardDragController'
import type { CardDragDelegate, CardDragSource } from './cardDragController'
import type { CardMoveDelta } from '@/core/commands/impl/moveCards'
import type { Point } from './coordinates'

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

interface Harness {
  controller: CardDragController
  positions: Map<string, Point>
  transforms: Map<string, Point>
  ghosts: Array<[string, boolean]>
  events: Array<Record<string, unknown>>
  setZoom(zoom: number): void
}

function createHarness(initial: Record<string, Point> = {}, zoom = 1): Harness {
  const positions = new Map(Object.entries(initial).map(([id, point]) => [id, { ...point }]))
  const transforms = new Map<string, Point>()
  const ghosts: Array<[string, boolean]> = []
  const events: Array<Record<string, unknown>> = []
  let currentZoom = zoom

  const source: CardDragSource = {
    getCardPosition: (cardId) => ({ ...(positions.get(cardId) ?? { x: 0, y: 0 }) }),
    setCardTransform: (cardId, x, y) => {
      transforms.set(cardId, { x, y })
    },
    setDragGhost: (cardId, active) => {
      ghosts.push([cardId, active])
    },
    getZoom: () => currentZoom,
  }

  const delegate: CardDragDelegate = {
    onDragStart: (cardIds) => events.push({ kind: 'start', cardIds }),
    onDragEnd: (moves: CardMoveDelta[]) => events.push({ kind: 'end', moves }),
    onClick: (cardId) => events.push({ kind: 'click', cardId }),
  }

  return {
    controller: new CardDragController(source, delegate),
    positions,
    transforms,
    ghosts,
    events,
    setZoom(value: number) {
      currentZoom = value
    },
  }
}

describe('CardDragController', () => {
  it('非左键按下不接管', () => {
    const harness = createHarness({ c1: { x: 10, y: 10 } })
    const handled = harness.controller.begin(
      fakePointer(1, 2, 100, 100),
      'c1',
      fakeElement(),
    )
    expect(handled).toBe(false)
  })

  it('已有拖拽进行中时忽略第二次按下', () => {
    const harness = createHarness({ c1: { x: 0, y: 0 }, c2: { x: 500, y: 500 } })
    expect(
      harness.controller.begin(fakePointer(1, 0, 0, 0), 'c1', fakeElement()),
    ).toBe(true)
    expect(
      harness.controller.begin(fakePointer(2, 0, 900, 900), 'c2', fakeElement()),
    ).toBe(false)
  })

  it('位移未超过 4px 松手判定为单击，不写 transform（5.1）', () => {
    const harness = createHarness({ c1: { x: 10, y: 20 } })
    harness.controller.begin(fakePointer(1, 0, 100, 100), 'c1', fakeElement())
    // 移动 3px（≤ 阈值），拖拽不应启动
    harness.controller.move(fakePointer(1, 0, 103, 100))
    harness.controller.end(fakePointer(1, 0, 103, 100))

    expect(harness.transforms.size).toBe(0)
    expect(harness.ghosts.length).toBe(0)
    expect(harness.events).toEqual([{ kind: 'click', cardId: 'c1' }])
  })

  it('阈值恰好等于 4px 仍视为手抖，5px 才启动拖拽', () => {
    const harness = createHarness({ c1: { x: 0, y: 0 } })
    harness.controller.begin(fakePointer(1, 0, 0, 0), 'c1', fakeElement())
    harness.controller.move(fakePointer(1, 0, DRAG_THRESHOLD_PX, 0))
    expect(harness.controller.isDragging).toBe(false)

    harness.controller.move(fakePointer(1, 0, DRAG_THRESHOLD_PX + 1, 0))
    expect(harness.controller.isDragging).toBe(true)
  })

  it('拖动中按「画布位移 = 屏幕位移 / zoom」直写 transform（17.4）', () => {
    const harness = createHarness({ c1: { x: 100, y: 50 } }, 2)
    harness.controller.begin(fakePointer(1, 0, 0, 0), 'c1', fakeElement())
    harness.controller.move(fakePointer(1, 0, 40, 20))

    // 屏幕 (40,20) ÷ zoom 2 → 画布位移 (20,10)
    expect(harness.transforms.get('c1')).toEqual({ x: 120, y: 60 })
  })

  it('缩小状态下拖动同样的屏幕距离移动更多画布距离', () => {
    const harness = createHarness({ c1: { x: 0, y: 0 } }, 0.5)
    harness.controller.begin(fakePointer(1, 0, 0, 0), 'c1', fakeElement())
    harness.controller.move(fakePointer(1, 0, 30, 0))

    expect(harness.transforms.get('c1')).toEqual({ x: 60, y: 0 })
  })

  it('松手时交出 from/to 并关闭影子（17.3：松手才交坐标）', () => {
    const harness = createHarness({ c1: { x: 10, y: 10 } }, 1)
    harness.controller.begin(fakePointer(1, 0, 0, 0), 'c1', fakeElement())
    harness.controller.move(fakePointer(1, 0, 15, 25))
    harness.controller.move(fakePointer(1, 0, 30, 40))
    harness.controller.end(fakePointer(1, 0, 30, 40))

    expect(harness.ghosts).toEqual([
      ['c1', true],
      ['c1', false],
    ])
    expect(harness.events).toEqual([
      { kind: 'start', cardIds: ['c1'] },
      {
        kind: 'end',
        moves: [
          // 屏幕位移 (30,40)，zoom 1 → 画布坐标 = 按下位置 (10,10) + 位移
          { id: 'c1', from: { x: 10, y: 10 }, to: { x: 40, y: 50 } },
        ],
      },
    ])
    // 状态机复位：可以立刻开始下一次拖拽
    expect(harness.controller.isDragging).toBe(false)
    expect(harness.controller.activeCardId).toBeNull()
  })

  it('多选拖动：随动卡保持组内相对位置（11.2）', () => {
    const harness = createHarness({
      main: { x: 100, y: 100 },
      side: { x: 400, y: 200 }, // 与主卡相对位置 (300, 100)
    }, 2)
    harness.controller.begin(
      fakePointer(1, 0, 0, 0),
      'main',
      fakeElement(),
      ['side'],
    )
    harness.controller.move(fakePointer(1, 0, 60, 30))
    harness.controller.end(fakePointer(1, 0, 60, 30))

    // 屏幕 (60,30) ÷ zoom 2 → 画布位移 (30,15)
    expect(harness.transforms.get('main')).toEqual({ x: 130, y: 115 })
    expect(harness.transforms.get('side')).toEqual({ x: 430, y: 215 })

    const endEvent = harness.events.find((event) => event.kind === 'end')
    expect(endEvent?.moves).toEqual([
      { id: 'main', from: { x: 100, y: 100 }, to: { x: 130, y: 115 } },
      { id: 'side', from: { x: 400, y: 200 }, to: { x: 430, y: 215 } },
    ])
  })

  it('多选拖动的 cancel 整组回滚', () => {
    const harness = createHarness({
      main: { x: 0, y: 0 },
      side: { x: 100, y: 100 },
    }, 1)
    harness.controller.begin(fakePointer(1, 0, 0, 0), 'main', fakeElement(), ['side'])
    harness.controller.move(fakePointer(1, 0, 50, 50))
    harness.controller.cancel()

    expect(harness.transforms.get('main')).toEqual({ x: 0, y: 0 })
    expect(harness.transforms.get('side')).toEqual({ x: 100, y: 100 })
    expect(harness.ghosts.filter(([, active]) => !active).length).toBe(2)
  })

  it('pointercancel 丢弃拖拽并把卡片 DOM 恢复到按下位置', () => {
    const harness = createHarness({ c1: { x: 5, y: 5 } }, 1)
    harness.controller.begin(fakePointer(1, 0, 0, 0), 'c1', fakeElement())
    harness.controller.move(fakePointer(1, 0, 50, 50))
    expect(harness.transforms.get('c1')).toEqual({ x: 55, y: 55 })

    harness.controller.cancel()

    expect(harness.transforms.get('c1')).toEqual({ x: 5, y: 5 })
    expect(harness.ghosts).toEqual([
      ['c1', true],
      ['c1', false],
    ])
    expect(harness.events).toEqual([{ kind: 'start', cardIds: ['c1'] }])
  })

  it('影子透明度走常量（10.3：用 opacity 而非重绘）', () => {
    expect(Number(DRAG_OPACITY)).toBeGreaterThan(0)
    expect(Number(DRAG_OPACITY)).toBeLessThan(1)
  })

  it('pointerId 不匹配的 move / end 被忽略', () => {
    const harness = createHarness({ c1: { x: 0, y: 0 } })
    harness.controller.begin(fakePointer(1, 0, 0, 0), 'c1', fakeElement())

    harness.controller.move(fakePointer(99, 0, 100, 100))
    harness.controller.end(fakePointer(99, 0, 100, 100))

    expect(harness.events).toEqual([])
    // 仍在拖拽中（真正的指针还没松开）
    expect(harness.controller.activeCardId).toBe('c1')
  })
})
