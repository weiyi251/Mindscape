// ============================================================================
// 模块说明（中文）
// 布局合并的单元测试。对应 T1.6：
//   「调完视图关闭再开，视图状态还原」—— 卡片位置不丢，新文件也不漏。
//
// 实现任务：T1.6（阶段一）。
// ============================================================================

import { describe, it, expect } from 'vitest'

import { mergeScannedWithLayout } from '@/core/board/layoutMerge'
import { createCardsFromEntries } from '@/core/board/buildCards'
import { DEFAULT_GRID_OPTIONS } from '@/core/board/grid'
import { zCardSchema } from '@/core/types'
import type { Card } from '@/core/types'
import type { DirEntry } from '@/core/storage/StorageProvider'

function entry(name: string): DirEntry {
  return { name, path: `D:\\空间\\${name}`, isDir: false, size: 1024, modifiedAt: 1 }
}

/** 造一张「layout 里记录的」卡片 */
function savedCard(over: Partial<Card> = {}): Card {
  return zCardSchema.parse({
    id: 'c_001',
    type: 'image',
    filePath: 'a.jpg',
    originalPath: 'a.jpg',
    x: 777,
    y: 888,
    w: 300,
    h: 200,
    ...over,
  })
}

function paths(cards: readonly Card[]): string[] {
  return cards.map((card) => card.filePath)
}

describe('mergeScannedWithLayout', () => {
  it('layout 为空 → 全部按扫描结果（等同首次进入）', () => {
    const scanned = createCardsFromEntries([entry('a.jpg'), entry('b.jpg')])

    const result = mergeScannedWithLayout(scanned, [])

    expect(paths(result.cards)).toEqual(['a.jpg', 'b.jpg'])
    expect(result.added).toBe(2)
    expect(result.missing).toEqual([])
  })

  it('两边都有 → 保留 layout 的位置、尺寸、备注与 id', () => {
    const scanned = createCardsFromEntries([entry('a.jpg')])
    const saved = savedCard({ id: 'c_009', filePath: 'a.jpg', x: 1200, y: 640, note: '重点' })

    const result = mergeScannedWithLayout(scanned, [saved])

    expect(result.cards).toHaveLength(1)
    expect(result.cards[0]).toMatchObject({
      id: 'c_009',
      x: 1200,
      y: 640,
      note: '重点',
      filePath: 'a.jpg',
    })
    expect(result.added).toBe(0)
  })

  it('只在 layout 里有的卡片 → 本次不显示，记入 missing', () => {
    const scanned = createCardsFromEntries([entry('a.jpg')])

    const result = mergeScannedWithLayout(scanned, [
      savedCard({ id: 'c_001', filePath: 'a.jpg' }),
      savedCard({ id: 'c_002', filePath: '被删掉的老图.jpg' }),
    ])

    expect(paths(result.cards)).toEqual(['a.jpg'])
    expect(result.missing.map((card) => card.filePath)).toEqual(['被删掉的老图.jpg'])
  })

  it('只在文件夹里有的新文件 → 接在既有内容**下方**，不覆盖已有位置', () => {
    const scanned = createCardsFromEntries([entry('a.jpg'), entry('新图.jpg')])
    const saved = savedCard({ id: 'c_001', filePath: 'a.jpg', x: 777, y: 888, w: 240, h: 180 })

    const result = mergeScannedWithLayout(scanned, [saved])

    const fresh = result.cards.find((card) => card.filePath === '新图.jpg')
    expect(fresh).toBeDefined()
    // 既有卡片位置原样保留
    expect(result.cards.find((card) => card.filePath === 'a.jpg')?.x).toBe(777)
    // 新卡片在既有卡片底边之下
    expect(fresh!.y).toBe(888 + 180 + DEFAULT_GRID_OPTIONS.gapY)
    expect(fresh!.x).toBe(DEFAULT_GRID_OPTIONS.startX)
  })

  it('没有任何既有布局时保留扫描位置（不重铺）', () => {
    const scanned = createCardsFromEntries([entry('a.jpg')])
    // layout 里记录的是别的文件，故 a.jpg 算新卡片；kept 为空 → 扫描位置即最终位置
    // （T2.5：分区框卡片按独立行带扫描，重铺会打散分组排布）
    const result = mergeScannedWithLayout(scanned, [savedCard({ filePath: '别的.jpg' })])

    expect(result.cards.find((card) => card.filePath === 'a.jpg')?.y).toBe(
      DEFAULT_GRID_OPTIONS.startY,
    )
    expect(result.added).toBe(1)
  })

  it('新卡片的 id 从 layout 已有 id 之后接着排，不冲突', () => {
    const scanned = createCardsFromEntries([entry('a.jpg'), entry('b.jpg')])
    const saved = savedCard({ id: 'c_007', filePath: 'a.jpg' })

    const result = mergeScannedWithLayout(scanned, [saved])
    const ids = result.cards.map((card) => card.id)

    expect(ids).toEqual(['c_007', 'c_008'])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('同名文件被换成别的格式 → 卡片类型跟着更新', () => {
    const scanned = createCardsFromEntries([entry('a.jpg')])
    const saved = savedCard({ filePath: 'a.jpg', type: 'file' })

    const result = mergeScannedWithLayout(scanned, [saved])

    expect(result.cards[0].type).toBe('image')
  })

  it('idempotent：把合并结果再合并一次，结果不变', () => {
    const scanned = createCardsFromEntries([entry('a.jpg'), entry('b.jpg')])
    const saved = [savedCard({ id: 'c_001', filePath: 'a.jpg', x: 10, y: 20 })]

    const first = mergeScannedWithLayout(scanned, saved)
    const second = mergeScannedWithLayout(scanned, first.cards)

    expect(second.cards).toEqual(first.cards)
    expect(second.added).toBe(0)
  })

  it('空文件夹 + 有 layout → 零卡片，全部进 missing', () => {
    const result = mergeScannedWithLayout([], [savedCard()])

    expect(result.cards).toEqual([])
    expect(result.missing).toHaveLength(1)
  })

  // ---------------------------------------------------------------------------
  // 2026-09-13 修复回归：便签（filePath 为空）重进空间后不得消失
  // ---------------------------------------------------------------------------

  /** 造一张 layout 里记录的便签（无文件，meta.tags 只存在于 layout） */
  function savedNote(over: Partial<Card> = {}): Card {
    return zCardSchema.parse({
      id: 'c_900',
      type: 'note',
      filePath: '',
      originalPath: '',
      x: 400,
      y: 100,
      w: 200,
      h: 160,
      note: '想法',
      meta: { tags: ['灵感'] },
      ...over,
    })
  }

  it('便签（filePath 为空）重进后原样保留（含标签与备注），不进 missing', () => {
    const scanned = createCardsFromEntries([entry('a.jpg')])
    const result = mergeScannedWithLayout(scanned, [
      savedCard({ id: 'c_001', filePath: 'a.jpg' }),
      savedNote(),
    ])

    const note = result.cards.find((card) => card.id === 'c_900')
    expect(note).toBeDefined()
    expect(note!.type).toBe('note')
    expect(note!.note).toBe('想法')
    expect(note!.meta.tags).toEqual(['灵感'])
    expect(note!.x).toBe(400)
    // 文件卡 missing 语义不变：便签不计入 missing
    expect(result.missing).toEqual([])
  })

  it('空文件夹 + 只有便签 → 便签保留（此前会被整卡丢弃）', () => {
    const result = mergeScannedWithLayout([], [savedNote()])

    expect(result.cards).toHaveLength(1)
    expect(result.cards[0].id).toBe('c_900')
    expect(result.missing).toEqual([])
  })

  it('文件卡片上的 meta.tags 以 layout 为准保留', () => {
    const scanned = createCardsFromEntries([entry('a.jpg')])
    const saved = savedCard({ id: 'c_001', filePath: 'a.jpg', meta: { tags: ['参考', '待定'] } })

    const result = mergeScannedWithLayout(scanned, [saved])

    expect(result.cards[0].meta.tags).toEqual(['参考', '待定'])
  })

  it('便签场景同样幂等：合并结果再合并不变、不重复', () => {
    const scanned = createCardsFromEntries([entry('a.jpg')])
    const first = mergeScannedWithLayout(scanned, [
      savedCard({ id: 'c_001', filePath: 'a.jpg' }),
      savedNote(),
    ])
    const second = mergeScannedWithLayout(scanned, first.cards)

    expect(second.cards).toEqual(first.cards)
    expect(second.cards.filter((card) => card.id === 'c_900')).toHaveLength(1)
  })
})
