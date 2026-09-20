// ============================================================================
// 模块说明（中文）
// core/geometry/align.ts 的单元测试（2026-09-20 用户计划 C3）。
//
// 覆盖三类关注点：
//   ① 6 向对齐的基准线与位移计算；
//   ② 锁定卡的取舍 —— 参与对齐（可当基准）但不参与分布；
//   ③ 等距分布的首尾固定、间隙计算、空间不足（负间隙）与参与项不足的退化。
// 纯函数测试，不依赖任何 DOM / store。
// ============================================================================

import { describe, expect, it } from 'vitest'

import {
  ALIGN_MODES,
  canAlign,
  canDistribute,
  computeAlignMoves,
  DISTRIBUTE_MODES,
  isAlignMode,
} from './align'
import type { AlignItem } from './align'

const item = (id: string, x: number, y: number, w = 100, h = 60, locked = false): AlignItem => ({
  id,
  rect: { x, y, w, h },
  locked,
})

/** 取位移结果的 id → 目标坐标表，便于断言（顺序无关） */
const movesOf = (items: readonly AlignItem[], operation: Parameters<typeof computeAlignMoves>[1]) =>
  Object.fromEntries(
    computeAlignMoves(items, operation).map((move) => [move.id, { x: move.x, y: move.y }])
  )

describe('能力判定：参与项是否够', () => {
  it('对齐至少要 2 张', () => {
    expect(canAlign([])).toBe(false)
    expect(canAlign([item('a', 0, 0)])).toBe(false)
    expect(canAlign([item('a', 0, 0), item('b', 300, 0)])).toBe(true)
  })

  it('分布至少要 3 张未锁定卡', () => {
    expect(canDistribute([item('a', 0, 0), item('b', 200, 0)])).toBe(false)
    // 3 张里有两张锁定 → 只有 1 张可动，无法分布
    expect(
      canDistribute([
        item('a', 0, 0),
        item('b', 200, 0, 100, 60, true),
        item('c', 400, 0, 100, 60, true),
      ])
    ).toBe(false)
    expect(canDistribute([item('a', 0, 0), item('b', 200, 0), item('c', 400, 0)])).toBe(true)
  })

  it('isAlignMode 区分 6 向对齐与 2 向分布', () => {
    expect(ALIGN_MODES.every(isAlignMode)).toBe(true)
    expect(DISTRIBUTE_MODES.some(isAlignMode)).toBe(false)
  })
})

describe('6 向对齐', () => {
  const row = [item('a', 0, 0), item('b', 200, 40), item('c', 400, 80)]

  it('左对齐：全部贴到选区最左，y 不动', () => {
    expect(movesOf(row, 'left')).toEqual({
      b: { x: 0, y: 40 },
      c: { x: 0, y: 80 },
    })
  })

  it('右对齐：全部贴到选区最右（按各卡自身宽度回推左上角）', () => {
    expect(movesOf(row, 'right')).toEqual({
      a: { x: 400, y: 0 },
      b: { x: 400, y: 40 },
    })
  })

  it('水平居中：对齐到包围盒中心，中间的卡原地不动', () => {
    // 包围盒 x∈[0,500]，中心 250；三张卡宽 100 → 目标 x 均为 200
    expect(movesOf(row, 'hcenter')).toEqual({
      a: { x: 200, y: 0 },
      c: { x: 200, y: 80 },
    })
  })

  it('上 / 下 / 垂直居中：只动 y', () => {
    const column = [
      item('a', 0, 0, 80, 50),
      item('b', 300, 100, 80, 50),
      item('c', 600, 300, 80, 50),
    ]
    // 包围盒 y∈[0,350]，中心 175 → 目标 y = 150
    expect(movesOf(column, 'top')).toEqual({
      b: { x: 300, y: 0 },
      c: { x: 600, y: 0 },
    })
    expect(movesOf(column, 'bottom')).toEqual({
      a: { x: 0, y: 300 },
      b: { x: 300, y: 300 },
    })
    expect(movesOf(column, 'vcenter')).toEqual({
      a: { x: 0, y: 150 },
      b: { x: 300, y: 150 },
      c: { x: 600, y: 150 },
    })
  })

  it('锁定卡视为基准但自身不产生位移', () => {
    // 锁定卡在选区最左（x=0），另外两张对齐到它
    const items = [item('pinned', 0, 0, 100, 60, true), item('b', 200, 40), item('c', 400, 80)]
    expect(movesOf(items, 'left')).toEqual({
      b: { x: 0, y: 40 },
      c: { x: 0, y: 80 },
    })
  })

  it('锁定卡的最右边界同样可作为右对齐基准', () => {
    // 锁定卡右边界 700 是全选最右 → 其余卡贴到 700
    const items = [item('a', 0, 0), item('pinned', 600, 40, 100, 60, true)]
    expect(movesOf(items, 'right')).toEqual({ a: { x: 600, y: 0 } })
  })

  it('已对齐 / 参与项不足 → 空位移（调用方据此静默 no-op）', () => {
    expect(computeAlignMoves([item('a', 0, 0), item('b', 0, 100)], 'left')).toEqual([])
    expect(computeAlignMoves([item('a', 0, 0)], 'left')).toEqual([])
    expect(computeAlignMoves([], 'left')).toEqual([])
  })
})

describe('等距分布', () => {
  it('水平分布：首尾固定，中间卡等间隙', () => {
    // 跨度 = 500+100-0 = 600，三张各宽 100 → 间隙 = (600-300)/2 = 150 → 中间卡 x = 250
    const items = [item('a', 0, 0), item('b', 200, 40), item('c', 500, 80)]
    expect(movesOf(items, 'distribute-h')).toEqual({ b: { x: 250, y: 40 } })
  })

  it('垂直分布：只动 y，首尾固定', () => {
    const items = [item('a', 0, 0, 80, 50), item('b', 10, 100, 80, 50), item('c', 20, 400, 80, 50)]
    // 跨度 = 450-0 = 450，三张各高 50 → 间隙 = 150 → 中间卡 y = 200
    expect(movesOf(items, 'distribute-v')).toEqual({ b: { x: 10, y: 200 } })
  })

  it('锁定卡不参与分布（它的位置不作锚点）', () => {
    // 未锁定三张 a/b/c 独立分布；锁定的 pinned（x=1000）不得把跨度拉到 1100
    const items = [
      item('a', 0, 0),
      item('b', 120, 0),
      item('c', 300, 0),
      item('pinned', 1000, 0, 100, 60, true),
    ]
    // 只按 a/b/c 算：跨度 400，间隙 (400-300)/2 = 50 → b 目标 x = 150
    expect(movesOf(items, 'distribute-h')).toEqual({ b: { x: 150, y: 0 } })
  })

  it('可用空间不足时间隙为负（允许重叠），结果仍为有限数', () => {
    // 跨度 = 30+100-0 = 130，三张共宽 300 → 间隙 = (130-300)/2 = -85 → 中间卡 x = 15
    const items = [item('a', 0, 0), item('b', 10, 0), item('c', 30, 0)]
    const moves = computeAlignMoves(items, 'distribute-h')
    expect(moves).toEqual([{ id: 'b', x: 15, y: 0 }])
    expect(moves.every((move) => Number.isFinite(move.x) && Number.isFinite(move.y))).toBe(true)
  })

  it('未锁定卡不足 3 张 → 空位移', () => {
    expect(
      computeAlignMoves(
        [item('a', 0, 0), item('b', 200, 0, 100, 60, true), item('c', 400, 0)],
        'distribute-h'
      )
    ).toEqual([])
  })

  it('卡片尺寸不一：跨度取首尾自身边界，首尾仍不动', () => {
    // a(0,宽40) b(200,宽80) c(400,宽20)：跨度 = 420-0 = 420，总宽 140 → 间隙 140 → b 目标 x = 180
    const items = [item('a', 0, 0, 40, 60), item('b', 200, 0, 80, 60), item('c', 400, 0, 20, 60)]
    expect(movesOf(items, 'distribute-h')).toEqual({ b: { x: 180, y: 0 } })
  })
})
