// ============================================================================
// 模块说明（中文）
// 分区框纯计算（partitions）的单元测试（T2.5）。
// ============================================================================

import { describe, expect, it } from 'vitest'

import type { Card, Partition } from '@/core/types'
import {
  FRAME_PLACEMENT_GAP,
  NEW_PARTITION_HEIGHT,
  NEW_PARTITION_WIDTH,
  PARTITION_PALETTE,
  PARTITION_PADDING,
  PARTITION_TITLE_HEIGHT,
  boundingBoxOfCards,
  checkNewPartitionName,
  createPartitionAt,
  createPartitions,
  createPartitionsForFolders,
  findUnframedFolders,
  isReservedPartitionName,
  isValidFolderName,
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

// ---------------------------------------------------------------------------
// 手动新建分区（2026-09-14 用户要求：空间内直接创建分区）
// ---------------------------------------------------------------------------

describe('isReservedPartitionName', () => {
  it('保留目录名（.mindscape / _已移除）判定为保留，前后空格不影响', () => {
    expect(isReservedPartitionName('.mindscape')).toBe(true)
    expect(isReservedPartitionName('_已移除')).toBe(true)
    expect(isReservedPartitionName('  _已移除  ')).toBe(true)
  })

  it('普通目录名不是保留名', () => {
    expect(isReservedPartitionName('参考资料')).toBe(false)
    expect(isReservedPartitionName('_已移除备份')).toBe(false)
  })
})

describe('checkNewPartitionName', () => {
  const existing = [partition({ id: 'p_001', name: '参考资料', folderPath: '参考资料' })]

  it('可用名返回 null（前后空格自动忽略）', () => {
    expect(checkNewPartitionName('旅行', existing)).toBeNull()
    expect(checkNewPartitionName('  旅行  ', existing)).toBeNull()
  })

  it('空名 / 纯空格 → empty', () => {
    expect(checkNewPartitionName('', existing)).toBe('empty')
    expect(checkNewPartitionName('   ', existing)).toBe('empty')
  })

  it('非法字符 / 以 . 开头 → invalid', () => {
    expect(checkNewPartitionName('a/b', existing)).toBe('invalid')
    expect(checkNewPartitionName('a:b', existing)).toBe('invalid')
    expect(checkNewPartitionName('.隐藏', existing)).toBe('invalid')
  })

  it('保留目录名 → reserved（否则刷新后框会消失）', () => {
    expect(checkNewPartitionName('_已移除', existing)).toBe('reserved')
    expect(checkNewPartitionName('.mindscape', existing)).toBe('reserved')
  })

  it('画布上已有同名 / 同 folderPath → duplicate', () => {
    expect(checkNewPartitionName('参考资料', existing)).toBe('duplicate')
    expect(checkNewPartitionName('参考资料', [partition({ id: 'p_002', name: '改名了', folderPath: '参考资料' })])).toBe(
      'duplicate',
    )
    // 自身不算重复（列表里没有同名项）
    expect(checkNewPartitionName('别的名字', existing)).toBeNull()
  })
})

describe('createPartitionAt', () => {
  it('以点击点为中心、用默认尺寸并取整（避免半像素边框模糊）', () => {
    const created = createPartitionAt('旅行', { x: 500, y: 300 }, [])
    expect(created.name).toBe('旅行')
    expect(created.folderPath).toBe('旅行') // 一层扫描：folderPath = 文件夹名
    expect(created.w).toBe(NEW_PARTITION_WIDTH)
    expect(created.h).toBe(NEW_PARTITION_HEIGHT)
    expect(created.x).toBe(Math.round(500 - NEW_PARTITION_WIDTH / 2))
    expect(created.y).toBe(Math.round(300 - NEW_PARTITION_HEIGHT / 2))
    expect(created.collapsed).toBe(false)
    expect(created.meta).toEqual({})
  })

  it('id 接着已有分区递增；颜色按现有数量从 8 色板轮换', () => {
    const created = createPartitionAt('第三个', { x: 0, y: 0 }, [
      partition({ id: 'p_001' }),
      partition({ id: 'p_002' }),
    ])
    expect(created.id).toBe('p_003')
    expect(created.color).toBe(PARTITION_PALETTE[2])
  })

  it('尺寸满足拖拽缩放的合法下限（不被 computePartitionResizeLimits 立刻夹小）', () => {
    const created = createPartitionAt('空框', { x: 0, y: 0 }, [])
    expect(created.w).toBeGreaterThanOrEqual(120)
    expect(created.h).toBeGreaterThanOrEqual(PARTITION_TITLE_HEIGHT)
  })
})

describe('isValidFolderName（与 Rust 侧双保险的既有规则回归）', () => {
  it('接受普通中文 / 英文名，拒绝空 / 保留符号 / 以点开头', () => {
    expect(isValidFolderName('参考资料')).toBe(true)
    expect(isValidFolderName('refs 2026')).toBe(true)
    expect(isValidFolderName('')).toBe(false)
    expect(isValidFolderName('a\\b')).toBe(false)
    expect(isValidFolderName('.')).toBe(false)
    expect(isValidFolderName('.git')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// A2（2026-09-20 用户计划第 2 步）：磁盘有子文件夹、画布无框 → 一键补框
// ---------------------------------------------------------------------------

describe('findUnframedFolders', () => {
  it('返回磁盘上有、画布上无框的文件夹名（保持扫描顺序）', () => {
    const existing = [partition({ id: 'p_001', name: 'A', folderPath: 'A' })]
    expect(findUnframedFolders(['A', '空文件夹', 'B'], existing)).toEqual(['空文件夹', 'B'])
  })

  it('按 folderPath 匹配：框改名后仍算「已建框」', () => {
    const existing = [partition({ id: 'p_001', name: '改名后的显示名', folderPath: '磁盘名' })]
    expect(findUnframedFolders(['磁盘名'], existing)).toEqual([])
  })

  it('画布上一个框都没有时全部算缺失；空输入返回空数组', () => {
    expect(findUnframedFolders(['A', 'B'], [])).toEqual(['A', 'B'])
    expect(findUnframedFolders([], [partition({})])).toEqual([])
  })

  it('重名目录项只报一次（防重复建框）', () => {
    expect(findUnframedFolders(['A', 'A'], [])).toEqual(['A'])
  })
})

describe('createPartitionsForFolders', () => {
  it('空文件夹用默认尺寸，并排在所有既有元素（分区框 + 卡片）的下方', () => {
    const existing = [partition({ id: 'p_001', folderPath: 'A', x: 100, y: 50, w: 300, h: 200 })]
    const cards = [card({ id: 'c_001', x: 0, y: 0, w: 220, h: 160 })]
    // 既有元素下缘 = max(50+200, 0+160) = 250
    const [created] = createPartitionsForFolders({ names: ['空文件夹'], cards, existing })

    expect(created.name).toBe('空文件夹')
    expect(created.folderPath).toBe('空文件夹')
    expect(created.w).toBe(NEW_PARTITION_WIDTH)
    expect(created.h).toBe(NEW_PARTITION_HEIGHT)
    expect(created.x).toBe(0) // 与既有元素的最左缘对齐
    expect(created.y).toBe(250 + FRAME_PLACEMENT_GAP)
    expect(created.collapsed).toBe(false)
    expect(created.meta).toEqual({})
  })

  it('多个空文件夹垂直依次排开，互不重叠', () => {
    const results = createPartitionsForFolders({ names: ['一', '二', '三'], cards: [], existing: [] })

    expect(results.map((item) => item.y)).toEqual([
      0,
      NEW_PARTITION_HEIGHT + FRAME_PLACEMENT_GAP,
      (NEW_PARTITION_HEIGHT + FRAME_PLACEMENT_GAP) * 2,
    ])
    expect(results.every((item) => item.x === 0)).toBe(true)
  })

  it('id 接着既有分区递增、配色接着既有数量轮换（避免撞色）', () => {
    const existing = [partition({ id: 'p_004', folderPath: 'A' })]
    const results = createPartitionsForFolders({ names: ['B'], cards: [], existing })

    expect(results[0].id).toBe('p_005')
    expect(results[0].color).toBe(PARTITION_PALETTE[1]) // 已有 1 个 → 从 1 号色开始
  })

  it('该文件夹在画布上有归属卡片时按包围盒定框（异常自愈路径）', () => {
    const cards = [
      card({ id: 'c_001', group: '有内容的', x: 80, y: 80, w: 132, h: 80 }),
      card({ id: 'c_002', group: '有内容的', x: 212, y: 80, w: 100, h: 80 }),
    ]
    const [created] = createPartitionsForFolders({ names: ['有内容的'], cards, existing: [] })

    expect(created.x).toBe(80 - PARTITION_PADDING)
    expect(created.y).toBe(80 - PARTITION_TITLE_HEIGHT - PARTITION_PADDING)
    expect(created.w).toBe(232 + PARTITION_PADDING * 2)
    expect(created.h).toBe(80 + PARTITION_TITLE_HEIGHT + PARTITION_PADDING * 2)
  })

  it('没有待补框的文件夹时返回空数组（不产生无意义命令）', () => {
    expect(createPartitionsForFolders({ names: [], cards: [], existing: [] })).toEqual([])
  })

  it('避让只由空框占位：有卡片的框不推进下方游标', () => {
    const cards = [card({ id: 'c_001', group: '有内容的', x: 0, y: 0, w: 100, h: 100 })]
    const results = createPartitionsForFolders({ names: ['有内容的', '空的'], cards, existing: [] })

    // 「空的」跟着障碍物下缘（卡片 y=0..100）往下排，而不是被「有内容的」框再往下推
    expect(results[1].y).toBe(100 + FRAME_PLACEMENT_GAP)
  })
})
