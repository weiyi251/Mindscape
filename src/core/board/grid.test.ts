// ============================================================================
// 模块说明（中文）
// 网格铺开算法单元测试。对应 T1.3 验收标准：
//   「20 张图能正确铺开，间距均匀，不堆在原点」
//
// 实现任务：T1.3（阶段一）。
// ============================================================================

import { describe, it, expect } from 'vitest'

import { DEFAULT_GRID_OPTIONS, layoutGrid } from '@/core/board/grid'

const SIZE = { w: 220, h: 220 }

describe('layoutGrid', () => {
  it('空数组返回空位置', () => {
    expect(layoutGrid([])).toEqual([])
  })

  it('不堆在原点：第一张卡的左上角是预设边距', () => {
    const [first] = layoutGrid([SIZE])
    expect(first).toEqual({ x: DEFAULT_GRID_OPTIONS.startX, y: DEFAULT_GRID_OPTIONS.startY })
    expect(first.x).toBeGreaterThan(0)
    expect(first.y).toBeGreaterThan(0)
  })

  it('同一行内横向间距严格相等（间距均匀）', () => {
    const positions = layoutGrid([SIZE, SIZE, SIZE])
    const gap1 = positions[1].x - positions[0].x
    const gap2 = positions[2].x - positions[1].x

    expect(gap1).toBe(SIZE.w + DEFAULT_GRID_OPTIONS.gapX)
    expect(gap2).toBe(gap1)
    expect(positions.map((p) => p.y)).toEqual([80, 80, 80])
  })

  it('第 6 张（超出 5 列）换行，y 增加一行高度 + 行间距', () => {
    const positions = layoutGrid(Array.from({ length: 6 }, () => SIZE))

    expect(positions[5].x).toBe(DEFAULT_GRID_OPTIONS.startX)
    expect(positions[5].y).toBe(
      DEFAULT_GRID_OPTIONS.startY + SIZE.h + DEFAULT_GRID_OPTIONS.gapY,
    )
  })

  it('行高取该行最高的卡片（不等高时不重叠）', () => {
    const positions = layoutGrid(
      [
        { w: 220, h: 100 },
        { w: 220, h: 260 },
        { w: 220, h: 140 }, // 第一行第三张
        { w: 220, h: 140 }, // 第二行第一张
      ],
      { columns: 3 },
    )

    // 第一行最高 260 → 第二行 y = 80 + 260 + 32
    expect(positions[3].y).toBe(80 + 260 + 32)
  })

  it('纵向间距严格相等（多行）', () => {
    const positions = layoutGrid(Array.from({ length: 12 }, () => SIZE), { columns: 4 })

    const rowY = [positions[0].y, positions[4].y, positions[8].y]
    expect(rowY[1] - rowY[0]).toBe(SIZE.h + DEFAULT_GRID_OPTIONS.gapY)
    expect(rowY[2] - rowY[1]).toBe(SIZE.h + DEFAULT_GRID_OPTIONS.gapY)
  })

  it('20 张图铺成 4 行 5 列，且无重叠', () => {
    const positions = layoutGrid(Array.from({ length: 20 }, () => SIZE))
    const rows = new Set(positions.map((p) => p.y))

    expect(positions).toHaveLength(20)
    expect(rows.size).toBe(4)

    // 相邻卡片矩形不相交（同行同列必然间距 > 0）
    for (let i = 1; i < positions.length; i += 1) {
      const prev = positions[i - 1]
      const curr = positions[i]
      const sameRow = prev.y === curr.y
      if (sameRow) {
        expect(curr.x - prev.x).toBeGreaterThanOrEqual(SIZE.w)
      } else {
        expect(curr.y - prev.y).toBeGreaterThanOrEqual(SIZE.h)
      }
    }
  })

  it('支持自定义参数（起始位置 / 列数 / 间距）', () => {
    const positions = layoutGrid([SIZE, SIZE, SIZE], {
      startX: 0,
      startY: 0,
      columns: 2,
      gapX: 10,
      gapY: 20,
    })

    expect(positions[0]).toEqual({ x: 0, y: 0 })
    expect(positions[1]).toEqual({ x: 230, y: 0 })
    expect(positions[2]).toEqual({ x: 0, y: 240 })
  })

  it('列数为 1 时退化为单列竖排', () => {
    const positions = layoutGrid([SIZE, SIZE], { columns: 1 })
    expect(positions[0].x).toBe(positions[1].x)
    expect(positions[1].y).toBeGreaterThan(positions[0].y)
  })

  it('列数非法（0 或负数）被兜底为 1，不产生死循环或重叠', () => {
    const positions = layoutGrid([SIZE, SIZE], { columns: 0 })
    expect(positions).toHaveLength(2)
    expect(positions[1].y).toBeGreaterThan(positions[0].y)
  })
})
