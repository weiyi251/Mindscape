// ============================================================================
// 模块说明（中文）
// 小地图纯计算部分（minimapGeometry）的单元测试：等比缩放变换、坐标互转（正逆一致）。
//
// `unionRects` 的用例已于 2026-09-14 随实现迁到 core/geometry/rect.test.ts
// （两份重复实现合并为一份，测试也合并）。
// ============================================================================

import { describe, expect, it } from 'vitest'

import { applyTransform, fitTransform, invertTransform } from './minimapGeometry'

describe('fitTransform', () => {
  it('等比缩放并居中：取更紧的一边，另一侧留白居中', () => {
    // 内容 200×100，视图 200×200（padding 10 → 内域 180×180）
    // scale = min(180/200, 180/100) = 0.9
    const t = fitTransform({ x: 0, y: 0, w: 200, h: 100 }, 200, 200, 10)
    expect(t.scale).toBeCloseTo(0.9)
    // 水平：10 + (180 - 200*0.9)/2 = 10；垂直：10 + (180 - 100*0.9)/2 = 55
    expect(t.offsetX).toBeCloseTo(10)
    expect(t.offsetY).toBeCloseTo(55)
  })

  it('负坐标内容同样居中（offset 含 -bounds.x*scale 修正）', () => {
    const t = fitTransform({ x: -100, y: -100, w: 200, h: 200 }, 200, 200, 10)
    // 内容缩放后恰好填满内域：scale = 0.9，(-100,-100) 映射到 (10,10)
    const origin = applyTransform({ x: -100, y: -100 }, t)
    expect(origin.x).toBeCloseTo(10)
    expect(origin.y).toBeCloseTo(10)
  })

  it('退化输入（宽/高为 0）不除零，scale 有正常值', () => {
    const t = fitTransform({ x: 0, y: 0, w: 0, h: 0 }, 200, 200, 10)
    expect(Number.isFinite(t.scale)).toBe(true)
    expect(t.scale).toBeGreaterThan(0)
  })
})

describe('applyTransform / invertTransform', () => {
  it('正逆互转还原原坐标', () => {
    const t = fitTransform({ x: -500, y: -300, w: 1200, h: 800 }, 208, 132, 8)
    const canvas = { x: 237.5, y: -84.25 }
    const roundTrip = invertTransform(applyTransform(canvas, t), t)
    expect(roundTrip.x).toBeCloseTo(canvas.x)
    expect(roundTrip.y).toBeCloseTo(canvas.y)
  })
})
