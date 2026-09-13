// ============================================================================
// 模块说明（中文）
// `canvas/interaction/fitToContent.ts`（缩放到全部内容的纯计算层）单元测试。
// 实现任务：P1-4。
//
// 覆盖计划验收要求：3 个矩形 → zoom ∈ [0.1, 4] 且包围盒完整落入视口；
// 单卡片 / 空画布 / 超出缩放范围（MAX_ZOOM 兜底）三个边界。
// ============================================================================

import { describe, expect, it } from 'vitest'

import { MAX_ZOOM, MIN_ZOOM } from './coordinates'
import type { ViewportState } from './coordinates'
import { PARTITION_TITLE_HEIGHT } from '@/core/board/partitions'
import { unionRects } from '@/core/geometry/rect'
import type { Rect } from '@/core/geometry/rect'
import { contentRects, fitViewportState } from './fitToContent'

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h })

const VIEW = { width: 1280, height: 800 }

/** 断言包围盒经视口变换后完整落入视口（允许 0.5px 浮点余量） */
function expectInsideViewport(rects: Rect[], state: ViewportState, view = VIEW): void {
  const bounds = unionRects(rects)!
  const left = bounds.x * state.zoom + state.offsetX
  const top = bounds.y * state.zoom + state.offsetY
  const right = (bounds.x + bounds.w) * state.zoom + state.offsetX
  const bottom = (bounds.y + bounds.h) * state.zoom + state.offsetY
  expect(state.zoom).toBeGreaterThanOrEqual(MIN_ZOOM)
  expect(state.zoom).toBeLessThanOrEqual(MAX_ZOOM)
  expect(left).toBeGreaterThanOrEqual(-0.5)
  expect(top).toBeGreaterThanOrEqual(-0.5)
  expect(right).toBeLessThanOrEqual(view.width + 0.5)
  expect(bottom).toBeLessThanOrEqual(view.height + 0.5)
}

// unionRects 自身的用例已迁到 core/geometry/rect.test.ts（实现合并为一份）

describe('contentRects：内容集合', () => {
  it('卡片按自身尺寸，折叠分区按标题条高度', () => {
    const cards = [{ x: 0, y: 0, w: 120, h: 90 }]
    const partitions = [
      { x: 500, y: 400, w: 300, h: 600, collapsed: false },
      { x: 900, y: 0, w: 200, h: 600, collapsed: true },
    ] as never[]
    expect(contentRects(cards, partitions)).toEqual([
      rect(0, 0, 120, 90),
      rect(500, 400, 300, 600),
      rect(900, 0, 200, PARTITION_TITLE_HEIGHT),
    ])
  })

  it('两者皆空返回空数组（→ fitViewportState 得 null）', () => {
    expect(contentRects([], [])).toEqual([])
  })
})

describe('fitViewportState：适配计算', () => {
  it('三个矩形：zoom 在 [0.1, 4] 且包围盒完整落入视口', () => {
    const rects = [rect(0, 0, 300, 200), rect(800, 120, 260, 180), rect(400, 900, 320, 240)]
    const state = fitViewportState(rects, VIEW)!
    expect(state).not.toBeNull()
    expectInsideViewport(rects, state)
  })

  it('包围盒中心对准视口中心', () => {
    const rects = [rect(100, 100, 400, 300)]
    const state = fitViewportState(rects, VIEW)!
    const bounds = unionRects(rects)!
    const centerX = (bounds.x + bounds.w / 2) * state.zoom + state.offsetX
    const centerY = (bounds.y + bounds.h / 2) * state.zoom + state.offsetY
    expect(centerX).toBeCloseTo(VIEW.width / 2, 6)
    expect(centerY).toBeCloseTo(VIEW.height / 2, 6)
  })

  it('单卡片：完整显示且不无限放大（受 MAX_ZOOM 兜底）', () => {
    const rects = [rect(500, 300, 240, 160)]
    const state = fitViewportState(rects, VIEW)!
    expectInsideViewport(rects, state)
    expect(state.zoom).toBeLessThanOrEqual(MAX_ZOOM)
  })

  it('空画布返回 null（调用方保持现状）', () => {
    expect(fitViewportState([], VIEW)).toBeNull()
  })

  it('视口尺寸非法返回 null', () => {
    const rects = [rect(0, 0, 100, 100)]
    expect(fitViewportState(rects, { width: 0, height: 800 })).toBeNull()
    expect(fitViewportState(rects, { width: Number.NaN, height: 800 })).toBeNull()
  })

  it('内容远超 400% 能容纳的范围时钳到 MAX_ZOOM，包围盒中心仍居中', () => {
    // 一张极小的卡片（20×20）配巨大视口：按留白计算 zoom 远超 4，必须被钳住
    const rects = [rect(0, 0, 20, 20)]
    const bigView = { width: 4000, height: 3000 }
    const state = fitViewportState(rects, bigView)!
    expect(state.zoom).toBe(MAX_ZOOM)
    expectInsideViewport(rects, state, bigView)
  })

  it('内容远超最小缩放能容纳的范围时钳到 MIN_ZOOM（超大幅面）', () => {
    const rects = [rect(0, 0, 200000, 200000)]
    const state = fitViewportState(rects, VIEW)!
    expect(state.zoom).toBe(MIN_ZOOM)
  })

  it('极小视口（放不下留白）也能算出合法结果', () => {
    const rects = [rect(0, 0, 500, 400)]
    const tiny = { width: 60, height: 50 }
    const state = fitViewportState(rects, tiny)!
    expect(state.zoom).toBeGreaterThanOrEqual(MIN_ZOOM)
    expect(state.zoom).toBeLessThanOrEqual(MAX_ZOOM)
    // 小视口留白退化为 1px 可用区：允许 ±1px 越界
    const bounds = unionRects(rects)!
    const right = (bounds.x + bounds.w) * state.zoom + state.offsetX
    expect(right).toBeLessThanOrEqual(tiny.width + 1)
  })

  it('自定义留白生效（更大留白 → 更小 zoom）', () => {
    const rects = [rect(0, 0, 800, 600)]
    const loose = fitViewportState(rects, { ...VIEW, padding: 120 })!
    const tight = fitViewportState(rects, { ...VIEW, padding: 10 })!
    expect(loose.zoom).toBeLessThan(tight.zoom)
  })

  it('零尺寸矩形不会把 zoom 推成 Infinity', () => {
    const state = fitViewportState([rect(10, 10, 0, 0)], VIEW)!
    expect(Number.isFinite(state.zoom)).toBe(true)
    expect(Number.isFinite(state.offsetX)).toBe(true)
    expect(Number.isFinite(state.offsetY)).toBe(true)
  })
})
