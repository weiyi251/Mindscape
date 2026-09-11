// ============================================================================
// 模块说明（中文）
// 坐标换算单元测试。对应 17.4「坐标系换算（必须统一）」：
// 逐条验证文档给出的两条公式，以及 11.3「以鼠标位置为中心缩放」的锚点不变性。
//
// 实现任务：T0.11（准备层）。
// ============================================================================

import { describe, it, expect } from 'vitest'

import {
  MIN_ZOOM,
  MAX_ZOOM,
  ZOOM_DAMPING_RATIO,
  ZOOM_OVERSHOOT_LIMIT,
  clampZoom,
  dampZoom,
  screenToCanvas,
  canvasToScreen,
  wheelZoomTarget,
  zoomAroundScreenPoint,
  zoomFromWheelDelta,
  distanceBetween,
} from '@/canvas/interaction/coordinates'
import type { ContainerOrigin, ViewportState } from '@/canvas/interaction/coordinates'

const ORIGIN: ContainerOrigin = { left: 0, top: 0 }
const ORIGIN_OFFSET: ContainerOrigin = { left: 120, top: 60 }

function vp(zoom: number, offsetX = 0, offsetY = 0): ViewportState {
  return { zoom, offsetX, offsetY }
}

describe('clampZoom', () => {
  it('钳制到 11.3 规定的 10% ~ 400%', () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM)
    expect(clampZoom(0.05)).toBe(MIN_ZOOM)
    expect(clampZoom(9)).toBe(MAX_ZOOM)
    expect(clampZoom(1)).toBe(1)
    expect(clampZoom(2.5)).toBe(2.5)
  })

  it('NaN 回落到 100%，±Infinity 按方向钳到边界', () => {
    expect(clampZoom(Number.NaN)).toBe(1)
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(MAX_ZOOM)
    expect(clampZoom(Number.NEGATIVE_INFINITY)).toBe(MIN_ZOOM)
  })
})

describe('screenToCanvas / canvasToScreen', () => {
  it('zoom=1 且 offset=0 且容器在原点时，两者是恒等映射', () => {
    const p = { x: 300, y: 200 }
    expect(screenToCanvas(p, vp(1), ORIGIN)).toEqual(p)
    expect(canvasToScreen(p, vp(1), ORIGIN)).toEqual(p)
  })

  it('按 17.4 的公式换算（含容器左上角偏移）', () => {
    // 画布坐标 = (屏幕 - 容器左上角 - offset) / zoom
    // 屏幕 (500, 400)、容器 (120, 60)、offset (80, 20)、zoom 2
    // → ((500-120-80)/2, (400-60-20)/2) = (150, 160)
    expect(screenToCanvas({ x: 500, y: 400 }, vp(2, 80, 20), ORIGIN_OFFSET)).toEqual({
      x: 150,
      y: 160,
    })

    // 反算：150*2+80+120 = 500 ；160*2+20+60 = 400
    expect(canvasToScreen({ x: 150, y: 160 }, vp(2, 80, 20), ORIGIN_OFFSET)).toEqual({
      x: 500,
      y: 400,
    })
  })

  it('两个方向互为逆运算（多组取值）', () => {
    const cases: Array<[ViewportState, ContainerOrigin]> = [
      [vp(0.1, 33, -12), ORIGIN],
      [vp(1, 0, 0), ORIGIN_OFFSET],
      [vp(3.7, -220, 140), ORIGIN_OFFSET],
      [vp(4, 1000, -800), { left: -50, top: 25 }],
    ]

    for (const [viewport, origin] of cases) {
      const screen = { x: 640, y: 360 }
      const back = canvasToScreen(screenToCanvas(screen, viewport, origin), viewport, origin)
      expect(back.x).toBeCloseTo(screen.x, 6)
      expect(back.y).toBeCloseTo(screen.y, 6)
    }
  })
})

describe('zoomAroundScreenPoint', () => {
  it('锚点下的画布坐标在缩放前后保持不变（11.3 的核心要求）', () => {
    const viewport = vp(1, 40, 30)
    const anchor = { x: 600, y: 350 }
    const before = screenToCanvas(anchor, viewport, ORIGIN)

    const next = zoomAroundScreenPoint(viewport, 2.5, anchor, ORIGIN)
    const after = screenToCanvas(anchor, next, ORIGIN)

    expect(next.zoom).toBe(2.5)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  it('连续多级缩放后锚点仍然不动', () => {
    const anchor = { x: 200, y: 500 }
    let viewport = vp(1)
    const before = screenToCanvas(anchor, viewport, ORIGIN)

    for (const zoom of [1.2, 1.8, 2.6, 4, 3, 0.7, 0.2]) {
      viewport = zoomAroundScreenPoint(viewport, zoom, anchor, ORIGIN)
      const now = screenToCanvas(anchor, viewport, ORIGIN)
      expect(now.x).toBeCloseTo(before.x, 6)
      expect(now.y).toBeCloseTo(before.y, 6)
    }
  })

  it('目标倍率超范围时按 10%~400% 钳制', () => {
    const next = zoomAroundScreenPoint(vp(1), 99, { x: 0, y: 0 }, ORIGIN)
    expect(next.zoom).toBe(MAX_ZOOM)
  })

  it('zoom=1、offset=0 时缩放不会移动视图原点', () => {
    const next = zoomAroundScreenPoint(vp(1), 2, { x: 0, y: 0 }, ORIGIN)
    expect(next).toEqual({ zoom: 2, offsetX: 0, offsetY: 0 })
  })
})

describe('zoomFromWheelDelta', () => {
  it('deltaY 为 0 时不改变缩放', () => {
    expect(zoomFromWheelDelta(1.5, 0)).toBe(1.5)
  })

  it('滚轮向上（deltaY < 0）放大，向下（deltaY > 0）缩小', () => {
    expect(zoomFromWheelDelta(1, -100)).toBeGreaterThan(1)
    expect(zoomFromWheelDelta(1, 100)).toBeLessThan(1)
  })

  it('等距离的上下滚动可精确抵消（指数映射的对称性）', () => {
    const zoomed = zoomFromWheelDelta(zoomFromWheelDelta(1, -120), 120)
    expect(zoomed).toBeCloseTo(1, 6)
  })

  it('结果始终落在 10% ~ 400% 内', () => {
    expect(zoomFromWheelDelta(1, -100000)).toBe(MAX_ZOOM)
    expect(zoomFromWheelDelta(1, 100000)).toBe(MIN_ZOOM)
  })
})

describe('distanceBetween', () => {
  it('计算两点欧氏距离', () => {
    expect(distanceBetween({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
    expect(distanceBetween({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// T1.5：缩放边界阻尼
// ---------------------------------------------------------------------------

describe('dampZoom（11.3「到边界有阻尼感」）', () => {
  it('合法范围内原样返回，不做任何衰减', () => {
    expect(dampZoom(1)).toBe(1)
    expect(dampZoom(MIN_ZOOM)).toBe(MIN_ZOOM)
    expect(dampZoom(MAX_ZOOM)).toBe(MAX_ZOOM)
    expect(dampZoom(2.5)).toBe(2.5)
  })

  it('略微越过上限 → 小幅越界（推得动，但明显变沉）', () => {
    const damped = dampZoom(MAX_ZOOM * 1.1)

    expect(damped).toBeGreaterThan(MAX_ZOOM)
    // 理想越界 10% 经 0.3 衰减 → 3%
    expect(damped).toBeCloseTo(MAX_ZOOM * (1 + 0.1 * ZOOM_DAMPING_RATIO), 6)
    expect(damped).toBeLessThan(MAX_ZOOM * (1 + ZOOM_OVERSHOOT_LIMIT))
  })

  it('大幅越过上限 → 越界量被钳在 ZOOM_OVERSHOOT_LIMIT（推到头就推不动了）', () => {
    expect(dampZoom(MAX_ZOOM * 2)).toBeCloseTo(MAX_ZOOM * (1 + ZOOM_OVERSHOOT_LIMIT), 6)
    expect(dampZoom(999)).toBeCloseTo(MAX_ZOOM * (1 + ZOOM_OVERSHOOT_LIMIT), 6)
  })

  it('越过下限 → 同样被阻尼，最多缩到边界内 8%', () => {
    expect(dampZoom(MIN_ZOOM * 0.5)).toBeCloseTo(MIN_ZOOM * (1 - ZOOM_OVERSHOOT_LIMIT), 6)
    expect(dampZoom(0.001)).toBeCloseTo(MIN_ZOOM * (1 - ZOOM_OVERSHOOT_LIMIT), 6)
  })

  it('越界量随目标单调增大，不会出现反直觉的跳变', () => {
    const samples = [MAX_ZOOM, MAX_ZOOM * 1.02, MAX_ZOOM * 1.2, MAX_ZOOM * 5]

    for (let i = 1; i < samples.length; i += 1) {
      expect(dampZoom(samples[i])).toBeGreaterThanOrEqual(dampZoom(samples[i - 1]))
    }
  })

  it('非法值交给 clampZoom 处理（不参与阻尼）', () => {
    expect(dampZoom(Number.NaN)).toBe(1)
    expect(dampZoom(Number.POSITIVE_INFINITY)).toBe(MAX_ZOOM)
    expect(dampZoom(Number.NEGATIVE_INFINITY)).toBe(MIN_ZOOM)
    expect(dampZoom(0)).toBe(MIN_ZOOM)
    expect(dampZoom(-2)).toBe(MIN_ZOOM)
  })
})

describe('wheelZoomTarget（未钳制的滚轮目标）', () => {
  it('deltaY 为 0 时保持当前缩放', () => {
    expect(wheelZoomTarget(1.5, 0)).toBe(1.5)
  })

  it('与 zoomFromWheelDelta 仅在越界时才不同（后者会钳制）', () => {
    expect(wheelZoomTarget(1, -100)).toBeCloseTo(zoomFromWheelDelta(1, -100), 10)

    // 越界时：未钳制的目标远大于上限，钳制后的结果等于上限
    expect(wheelZoomTarget(1, -100000)).toBeGreaterThan(MAX_ZOOM)
    expect(zoomFromWheelDelta(1, -100000)).toBe(MAX_ZOOM)
  })

  it('上滚放大、下滚缩小', () => {
    expect(wheelZoomTarget(1, -50)).toBeGreaterThan(1)
    expect(wheelZoomTarget(1, 50)).toBeLessThan(1)
  })
})
