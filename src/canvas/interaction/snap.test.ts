// ============================================================================
// 模块说明（中文）
// 对齐吸附纯计算（snap）的单元测试（T2.4）。
// 覆盖：边缘 / 中线对齐、阈值过滤、每轴独立、多目标取最小、zoom 换算。
// ============================================================================

import { describe, expect, it } from 'vitest'

import { computeSnap, snapThresholdInCanvas, SNAP_THRESHOLD_SCREEN_PX } from './snap'

describe('computeSnap', () => {
  it('左边缘接近目标左边缘时吸附（x 轴对齐）', () => {
    // 目标卡在 (100, 200)；移动卡提议位置 (104, 300)，左边差 4 ≤ 阈值 6
    const outcome = computeSnap(
      { x: 104, y: 300 },
      { w: 100, h: 80 },
      [{ x: 100, y: 200, w: 100, h: 80 }],
    )
    expect(outcome.position).toEqual({ x: 100, y: 300 }) // y 轴无对齐保持原值
    expect(outcome.vertical).toEqual({ orientation: 'vertical', position: 100 })
    expect(outcome.horizontal).toBeNull()
  })

  it('右边缘与中线也能对齐', () => {
    // 移动卡右边缘 = proposed.x + w；与目标左边缘对齐
    const rightAlign = computeSnap(
      { x: 96, y: 0 },
      { w: 100, h: 80 },
      [{ x: 200, y: 0, w: 100, h: 80 }],
    )
    expect(rightAlign.position.x).toBe(100) // 右边缘 196 吸到 200（右移 4），左上角 x = 100

    // 移动卡中线 = proposed.x + w/2；与目标右边缘对齐
    const centerAlign = computeSnap(
      { x: 197, y: 0 },
      { w: 100, h: 80 },
      [{ x: 100, y: 0, w: 100, h: 80 }],
    )
    expect(centerAlign.position.x).toBe(200) // 中线 247 与目标右边缘 200 差 3 → 吸到 200
  })

  it('y 轴独立：x 无对齐时不受 y 吸附影响', () => {
    // 只有 y 方向接近：移动卡上边缘 204 vs 目标上边缘 200，差 4
    const outcome = computeSnap(
      { x: 500, y: 204 },
      { w: 100, h: 80 },
      [{ x: 100, y: 200, w: 100, h: 80 }],
    )
    expect(outcome.position).toEqual({ x: 500, y: 200 })
    expect(outcome.vertical).toBeNull()
    expect(outcome.horizontal).toEqual({ orientation: 'horizontal', position: 200 })
  })

  it('超出阈值的偏差不吸附', () => {
    // 目标卡 y 放远（200），避免 y 轴恰好重合产生意外命中
    const outcome = computeSnap(
      { x: 108, y: 0 },
      { w: 100, h: 80 },
      [{ x: 100, y: 200, w: 100, h: 80 }],
    )
    expect(outcome.position).toEqual({ x: 108, y: 0 })
    expect(outcome.vertical).toBeNull()
    expect(outcome.horizontal).toBeNull()
  })

  it('恰好等于阈值时仍然吸附（边界含等号）', () => {
    // 目标卡 y 放远，隔离 x 轴边界行为
    const outcome = computeSnap(
      { x: 106, y: 0 },
      { w: 100, h: 80 },
      [{ x: 100, y: 200, w: 100, h: 80 }],
    )
    expect(outcome.position.x).toBe(100)
    expect(outcome.horizontal).toBeNull()
  })

  it('多个候选取 |delta| 最小的一对', () => {
    // 移动卡（x=102, w=101）：左边缘 102、中线 152.5、右边缘 203
    // 目标卡（x=104, w=100）：左边缘 104、中线 154、右边缘 204
    // 左对左差 2，右对右差 1 → 应选右对右（delta 最小）
    const outcome = computeSnap(
      { x: 102, y: 0 },
      { w: 101, h: 80 },
      [{ x: 104, y: 0, w: 100, h: 80 }],
    )
    expect(outcome.vertical).toEqual({ orientation: 'vertical', position: 204 })
    expect(outcome.position.x).toBe(103) // 右边缘 203 吸到 204，整体右移 1
  })

  it('两个目标各命中一个轴时各自取最优', () => {
    const outcome = computeSnap(
      { x: 98, y: 303 },
      { w: 100, h: 80 },
      [
        { x: 100, y: 0, w: 100, h: 80 },
        { x: 500, y: 300, w: 100, h: 80 },
      ],
    )
    expect(outcome.position).toEqual({ x: 100, y: 300 })
    expect(outcome.vertical).toEqual({ orientation: 'vertical', position: 100 })
    expect(outcome.horizontal).toEqual({ orientation: 'horizontal', position: 300 })
  })

  it('无目标时原样返回', () => {
    const outcome = computeSnap({ x: 12, y: 34 }, { w: 100, h: 80 }, [])
    expect(outcome.position).toEqual({ x: 12, y: 34 })
    expect(outcome.vertical).toBeNull()
    expect(outcome.horizontal).toBeNull()
  })

  it('自定义阈值生效（分区框等大目标可用更大阈值）', () => {
    const outcome = computeSnap(
      { x: 110, y: 0 },
      { w: 100, h: 80 },
      [{ x: 100, y: 0, w: 100, h: 80 }],
      12,
    )
    expect(outcome.position.x).toBe(100)
  })
})

describe('snapThresholdInCanvas', () => {
  it('zoom=1 时等于屏幕阈值', () => {
    expect(snapThresholdInCanvas(1)).toBe(SNAP_THRESHOLD_SCREEN_PX)
  })

  it('缩小视图（zoom<1）时画布阈值放大，保证屏幕手感一致', () => {
    expect(snapThresholdInCanvas(0.5)).toBe(SNAP_THRESHOLD_SCREEN_PX / 0.5) // 12
  })

  it('放大视图（zoom>1）时画布阈值收缩', () => {
    expect(snapThresholdInCanvas(2)).toBe(SNAP_THRESHOLD_SCREEN_PX / 2) // 3
  })

  it('非法 zoom（0 / 负数）按 1 兜底', () => {
    expect(snapThresholdInCanvas(0)).toBe(SNAP_THRESHOLD_SCREEN_PX)
    expect(snapThresholdInCanvas(-2)).toBe(SNAP_THRESHOLD_SCREEN_PX)
  })
})
