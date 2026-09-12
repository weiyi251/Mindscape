// ============================================================================
// 模块说明（中文）
// 卡片资源表的单元测试。对应方案 A（2026-09-12 用户裁决）：资源表只存原图绝对路径。
//
// 重点守护两条：
//   1. 只有 image 卡片进表（其他类型没有图片资源）
//   2. 原图路径是「空间文件夹 + 卡片相对路径」拼出来的完整绝对路径
//      —— 17.5 铁律要求前端拼好绝对路径再交给 Rust
//
// 实现任务：T1.4（阶段一）→ 2026-09-12 重构（方案 A）。
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest'

import {
  cardAssetCount,
  clearCardAssets,
  getCardAsset,
  getCardOriginalPath,
  registerCardAssets,
  setCardAsset,
} from '@/core/board/cardAssets'
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

beforeEach(() => {
  clearCardAssets()
})

describe('setCardAsset / getter', () => {
  it('写入后可读回原图路径', () => {
    setCardAsset('c_001', { originalPath: 'D:\\s\\a.jpg' })

    expect(getCardOriginalPath('c_001')).toBe('D:\\s\\a.jpg')
    expect(getCardAsset('c_001')).toEqual({ originalPath: 'D:\\s\\a.jpg' })
  })

  it('未登记的卡片返回空串（渲染层据此退回占位样式）', () => {
    expect(getCardOriginalPath('nope')).toBe('')
    expect(getCardAsset('nope')).toBeUndefined()
  })

  it('clearCardAssets 清空并归零计数', () => {
    setCardAsset('c_001', { originalPath: 'a' })
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

    registerCardAssets(cards, SPACE_PATH)

    expect(cardAssetCount()).toBe(1)
    expect(getCardAsset('c_002')).toBeUndefined()
    expect(getCardAsset('c_003')).toBeUndefined()
  })

  it('原图路径 = 空间文件夹 + 卡片相对路径（Windows 反斜杠）', () => {
    registerCardAssets(
      [makeCard({ id: 'c_001', filePath: '参考资料\\ref-01.jpg' })],
      SPACE_PATH,
    )

    expect(getCardOriginalPath('c_001')).toBe('D:\\Mindscape\\01_项目A\\参考资料\\ref-01.jpg')
  })

  it('登记不依赖任何批量生成结果（方案 A：无缩略图也可直接登记）', () => {
    // 方案 A下资源表只做「相对路径 → 绝对路径」的拼接，不再依赖 Rust 侧返回值
    registerCardAssets([makeCard({ id: 'c_001', filePath: 'bad.jpg' })], SPACE_PATH)

    expect(getCardOriginalPath('c_001')).toBe('D:\\Mindscape\\01_项目A\\bad.jpg')
  })

  it('重复登记同一批卡片是幂等的（不会留下旧键）', () => {
    const cards = [makeCard({ id: 'c_001', filePath: 'a.jpg' })]
    registerCardAssets(cards, 'D:\\空间甲')
    registerCardAssets(cards, 'D:\\空间乙')

    expect(cardAssetCount()).toBe(1)
    expect(getCardOriginalPath('c_001')).toBe('D:\\空间乙\\a.jpg')
  })
})
