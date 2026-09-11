// ============================================================================
// 模块说明（中文）
// id 生成单元测试。对应 T1.1：空间 id 需与 4.1 示例（sp_001）一致，
// 且不因删除而复用序号。
//
// 实现任务：T1.1（阶段一）。
// ============================================================================

import { describe, it, expect } from 'vitest'

import { nextSpaceId, nextCardId, nextPartitionId, dedupeIds } from '@/core/utils/id'

describe('nextSpaceId', () => {
  it('空列表返回 sp_001（与 4.1 示例一致）', () => {
    expect(nextSpaceId([])).toBe('sp_001')
  })

  it('按最大序号 +1', () => {
    expect(nextSpaceId(['sp_001'])).toBe('sp_002')
    expect(nextSpaceId(['sp_001', 'sp_002', 'sp_003'])).toBe('sp_004')
  })

  it('乱序也取最大值', () => {
    expect(nextSpaceId(['sp_003', 'sp_001', 'sp_009', 'sp_002'])).toBe('sp_010')
  })

  it('忽略不符合格式的 id', () => {
    expect(nextSpaceId(['sp_abc', 'random', 'sp_x1'])).toBe('sp_001')
  })

  it('跨过三位数后继续递增（不截断）', () => {
    expect(nextSpaceId(['sp_999'])).toBe('sp_1000')
  })

  it('删除不影响序号（只增不减）', () => {
    const ids = ['sp_001', 'sp_002', 'sp_003']
    expect(nextSpaceId(ids)).toBe('sp_004')
    expect(nextSpaceId(['sp_001', 'sp_003'])).toBe('sp_004')
  })
})

describe('nextCardId / nextPartitionId', () => {
  it('使用 c_ / p_ 前缀且互不干扰', () => {
    expect(nextCardId([])).toBe('c_001')
    expect(nextPartitionId([])).toBe('p_001')
    expect(nextCardId(['c_007'])).toBe('c_008')
    expect(nextPartitionId(['p_012'])).toBe('p_013')
  })
})

describe('dedupeIds（历史撞号数据迁移）', () => {
  it('重复 id 保留首次出现，后续重新编号', () => {
    const items = [
      { id: 'c_003', tag: 'a' },
      { id: 'c_001', tag: 'b' },
      { id: 'c_003', tag: 'c' },
      { id: 'c_003', tag: 'd' },
    ]
    const result = dedupeIds(items)
    expect(result.map((item) => item.id)).toEqual(['c_003', 'c_001', 'c_004', 'c_005'])
    // 其余字段原样保留
    expect(result[2]).toEqual({ id: 'c_004', tag: 'c' })
  })

  it('不同前缀的 id 互不干扰，新 id 沿用原前缀与位宽', () => {
    const items = [{ id: 'c_002' }, { id: 'p_002' }, { id: 'c_002' }, { id: 'p_002' }]
    expect(dedupeIds(items).map((item) => item.id)).toEqual(['c_002', 'p_002', 'c_003', 'p_003'])
  })

  it('新 id 跨过现有最大序号（含位数不同的同前缀 id）', () => {
    const items = [{ id: 'c_9' }, { id: 'c_9' }]
    expect(dedupeIds(items).map((item) => item.id)).toEqual(['c_9', 'c_10'])
  })

  it('无重复时原样返回（不产生任何新 id）', () => {
    const items = [{ id: 'c_001' }, { id: 'c_002' }]
    expect(dedupeIds(items)).toEqual(items)
  })

  it('混合实体去重：卡片与 removed 记录在同一池中比较（恢复错配修复的场景）', () => {
    const cards = [{ id: 'c_012', filePath: 'a.png' }]
    const removed = [
      { id: 'c_012', originalPath: 'a.png', movedTo: '_已移除/a.png' },
      { id: 'c_012', originalPath: 'b.png', movedTo: '_已移除/b.png' },
    ]
    const deduped = dedupeIds([...cards, ...removed])
    const dedupedCards = deduped.slice(0, cards.length)
    const dedupedRemoved = deduped.slice(cards.length)
    expect(dedupedCards.map((item) => item.id)).toEqual(['c_012'])
    expect(dedupedRemoved.map((item) => item.id)).toEqual(['c_013', 'c_014'])
  })
})
