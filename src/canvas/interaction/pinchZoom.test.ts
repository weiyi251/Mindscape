import { describe, expect, it } from 'vitest'

import {
  MIN_PINCH_SPAN_PX,
  pinchMidpoint,
  pinchSpan,
  pinchViewportState,
} from './pinchZoom'
import { MAX_ZOOM, MIN_ZOOM, screenToCanvas } from './coordinates'
import type { ContainerOrigin, Point, ViewportState } from './coordinates'

const ORIGIN: ContainerOrigin = { left: 0, top: 0 }
const SHIFTED_ORIGIN: ContainerOrigin = { left: 120, top: 80 }

const START: ViewportState = { zoom: 1, offsetX: 0, offsetY: 0 }

function point(x: number, y: number): Point {
  return { x, y }
}

/** 浮点比较：缩放链路上全是乘除，toEqual 会因为 1e-13 的尾差假失败 */
function expectSamePoint(actual: Point, expected: Point): void {
  expect(actual.x).toBeCloseTo(expected.x, 6)
  expect(actual.y).toBeCloseTo(expected.y, 6)
}

describe('pinchSpan / pinchMidpoint', () => {
  it('间距就是两点欧氏距离', () => {
    expect(pinchSpan(point(0, 0), point(30, 40))).toBe(50)
  })

  it('中点取算术平均（不做整数取整）', () => {
    expect(pinchMidpoint(point(10, 20), point(11, 24))).toEqual({ x: 10.5, y: 22 })
  })
})

describe('pinchViewportState：缩放分量', () => {
  it('两指张开到 2 倍 → zoom 翻倍，且中点下的画布点不动', () => {
    const a = point(100, 200)
    const b = point(200, 200)
    const nextA = point(50, 200)
    const nextB = point(250, 200)

    const next = pinchViewportState(START, ORIGIN, {
      prevMid: pinchMidpoint(a, b),
      nextMid: pinchMidpoint(nextA, nextB),
      prevSpan: pinchSpan(a, b),
      nextSpan: pinchSpan(nextA, nextB),
    })

    expect(next.zoom).toBeCloseTo(2, 10)
    const mid = pinchMidpoint(nextA, nextB)
    const before = screenToCanvas(mid, START, ORIGIN)
    const after = screenToCanvas(mid, next, ORIGIN)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  it('锚点是中点而不是画布中心（屏幕坐标系有偏移时同样成立）', () => {
    const viewport: ViewportState = { zoom: 1, offsetX: -40, offsetY: 60 }
    const a = point(300, 400)
    const b = point(400, 400)
    const mid = pinchMidpoint(a, b)
    const next = pinchViewportState(viewport, SHIFTED_ORIGIN, {
      prevMid: mid,
      nextMid: mid,
      prevSpan: pinchSpan(a, b),
      nextSpan: pinchSpan(a, b) * 1.5,
    })

    expect(next.zoom).toBeCloseTo(1.5, 10)
    // 被锚住的是**中点**：它下方的画布坐标在缩放前后不变
    expectSamePoint(
      screenToCanvas(mid, next, SHIFTED_ORIGIN),
      screenToCanvas(mid, viewport, SHIFTED_ORIGIN),
    )
    // 中点之外的手指：屏幕距离按倍率**远离**中点 → 换算回画布坐标反而按倍率收窄。
    // 这才叫以中点为锚放大（整体平移会保持画布距离不变，滚轮锚点写错时正是那副鬼样子）
    const before = screenToCanvas(a, viewport, SHIFTED_ORIGIN)
    const after = screenToCanvas(a, next, SHIFTED_ORIGIN)
    const midCanvas = screenToCanvas(mid, viewport, SHIFTED_ORIGIN)
    expect(after.x - midCanvas.x).toBeCloseTo((before.x - midCanvas.x) / 1.5, 6)
    expect(after.y - midCanvas.y).toBeCloseTo((before.y - midCanvas.y) / 1.5, 6)
  })

  it('捏合（比值 < 1）会缩小，并且同样锚在中点', () => {
    const viewport: ViewportState = { zoom: 2, offsetX: 10, offsetY: 10 }
    const prevMid = point(150, 150)
    const next = pinchViewportState(viewport, ORIGIN, {
      prevMid,
      nextMid: prevMid,
      prevSpan: 200,
      nextSpan: 100,
    })

    expect(next.zoom).toBeCloseTo(1, 10)
    const before = screenToCanvas(prevMid, viewport, ORIGIN)
    const after = screenToCanvas(prevMid, next, ORIGIN)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  it('越界时钳到 10%~400%，钳完仍以同一屏幕点为锚（不会因为钳位而漂移）', () => {
    const anchor = point(80, 90)
    const huge = pinchViewportState(START, ORIGIN, {
      prevMid: anchor,
      nextMid: anchor,
      prevSpan: 100,
      nextSpan: 10_000,
    })
    expect(huge.zoom).toBe(MAX_ZOOM)
    expectSamePoint(screenToCanvas(anchor, huge, ORIGIN), screenToCanvas(anchor, START, ORIGIN))

    const tiny = pinchViewportState(START, ORIGIN, {
      prevMid: anchor,
      nextMid: anchor,
      prevSpan: 100,
      nextSpan: 0.4,
    })
    // 次帧间距低于下限 → 倍率视为 1（见下面的下限用例），先确认它没有越界
    expect(tiny.zoom).toBe(1)

    const tinyClamped = pinchViewportState({ zoom: 0.2, offsetX: 0, offsetY: 0 }, ORIGIN, {
      prevMid: anchor,
      nextMid: anchor,
      prevSpan: 200,
      nextSpan: 20,
    })
    expect(tinyClamped.zoom).toBe(MIN_ZOOM)
    expectSamePoint(
      screenToCanvas(anchor, tinyClamped, ORIGIN),
      screenToCanvas(anchor, { zoom: 0.2, offsetX: 0, offsetY: 0 }, ORIGIN),
    )
  })
})

describe('pinchViewportState：平移分量', () => {
  it('两指同向平移（间距不变）→ 只动 offset，zoom 不变', () => {
    const a = point(100, 100)
    const b = point(200, 160)
    const nextA = point(130, 90)
    const nextB = point(230, 150)

    const next = pinchViewportState(START, ORIGIN, {
      prevMid: pinchMidpoint(a, b),
      nextMid: pinchMidpoint(nextA, nextB),
      prevSpan: pinchSpan(a, b),
      nextSpan: pinchSpan(nextA, nextB),
    })

    expect(next.zoom).toBeCloseTo(1, 10)
    expect(next.offsetX).toBeCloseTo(30, 6)
    expect(next.offsetY).toBeCloseTo(-10, 6)
  })

  it('平移与缩放同时发生时，两分量叠加（先平移后缩放）', () => {
    const next = pinchViewportState(START, ORIGIN, {
      prevMid: point(150, 150),
      nextMid: point(170, 150),
      prevSpan: 100,
      nextSpan: 200,
    })
    expect(next.zoom).toBeCloseTo(2, 10)
    // 中点先平移 +20（offset 到 20），再以**新中点 (170,150)** 为锚放大 2 倍：
    // 该点下原本的画布坐标 (150,150) 必须仍落在 (170,150) → offset = 170 - 150×2
    expect(next.offsetX).toBeCloseTo(-130, 6)
    expect(next.offsetY).toBeCloseTo(-150, 6)
  })
})

describe('pinchViewportState：退化输入不放大小数', () => {
  it('上一帧间距低于下限（两指刚并拢）→ 倍率取 1，不产生 Infinity', () => {
    const next = pinchViewportState(START, ORIGIN, {
      prevMid: point(50, 50),
      nextMid: point(50, 50),
      prevSpan: MIN_PINCH_SPAN_PX - 1,
      nextSpan: 400,
    })
    expect(Number.isFinite(next.zoom)).toBe(true)
    expect(next.zoom).toBe(1)
  })

  it('两指完全重合（间距 0）→ 不 NaN、不 Infinity', () => {
    const next = pinchViewportState(START, ORIGIN, {
      prevMid: point(20, 20),
      nextMid: point(35, 40),
      prevSpan: 0,
      nextSpan: 0,
    })
    expect(Number.isFinite(next.zoom)).toBe(true)
    expect(Number.isFinite(next.offsetX)).toBe(true)
    expect(Number.isFinite(next.offsetY)).toBe(true)
    expect(next.zoom).toBe(1)
    expect(next.offsetX).toBe(15)
    expect(next.offsetY).toBe(20)
  })

  it('不修改传入的视口对象（纯函数）', () => {
    const frozen = { ...START }
    pinchViewportState(frozen, ORIGIN, {
      prevMid: point(0, 0),
      nextMid: point(50, 50),
      prevSpan: 100,
      nextSpan: 300,
    })
    expect(frozen).toEqual(START)
  })
})
