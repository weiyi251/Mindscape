// ============================================================================
// 模块说明（中文）
// 可拖动浮窗几何的单测。覆盖：默认居中、视口内收敛、拖动位移（含被边界夹住后
// 回摆跟手）、右下角缩放（左上角固定、最小尺寸、到边缘为止）、偏好读写容错。
// ============================================================================
import { describe, expect, it } from 'vitest'

import {
  MODAL_DEFAULT_HEIGHT,
  MODAL_DEFAULT_WIDTH,
  MODAL_MARGIN,
  MODAL_MIN_HEIGHT,
  MODAL_MIN_WIDTH,
  clampRect,
  defaultModalRect,
  moveRect,
  parseModalRect,
  resizeRect,
  serializeModalRect,
} from './floatingModalGeometry'
import type { ModalRect, ViewportSize } from './floatingModalGeometry'

const VIEWPORT: ViewportSize = { width: 1280, height: 800 }

function rect(values: Partial<ModalRect> = {}): ModalRect {
  return {
    x: values.x ?? 100,
    y: values.y ?? 100,
    width: values.width ?? 560,
    height: values.height ?? 440,
  }
}

/** 断言矩形完全落在视口留白之内 */
function expectInsideViewport(value: ModalRect, viewport: ViewportSize) {
  expect(value.x).toBeGreaterThanOrEqual(MODAL_MARGIN)
  expect(value.y).toBeGreaterThanOrEqual(MODAL_MARGIN)
  expect(value.x + value.width).toBeLessThanOrEqual(viewport.width - MODAL_MARGIN)
  expect(value.y + value.height).toBeLessThanOrEqual(viewport.height - MODAL_MARGIN)
}

describe('defaultModalRect（首次打开的默认位置）', () => {
  it('水平居中、略高于垂直居中（0.42）', () => {
    const value = defaultModalRect(VIEWPORT)
    expect(value.width).toBe(MODAL_DEFAULT_WIDTH)
    expect(value.height).toBe(MODAL_DEFAULT_HEIGHT)
    expect(value.x).toBe(Math.round((1280 - MODAL_DEFAULT_WIDTH) / 2))
    expect(value.y).toBe(Math.round((800 - MODAL_DEFAULT_HEIGHT) * 0.42))
    expectInsideViewport(value, VIEWPORT)
  })

  it('小视口下尺寸被夹到可用范围，仍完整落在视口内', () => {
    const small: ViewportSize = { width: 480, height: 360 }
    const value = defaultModalRect(small)
    expect(value.width).toBeLessThanOrEqual(small.width - MODAL_MARGIN * 2)
    expectInsideViewport(value, small)
  })

  it('极小视口也不会出现负尺寸（最小尺寸兜底）', () => {
    const tiny: ViewportSize = { width: 200, height: 150 }
    const value = defaultModalRect(tiny)
    expect(value.width).toBeGreaterThanOrEqual(MODAL_MIN_WIDTH)
    expect(value.height).toBeGreaterThanOrEqual(MODAL_MIN_HEIGHT)
  })
})

describe('clampRect（收敛进视口）', () => {
  it('已经合规的矩形原样返回', () => {
    const value = rect()
    expect(clampRect(value, VIEWPORT)).toEqual(value)
  })

  it('超出右 / 下边界被拉回', () => {
    const value = clampRect(rect({ x: 1200, y: 700 }), VIEWPORT)
    expectInsideViewport(value, VIEWPORT)
    expect(value.x).toBe(VIEWPORT.width - value.width - MODAL_MARGIN)
    expect(value.y).toBe(VIEWPORT.height - value.height - MODAL_MARGIN)
  })

  it('负数位置被抬到留白处', () => {
    const value = clampRect(rect({ x: -300, y: -50 }), VIEWPORT)
    expect(value.x).toBe(MODAL_MARGIN)
    expect(value.y).toBe(MODAL_MARGIN)
  })

  it('尺寸过小被抬到最小尺寸', () => {
    const value = clampRect(rect({ width: 10, height: 10 }), VIEWPORT)
    expect(value.width).toBe(MODAL_MIN_WIDTH)
    expect(value.height).toBe(MODAL_MIN_HEIGHT)
  })

  it('尺寸过大被夹到视口可用尺寸', () => {
    const value = clampRect(rect({ width: 5000, height: 5000 }), VIEWPORT)
    expect(value.width).toBe(VIEWPORT.width - MODAL_MARGIN * 2)
    expect(value.height).toBe(VIEWPORT.height - MODAL_MARGIN * 2)
    expectInsideViewport(value, VIEWPORT)
  })

  it('NaN / Infinity 不会污染结果（回落到默认值）', () => {
    const value = clampRect(
      { x: Number.NaN, y: Number.POSITIVE_INFINITY, width: Number.NaN, height: Number.NaN },
      VIEWPORT,
    )
    expectInsideViewport(value, VIEWPORT)
    expect(value.width).toBe(MODAL_DEFAULT_WIDTH)
    expect(value.height).toBe(MODAL_DEFAULT_HEIGHT)
  })

  it('视口缩小时能把浮窗拉回可视区（窗口被拖小的场景）', () => {
    const shrunk: ViewportSize = { width: 700, height: 500 }
    const value = clampRect(rect({ x: 900, y: 600, width: 560, height: 440 }), shrunk)
    expectInsideViewport(value, shrunk)
  })
})

describe('moveRect（标题栏拖动）', () => {
  it('按总位移平移', () => {
    const value = moveRect(rect({ x: 200, y: 150 }), 40, -30, VIEWPORT)
    expect(value.x).toBe(240)
    expect(value.y).toBe(120)
    expect(value.width).toBe(560)
    expect(value.height).toBe(440)
  })

  it('拖出边界后被夹住；随后回摆能立刻跟手（基于起点算总位移）', () => {
    const origin = rect({ x: 200, y: 150 })
    const pushed = moveRect(origin, 100000, 100000, VIEWPORT)
    expectInsideViewport(pushed, VIEWPORT)

    // 回摆：位移改成 60，位置应回到 origin+60，而不是「被夹住的位置 + 增量」
    const back = moveRect(origin, 60, 20, VIEWPORT)
    expect(back.x).toBe(260)
    expect(back.y).toBe(170)
  })

  it('NaN 位移视为 0', () => {
    const value = moveRect(rect({ x: 200, y: 150 }), Number.NaN, Number.NaN, VIEWPORT)
    expect(value.x).toBe(200)
    expect(value.y).toBe(150)
  })
})

describe('resizeRect（右下角缩放）', () => {
  it('左上角固定，宽高按传入值', () => {
    const value = resizeRect(rect({ x: 120, y: 90 }), 700, 500, VIEWPORT)
    expect(value.x).toBe(120)
    expect(value.y).toBe(90)
    expect(value.width).toBe(700)
    expect(value.height).toBe(500)
  })

  it('小于最小尺寸时被抬到最小尺寸', () => {
    const value = resizeRect(rect(), 10, 10, VIEWPORT)
    expect(value.width).toBe(MODAL_MIN_WIDTH)
    expect(value.height).toBe(MODAL_MIN_HEIGHT)
  })

  it('放大到视口边缘为止，不会溢出（左上角为固定点）', () => {
    const origin = rect({ x: 600, y: 300 })
    const value = resizeRect(origin, 9999, 9999, VIEWPORT)
    expect(value.x + value.width).toBe(VIEWPORT.width - MODAL_MARGIN)
    expect(value.y + value.height).toBe(VIEWPORT.height - MODAL_MARGIN)
    expectInsideViewport(value, VIEWPORT)
  })

  it('NaN 宽高回落到原尺寸', () => {
    const value = resizeRect(rect(), Number.NaN, Number.NaN, VIEWPORT)
    expect(value.width).toBe(560)
    expect(value.height).toBe(440)
  })
})

describe('parseModalRect / serializeModalRect（位置偏好读写）', () => {
  it('序列化 → 解析可往返', () => {
    const value = rect({ x: 12.4, y: 30.6, width: 700.2, height: 500.8 })
    const text = serializeModalRect(value)
    const parsed = parseModalRect(text)
    expect(parsed).toEqual({
      x: Math.round(value.x),
      y: Math.round(value.y),
      width: Math.round(value.width),
      height: Math.round(value.height),
    })
  })

  it('空值 / 坏 JSON / 非对象 → null', () => {
    expect(parseModalRect(null)).toBeNull()
    expect(parseModalRect(undefined)).toBeNull()
    expect(parseModalRect('')).toBeNull()
    expect(parseModalRect('{oops')).toBeNull()
    expect(parseModalRect('"abc"')).toBeNull()
    expect(parseModalRect('[]')).toBeNull()
  })

  it('字段缺失 / 类型不对 / 非有限数 → null（回落默认而不是给出坏矩形）', () => {
    expect(parseModalRect(JSON.stringify({ x: 1, y: 2, width: 3 }))).toBeNull()
    expect(parseModalRect(JSON.stringify({ x: 1, y: 2, width: 3, height: '4' }))).toBeNull()
    expect(parseModalRect(JSON.stringify({ x: 1, y: 2, width: null, height: 4 }))).toBeNull()
  })
})
