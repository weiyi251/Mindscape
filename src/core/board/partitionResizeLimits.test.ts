// ============================================================================
// 模块说明（中文）
// computePartitionResizeLimits 的单元测试（2026-09-11 用户裁决「分区框大小自定义」）。
// 固化三条规则：
//   1. 布局自动适应 —— min 至少包住框内卡片包围盒（含内边距 + 标题条）；
//   2. 不与其他元素重叠 —— max 被右 / 下方相邻分区钳制（留 GAP）；
//   3. 折叠状态高度锁死为标题条高度。
// ============================================================================

import { describe, expect, it } from 'vitest'

import {
  computePartitionResizeLimits,
  PARTITION_PADDING,
  PARTITION_RESIZE_GAP,
  PARTITION_TITLE_HEIGHT,
} from './partitions'
import type { Partition } from '@/core/types'

function makePartition(over: Partial<Partition>): Partition {
  return {
    id: 'p1',
    name: '参考资料',
    folderPath: '参考资料',
    x: 0,
    y: 0,
    w: 400,
    h: 300,
    color: '#5A7D6A',
    collapsed: false,
    meta: {},
    ...over,
  } as Partition
}

describe('computePartitionResizeLimits', () => {
  it('空框：min = 全局最小尺寸，max 不受限', () => {
    const limits = computePartitionResizeLimits(makePartition({}), [], [])
    expect(limits.minW).toBeGreaterThanOrEqual(120)
    expect(limits.minH).toBeGreaterThanOrEqual(120)
    expect(limits.maxW).toBe(Number.POSITIVE_INFINITY)
    expect(limits.maxH).toBe(Number.POSITIVE_INFINITY)
  })

  it('min 至少包住框内卡片包围盒（内边距 + 标题条）', () => {
    // 卡片包围盒 300×180 → minW = 300+48, minH = 180+32+48
    const members = [
      { x: 10, y: 40, w: 120, h: 100 },
      { x: 160, y: 60, w: 150, h: 160 },
    ]
    const limits = computePartitionResizeLimits(makePartition({}), [], members)
    expect(limits.minW).toBe(300 + PARTITION_PADDING * 2)
    expect(limits.minH).toBe(180 + PARTITION_TITLE_HEIGHT + PARTITION_PADDING * 2)
  })

  it('右侧相邻分区钳制 maxW（留 GAP）', () => {
    const p1 = makePartition({ id: 'p1', x: 0, y: 0, w: 400, h: 300 })
    const p2 = makePartition({ id: 'p2', name: '方案', folderPath: '方案', x: 600, y: 50, w: 200, h: 200 })
    const limits = computePartitionResizeLimits(p1, [p2], [])
    // p2 在 p1 的垂直范围内 → 向右最多到 600 - 8
    expect(limits.maxW).toBe(600 - PARTITION_RESIZE_GAP)
  })

  it('下方相邻分区钳制 maxH（留 GAP）', () => {
    const p1 = makePartition({ id: 'p1', x: 0, y: 0, w: 400, h: 300 })
    const p2 = makePartition({ id: 'p2', name: '方案', folderPath: '方案', x: 50, y: 500, w: 200, h: 200 })
    const limits = computePartitionResizeLimits(p1, [p2], [])
    expect(limits.maxH).toBe(500 - PARTITION_RESIZE_GAP)
  })

  it('垂直 / 水平范围不相交的分区不钳制', () => {
    const p1 = makePartition({ id: 'p1', x: 0, y: 0, w: 400, h: 300 })
    // p2 在 p1 的垂直范围之外（y 完全错开）→ 不限制右移
    const p2 = makePartition({ id: 'p2', name: '方案', folderPath: '方案', x: 600, y: 900, w: 200, h: 200 })
    const limits = computePartitionResizeLimits(p1, [p2], [])
    expect(limits.maxW).toBe(Number.POSITIVE_INFINITY)
  })

  it('自身不参与钳制', () => {
    const p1 = makePartition({ id: 'p1', x: 0, y: 0, w: 400, h: 300 })
    const limits = computePartitionResizeLimits(p1, [p1], [])
    expect(limits.maxW).toBe(Number.POSITIVE_INFINITY)
  })

  it('折叠状态：minH = maxH = 标题条高度（宽度仍可调）', () => {
    const collapsed = makePartition({ collapsed: true })
    const limits = computePartitionResizeLimits(collapsed, [], [])
    expect(limits.minH).toBe(PARTITION_TITLE_HEIGHT)
    expect(limits.maxH).toBe(PARTITION_TITLE_HEIGHT)
    expect(limits.maxW).toBe(Number.POSITIVE_INFINITY)
  })

  it('钳制上限不会小于下限（密集布局兜底，内容永远装得下）', () => {
    const p1 = makePartition({ id: 'p1', x: 0, y: 0, w: 400, h: 300 })
    // p2 紧贴在 minW 之内 → maxW 被 clamp 到不小于 minW
    const members = [{ x: 0, y: 40, w: 300, h: 200 }] // minW = 300+48 = 348
    const p2 = makePartition({ id: 'p2', name: '方案', folderPath: '方案', x: 200, y: 0, w: 100, h: 100 })
    const limits = computePartitionResizeLimits(p1, [p2], members)
    expect(limits.maxW).toBe(limits.minW)
  })
})
