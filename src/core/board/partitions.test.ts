// ============================================================================
// 模块说明（中文）
// 分区框纯计算（partitions）的单元测试（T2.5）。
// ============================================================================

import { describe, expect, it } from 'vitest'

import type { Card, Partition } from '@/core/types'
import {
  PARTITION_PALETTE,
  PARTITION_PADDING,
  PARTITION_TITLE_HEIGHT,
  boundingBoxOfCards,
  createPartitions,
  resolvePartitionColor,
  selectPartitionDirs,
} from './partitions'

function card(partial: Partial<Card>): Card {
  return {
    id: 'c_001',
    type: 'image',
    filePath: 'a.jpg',
    originalPath: 'a.jpg',
    x: 0,
    y: 0,
    w: 100,
    h: 80,
    rotation: 0,
    zIndex: 0,
    note: '',
    meta: {},
    ...partial,
  }
}

function partition(partial: Partial<Partition>): Partition {
  return {
    id: 'p_001',
    name: '参考资料',
    folderPath: '参考资料',
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    color: 'auto',
    collapsed: false,
    meta: {},
    ...partial,
  }
}

describe('selectPartitionDirs', () => {
  const entries = [
    { name: '参考资料', isDir: true },
    { name: '.mindscape', isDir: true },
    { name: '_已移除', isDir: true },
    { name: '.隐藏目录', isDir: true },
    { name: 'a.jpg', isDir: false },
    { name: '普通文件.txt', isDir: false },
  ]

  it('只保留普通子文件夹，排除保留目录 / 隐藏目录 / 文件', () => {
    expect(selectPartitionDirs(entries)).toEqual([{ name: '参考资料', isDir: true }])
  })

  it('空目录项返回空数组', () => {
    expect(selectPartitionDirs([])).toEqual([])
  })
})

describe('resolvePartitionColor', () => {
  it('auto 按序取色并循环轮换', () => {
    expect(resolvePartitionColor('auto', 0)).toBe(PARTITION_PALETTE[0])
    expect(resolvePartitionColor('auto', 3)).toBe(PARTITION_PALETTE[3])
    expect(resolvePartitionColor('auto', 8)).toBe(PARTITION_PALETTE[0]) // 8 色 → 回绕
  })

  it('手动指定的颜色原样返回', () => {
    expect(resolvePartitionColor('#FF0000', 2)).toBe('#FF0000')
  })
})

describe('boundingBoxOfCards', () => {
  it('包住所有卡片的最小矩形', () => {
    const box = boundingBoxOfCards([
      card({ x: 10, y: 20, w: 100, h: 80 }),
      card({ x: 150, y: 0, w: 60, h: 40 }),
    ])
    expect(box).toEqual({ x: 10, y: 0, w: 200, h: 100 })
  })

  it('空数组返回 null', () => {
    expect(boundingBoxOfCards([])).toBeNull()
  })
})

describe('createPartitions', () => {
  it('新子文件夹：框 = 包围盒 + padding + 标题条，folderPath = 文件夹名', () => {
    const names = ['灵感收集']
    const cards = [
      card({ id: 'c_001', filePath: '灵感收集/a.jpg', group: '灵感收集', x: 80, y: 80 }),
      card({ id: 'c_002', filePath: '灵感收集/b.jpg', group: '灵感收集', x: 212, y: 80 }),
      card({ id: 'c_003', filePath: '根目录图.jpg' }), // 根目录卡片不参与
    ]

    const [result] = createPartitions(names, cards, [])
    expect(result.name).toBe('灵感收集')
    expect(result.folderPath).toBe('灵感收集')
    expect(result.x).toBe(80 - PARTITION_PADDING)
    expect(result.y).toBe(80 - PARTITION_TITLE_HEIGHT - PARTITION_PADDING)
    expect(result.w).toBe(232 + PARTITION_PADDING * 2) // 80..312
    expect(result.h).toBe(80 + PARTITION_TITLE_HEIGHT + PARTITION_PADDING * 2)
    expect(result.collapsed).toBe(false)
  })

  it('已有记录：框完全沿用（位置 / 折叠 / 颜色都保留）', () => {
    const saved = partition({ id: 'p_001', name: '灵感收集', folderPath: '灵感收集', x: 500, y: 400, w: 300, h: 200, collapsed: true })
    const cards = [card({ group: '灵感收集', x: 999, y: 999 })] // 卡片位置再离谱也不影响

    const results = createPartitions(['灵感收集'], cards, [saved])
    expect(results).toEqual([saved])
  })

  it('空子文件夹不建框', () => {
    const results = createPartitions(['空文件夹'], [], [])
    expect(results).toEqual([])
  })

  it('文件夹被删除时框一并丢弃', () => {
    const saved = partition({ folderPath: '已删除的文件夹' })
    const results = createPartitions(['别的文件夹'], [], [saved])
    expect(results).toEqual([])
  })

  it('多个新框：id 递增、颜色按序轮换', () => {
    const names = ['A', 'B']
    const cards = [
      card({ id: 'c_001', group: 'A', x: 0, y: 0, w: 50, h: 50 }),
      card({ id: 'c_002', group: 'B', x: 300, y: 300, w: 50, h: 50 }),
    ]

    const results = createPartitions(names, cards, [])
    expect(results.map((item) => item.id)).toEqual(['p_001', 'p_002'])
    expect(results[0].color).toBe(PARTITION_PALETTE[0])
    expect(results[1].color).toBe(PARTITION_PALETTE[1])
  })

  it('已有 + 新建混合：id 接着已有记录递增，新框颜色从 0 号色开始', () => {
    const saved = partition({ id: 'p_001', folderPath: 'A', name: 'A' })
    const cards = [card({ id: 'c_001', group: 'B', x: 0, y: 0, w: 50, h: 50 })]

    const results = createPartitions(['A', 'B'], cards, [saved])
    expect(results).toHaveLength(2)
    expect(results[0].id).toBe('p_001') // 沿用
    expect(results[1].id).toBe('p_002') // 接着递增
    expect(results[1].color).toBe(PARTITION_PALETTE[0]) // 新框从 0 号色开始
  })
})
