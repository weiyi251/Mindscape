// ============================================================================
// 模块说明（中文）
// pasteCardsFlow.ts（克隆型粘贴）的单元测试：便签与无文件插件卡两条克隆规则、
// 分组覆盖、坐标取整、以及「源卡不被改动」的复制语义。
// ============================================================================

import { describe, expect, it } from 'vitest'

import { zCardSchema } from '@/core/types'
import type { Card } from '@/core/types'

import { clonePastedCard } from './pasteCardsFlow'

function makeCard(overrides: Partial<Card> = {}): Card {
  return zCardSchema.parse({
    id: 'src_1',
    type: 'todo',
    filePath: '',
    originalPath: '',
    x: 40,
    y: 60,
    w: 220,
    h: 120,
    meta: { items: [{ id: 't1', text: '买牛奶', done: false }] },
    ...overrides,
  })
}

describe('clonePastedCard（克隆型粘贴）', () => {
  it('便签：克隆文字内容与尺寸，meta 不带（编辑层不跟副本走）', () => {
    const note = makeCard({
      type: 'note',
      note: '购物清单',
      meta: { tags: ['杂项'] },
    })
    const clone = clonePastedCard(note, 'new_1', 100.6, 200.4, null)

    expect(clone).toMatchObject({ id: 'new_1', type: 'note', note: '购物清单', w: 220, h: 120 })
    expect(clone.x).toBe(101) // 坐标取整，与建卡一致
    expect(clone.y).toBe(200)
    expect(clone.filePath).toBe('')
    expect(clone.meta).toEqual({})
  })

  it('无文件插件卡（待办等）：meta 是内容本体，整卡原样保留', () => {
    const clone = clonePastedCard(makeCard(), 'new_2', 10, 20, null)
    expect(clone.id).toBe('new_2')
    expect(clone.type).toBe('todo')
    expect(clone.meta).toEqual(makeCard().meta)
  })

  it('落点命中分区时分组随目标；空白落点保持源卡分组不变', () => {
    const grouped = makeCard({ group: '旧分区' })
    expect(clonePastedCard(grouped, 'new_3', 0, 0, '新分区').group).toBe('新分区')
    expect(clonePastedCard(grouped, 'new_4', 0, 0, null).group).toBe('旧分区')
  })

  it('不改动源卡（复制语义）', () => {
    const source = makeCard()
    clonePastedCard(source, 'new_5', 0, 0, '某分区')
    expect(source).toMatchObject({ id: 'src_1', x: 40, y: 60 })
  })
})
