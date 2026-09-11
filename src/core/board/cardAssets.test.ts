// ============================================================================
// 模块说明（中文）
// 卡片资源表的单元测试。对应 T1.4：卡片渲染要能拿到缩略图 / 原图的绝对路径。
//
// 重点守护两条：
//   1. 只有 image 卡片进表（其他类型没有图片资源）
//   2. 原图路径是「空间文件夹 + 卡片相对路径」拼出来的完整绝对路径
//      —— 17.5 铁律要求前端拼好绝对路径再交给 Rust
//
// 实现任务：T1.4（阶段一）。
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest'

import {
  cardAssetCount,
  clearCardAssets,
  getCardAsset,
  getCardOriginalPath,
  getCardThumbnailPath,
  registerCardAssets,
  setCardAsset,
} from '@/core/board/cardAssets'
import type { ThumbnailBatchResult } from '@/core/board/thumbnails'
import { zCardSchema } from '@/core/types'
import type { Card } from '@/core/types'

const SPACE_PATH = 'D:\\Mindscape\\01_项目A'

function makeCard(over: Partial<Card> = {}): Card {
  return zCardSchema.parse({
    id: 'c_001',
    type: 'image',
    filePath: 'ref-01.jpg',
    originalPath: 'ref-01.jpg',
    x: 0,
    y: 0,
    w: 240,
    h: 180,
    ...over,
  })
}

function thumbs(entries: [string, string][]): ThumbnailBatchResult {
  return {
    byName: new Map(
      entries.map(([name, path]) => [name, { path, width: 800, height: 600 }]),
    ),
    failed: new Map(),
  }
}

beforeEach(() => {
  clearCardAssets()
})

describe('setCardAsset / getter', () => {
  it('写入后可读回缩略图与原图路径', () => {
    setCardAsset('c_001', { thumbnailPath: 'D:\\t\\a.webp', originalPath: 'D:\\s\\a.jpg' })

    expect(getCardThumbnailPath('c_001')).toBe('D:\\t\\a.webp')
    expect(getCardOriginalPath('c_001')).toBe('D:\\s\\a.jpg')
    expect(getCardAsset('c_001')).toEqual({
      thumbnailPath: 'D:\\t\\a.webp',
      originalPath: 'D:\\s\\a.jpg',
    })
  })

  it('未登记的卡片返回空串（渲染层据此退回占位样式）', () => {
    expect(getCardThumbnailPath('nope')).toBe('')
    expect(getCardOriginalPath('nope')).toBe('')
    expect(getCardAsset('nope')).toBeUndefined()
  })

  it('clearCardAssets 清空并归零计数', () => {
    setCardAsset('c_001', { thumbnailPath: 'a', originalPath: 'b' })
    expect(cardAssetCount()).toBe(1)

    clearCardAssets()
    expect(cardAssetCount()).toBe(0)
    expect(getCardAsset('c_001')).toBeUndefined()
  })
})

describe('registerCardAssets', () => {
  it('只登记 image 卡片，文件 / 便签不进表', () => {
    const cards = [
      makeCard({ id: 'c_001', type: 'image', filePath: 'a.jpg' }),
      makeCard({ id: 'c_002', type: 'file', filePath: '总平面.pdf' }),
      makeCard({ id: 'c_003', type: 'note', filePath: '' }),
    ]

    registerCardAssets(cards, SPACE_PATH, thumbs([['a.jpg', 'D:\\t\\a.webp']]))

    expect(cardAssetCount()).toBe(1)
    expect(getCardAsset('c_002')).toBeUndefined()
    expect(getCardAsset('c_003')).toBeUndefined()
  })

  it('原图路径 = 空间文件夹 + 卡片相对路径（Windows 反斜杠）', () => {
    registerCardAssets(
      [makeCard({ id: 'c_001', filePath: '参考资料\\ref-01.jpg' })],
      SPACE_PATH,
      thumbs([['参考资料\\ref-01.jpg', 'D:\\t\\ref.webp']]),
    )

    expect(getCardOriginalPath('c_001')).toBe('D:\\Mindscape\\01_项目A\\参考资料\\ref-01.jpg')
  })

  it('缩略图命中 → 用 Rust 返回的路径', () => {
    const result = thumbs([['a.jpg', 'D:\\Mindscape\\01_项目A\\.mindscape\\thumbnails\\ab12.webp']])
    registerCardAssets([makeCard({ id: 'c_001', filePath: 'a.jpg' })], SPACE_PATH, result)

    expect(getCardThumbnailPath('c_001')).toBe(
      'D:\\Mindscape\\01_项目A\\.mindscape\\thumbnails\\ab12.webp',
    )
  })

  it('缩略图缺失（生成失败）→ 缩略图路径为空串，但原图路径仍可用', () => {
    registerCardAssets([makeCard({ id: 'c_001', filePath: 'bad.jpg' })], SPACE_PATH, {
      byName: new Map(),
      failed: new Map([['bad.jpg', '解码图片失败']]),
    })

    expect(getCardThumbnailPath('c_001')).toBe('')
    expect(getCardOriginalPath('c_001')).toBe('D:\\Mindscape\\01_项目A\\bad.jpg')
  })

  it('重复登记同一批卡片是幂等的（不会留下旧键）', () => {
    const cards = [makeCard({ id: 'c_001', filePath: 'a.jpg' })]
    registerCardAssets(cards, SPACE_PATH, thumbs([['a.jpg', 'D:\\t\\1.webp']]))
    registerCardAssets(cards, SPACE_PATH, thumbs([['a.jpg', 'D:\\t\\2.webp']]))

    expect(cardAssetCount()).toBe(1)
    expect(getCardThumbnailPath('c_001')).toBe('D:\\t\\2.webp')
  })
})
