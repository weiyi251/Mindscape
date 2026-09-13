// ============================================================================
// 模块说明（中文）
// core/geometry/rect.ts 的单元测试。
//
// 用例来源：原 canvas/minimapGeometry.test.ts 的 `unionRects` 与
// canvas/interaction/fitToContent.test.ts 的 `unionRects` 两块**合并**至此
// （两份实现合并成一份后，测试也随之合并），并补上两份语义分野处的边界用例。
// ============================================================================

import { describe, expect, it } from 'vitest'

import { centeredOffset, fitScale, scaleToFit, unionRects } from './rect'
import type { Rect } from './rect'

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h })

describe('unionRects：包围盒并集', () => {
  it('框住全部输入矩形（含负坐标）', () => {
    // rect1 (0,0,100,80) ∪ rect2 (200,-50,50,50)：minY=-50，maxY=max(80,0)=80 → h=130
    expect(
      unionRects([
        rect(0, 0, 100, 80),
        rect(200, -50, 50, 50),
      ]),
    ).toEqual(rect(0, -50, 250, 130))
  })

  it('单个矩形原样返回', () => {
    expect(unionRects([rect(10, 20, 30, 40)])).toEqual(rect(10, 20, 30, 40))
  })

  it('多矩形取并集', () => {
    expect(unionRects([rect(-10, 0, 20, 20), rect(100, 500, 40, 30)])).toEqual(rect(-10, 0, 150, 530))
  })

  it('空输入 → null', () => {
    expect(unionRects([])).toBeNull()
  })

  it('全 null / undefined → null（两份旧实现的语义在此统一）', () => {
    expect(unionRects([null, undefined])).toBeNull()
  })

  it('null 项被跳过，不影响结果', () => {
    expect(unionRects([null, rect(10, 10, 5, 5), undefined])).toEqual(rect(10, 10, 5, 5))
  })

  it('宽度或高度为 0 的矩形仍参与（点在包围盒里是有意义的）', () => {
    expect(unionRects([rect(5, 5, 0, 0), rect(5, 5, 10, 10)])).toEqual(rect(5, 5, 10, 10))
  })
})

describe('scaleToFit：等比缩放并居中', () => {
  it('取更紧的一边，另一侧留白居中', () => {
    // 内容 200×100，视图 200×200（padding 10 → 内域 180×180）
    // scale = min(180/200, 180/100) = 0.9
    const t = scaleToFit(rect(0, 0, 200, 100), { width: 200, height: 200 }, 10)
    expect(t.scale).toBeCloseTo(0.9)
    // 水平：10 + (180 - 200*0.9)/2 = 10；垂直：10 + (180 - 100*0.9)/2 = 55
    expect(t.offsetX).toBeCloseTo(10)
    expect(t.offsetY).toBeCloseTo(55)
  })

  it('负坐标内容同样居中（offset 含 -bounds.x*scale 修正）', () => {
    const t = scaleToFit(rect(-100, -100, 200, 200), { width: 200, height: 200 }, 10)
    const originX = -100 * t.scale + t.offsetX
    const originY = -100 * t.scale + t.offsetY
    expect(originX).toBeCloseTo(10)
    expect(originY).toBeCloseTo(10)
  })

  it('padding 为 0 时退化为「内容中心对准视口中心」', () => {
    const t = scaleToFit(rect(100, 100, 400, 300), { width: 800, height: 600 }, 0)
    // scale = min(800/400, 600/300) = 2
    expect(t.scale).toBeCloseTo(2)
    expect((100 + 200) * t.scale + t.offsetX).toBeCloseTo(400)
    expect((100 + 150) * t.scale + t.offsetY).toBeCloseTo(300)
  })

  it('退化输入（宽/高为 0）不除零，scale 为有限正数', () => {
    const t = scaleToFit(rect(0, 0, 0, 0), { width: 200, height: 200 }, 10)
    expect(Number.isFinite(t.scale)).toBe(true)
    expect(t.scale).toBeGreaterThan(0)
  })

  it('留白大于视口时不出现负数可用区（按 1px 兜底）', () => {
    const t = scaleToFit(rect(0, 0, 10, 10), { width: 8, height: 8 }, 40)
    expect(Number.isFinite(t.scale)).toBe(true)
    expect(t.scale).toBeGreaterThan(0)
  })
})

describe('fitScale / centeredOffset：拆开供调用方各自包装', () => {
  const VIEW = { width: 200, height: 200 }

  it('fitScale 只给缩放比，不做钳制', () => {
    // 内容远小于视口 → 比值远大于 1（调用方自己决定是否钳到 MAX_ZOOM）
    expect(fitScale(rect(0, 0, 10, 10), VIEW, 10)).toBeCloseTo(18)
  })

  it('fitScale 与 scaleToFit 的 scale 一致', () => {
    const bounds = rect(-30, 40, 260, 90)
    expect(fitScale(bounds, VIEW, 10)).toBeCloseTo(scaleToFit(bounds, VIEW, 10).scale)
  })

  it('centeredOffset 用给定 scale 求偏移（先钳制再求偏移的顺序由调用方保证）', () => {
    const bounds = rect(0, 0, 200, 100)
    // 用 fitScale 的原始值 0.9 → 与 scaleToFit 一致
    expect(centeredOffset(bounds, VIEW, 10, 0.9)).toEqual({ offsetX: 10, offsetY: 55 })
    // 换成别的 scale（模拟「被 MAX_ZOOM 钳过」）→ 偏移随新 scale 重新计算
    // 内域 180×180，内容 200×100：offsetX = 10 + (180−100)/2 = 50；offsetY = 10 + (180−50)/2 = 75
    expect(centeredOffset(bounds, VIEW, 10, 0.5)).toEqual({ offsetX: 50, offsetY: 75 })
  })

  it('可用区中心的性质：内缩 padding 后中心仍等于视口中心', () => {
    const bounds = rect(100, 100, 400, 300)
    const scale = 1
    const { offsetX, offsetY } = centeredOffset(bounds, { width: 800, height: 600 }, 24, scale)
    expect((bounds.x + bounds.w / 2) * scale + offsetX).toBeCloseTo(400)
    expect((bounds.y + bounds.h / 2) * scale + offsetY).toBeCloseTo(300)
  })
})
