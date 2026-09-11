// ============================================================================
// 模块说明（中文）
// 目录内容 → 卡片 的单元测试。对应 T1.3：
//   「调 list_dir 读图片，按网格自动铺开」（不堆在原点、间距均匀、id 不冲突）
//
// 实现任务：T1.3（阶段一）。
// ============================================================================

import { describe, it, expect } from 'vitest'

import { createCardsFromEntries, selectMediaEntries } from '@/core/board/buildCards'
import { CORE_CARD_TYPE_DEFAULT_SIZE } from '@/core/registry/cardTypes'
import { DEFAULT_GRID_OPTIONS } from '@/core/board/grid'
import type { DirEntry } from '@/core/storage/StorageProvider'

function entry(name: string, isDir = false): DirEntry {
  return { name, path: `D:\\空间\\${name}`, isDir, size: 1024, modifiedAt: 1_760_000_000_000 }
}

describe('selectMediaEntries', () => {
  it('跳过子目录（分区框属 T2.5）', () => {
    const selected = selectMediaEntries([entry('a.jpg'), entry('参考资料', true)])
    expect(selected.map((item) => item.name)).toEqual(['a.jpg'])
  })

  it('跳过以 . 开头的隐藏文件（.DS_Store 之类）', () => {
    const selected = selectMediaEntries([entry('.DS_Store'), entry('.hidden.jpg'), entry('a.jpg')])
    expect(selected.map((item) => item.name)).toEqual(['a.jpg'])
  })

  it('不以点开头的文件照常保留', () => {
    const selected = selectMediaEntries([entry('Thumbs.db')])
    expect(selected.map((item) => item.name)).toEqual(['Thumbs.db'])
  })
})

describe('createCardsFromEntries', () => {
  it('空目录 → 空卡片数组', () => {
    expect(createCardsFromEntries([])).toEqual([])
    expect(createCardsFromEntries([entry('子目录', true)])).toEqual([])
  })

  it('图片生成 image 卡片、非图片生成 file 卡片（9 章分流）', () => {
    const cards = createCardsFromEntries([entry('参考图.jpg'), entry('总平面.pdf')])

    expect(cards).toHaveLength(2)
    expect(cards[0].type).toBe('image')
    expect(cards[1].type).toBe('file')
  })

  it('filePath / originalPath 为相对空间文件夹的路径（4.2 字段定义）', () => {
    const [card] = createCardsFromEntries([entry('杭州植物园 香樟.jpg')])
    expect(card.filePath).toBe('杭州植物园 香樟.jpg')
    expect(card.originalPath).toBe('杭州植物园 香樟.jpg')
  })

  it('id 从 c_001 起递增且互不重复', () => {
    const cards = createCardsFromEntries([entry('a.jpg'), entry('b.jpg'), entry('c.jpg')])
    expect(cards.map((card) => card.id)).toEqual(['c_001', 'c_002', 'c_003'])
  })

  it('existingCardIds 里的 id 不会被重复使用', () => {
    const cards = createCardsFromEntries([entry('a.jpg'), entry('b.jpg')], {
      existingCardIds: ['c_001', 'c_002', 'c_003'],
    })
    expect(cards.map((card) => card.id)).toEqual(['c_004', 'c_005'])
  })

  it('位置来自网格：第一张在边距处，第二张向右一个卡片宽 + 间距', () => {
    const cards = createCardsFromEntries([entry('a.jpg'), entry('b.jpg')])
    const size = CORE_CARD_TYPE_DEFAULT_SIZE.image

    expect(cards[0].x).toBe(DEFAULT_GRID_OPTIONS.startX)
    expect(cards[0].y).toBe(DEFAULT_GRID_OPTIONS.startY)
    expect(cards[1].x).toBe(DEFAULT_GRID_OPTIONS.startX + size.w + DEFAULT_GRID_OPTIONS.gapX)
    expect(cards[1].y).toBe(cards[0].y)
  })

  it('20 张图 → 20 张卡片，4 行 5 列，无重叠', () => {
    const entries = Array.from({ length: 20 }, (_, i) => entry(`ref-${String(i + 1).padStart(2, '0')}.jpg`))
    const cards = createCardsFromEntries(entries)

    expect(cards).toHaveLength(20)
    expect(new Set(cards.map((card) => card.y)).size).toBe(4)
    expect(new Set(cards.map((card) => card.id)).size).toBe(20)
  })

  it('默认尺寸来自卡片类型注册表', () => {
    const cards = createCardsFromEntries([entry('a.jpg'), entry('a.pdf')])
    expect(cards[0].w).toBe(CORE_CARD_TYPE_DEFAULT_SIZE.image.w)
    expect(cards[0].h).toBe(CORE_CARD_TYPE_DEFAULT_SIZE.image.h)
    expect(cards[1].w).toBe(CORE_CARD_TYPE_DEFAULT_SIZE.file.w)
    expect(cards[1].h).toBe(CORE_CARD_TYPE_DEFAULT_SIZE.file.h)
  })

  it('sizeFor 可覆盖尺寸（T1.4 用图片原始宽高比接入）', () => {
    const cards = createCardsFromEntries([entry('wide.jpg'), entry('tall.jpg')], {
      sizeFor: (item) => (item.name === 'wide.jpg' ? { w: 400, h: 200 } : { w: 200, h: 400 }),
    })

    expect(cards[0]).toMatchObject({ w: 400, h: 200 })
    expect(cards[1]).toMatchObject({ w: 200, h: 400 })
    // 第二行高度取该行最高的卡片：不重叠
    expect(cards[1].x).toBeGreaterThanOrEqual(cards[0].x + 400)
  })

  it('默认字段（rotation / zIndex / note / meta）由 schema 补齐', () => {
    const [card] = createCardsFromEntries([entry('a.jpg')])
    expect(card.rotation).toBe(0)
    expect(card.zIndex).toBe(0)
    expect(card.note).toBe('')
    expect(card.meta).toEqual({})
  })
})
