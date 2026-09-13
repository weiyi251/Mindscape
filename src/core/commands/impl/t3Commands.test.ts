// ============================================================================
// 模块说明（中文）
// 连线命令与薄命令（备注 / 标签 / 颜色 / 置顶置底）的单元测试（T3.1 / T3.2 / T3.3 / T3.9）。
// 验收核心：do/undo 对称 —— undo 后状态与执行前完全一致（7.4）。
// ============================================================================

import { describe, expect, it } from 'vitest'

import { createConnectionCommand, createRemoveConnectionsCommand, createSetConnectionLabelCommand } from './connections'
import { createSetCardNoteCommand } from './setCardNote'
import { createSetCardMetaCommand } from './setCardMeta'
import { createSetPartitionColorCommand } from './setPartitionColor'
import { createSetCardsZIndexCommand, zIndexDeltasFor } from './setCardsZIndex'
import { metaWithTags, tagsOfMeta } from '@/core/board/cardMeta'
import type { Connection } from '@/core/types'

const CONNECTION: Connection = {
  id: 'conn_001',
  from: 'c_001',
  to: 'c_002',
  label: '',
  color: 'gray',
  meta: {},
}

describe('连线命令（T3.1 / T3.2）', () => {
  it('createConnection：do 追加、undo 移除', () => {
    const list: Connection[] = []
    const add = (connection: Connection) => list.push(connection)
    const remove = (ids: string[]) => {
      for (const id of ids) list.splice(list.findIndex((c) => c.id === id), 1)
    }

    const command = createConnectionCommand(CONNECTION, add, remove)
    void command.do()
    expect(list).toHaveLength(1)
    void command.undo()
    expect(list).toHaveLength(0)
  })

  it('removeConnections：undo 把连线原样放回（含标签）', () => {
    const labeled: Connection = { ...CONNECTION, label: '因果' }
    const list: Connection[] = [labeled]
    const command = createRemoveConnectionsCommand(
      [labeled],
      (connection) => list.push(connection),
      (ids) => {
        for (const id of ids) list.splice(list.findIndex((c) => c.id === id), 1)
      },
    )

    void command.do()
    expect(list).toHaveLength(0)
    void command.undo()
    expect(list).toHaveLength(1)
    expect(list[0].label).toBe('因果')
  })

  it('setConnectionLabel：do/undo 对称', () => {
    let current = ''
    const apply = (_id: string, label: string) => {
      current = label
    }
    const command = createSetConnectionLabelCommand('conn_001', '', '因果', apply)

    void command.do()
    expect(current).toBe('因果')
    void command.undo()
    expect(current).toBe('')
  })
})

describe('备注与标签命令（T3.3 / T3.9）', () => {
  it('setCardNote：do 写新值、undo 还原旧值', () => {
    let note = '旧'
    const command = createSetCardNoteCommand('c_001', '旧', '新', (_id, value) => {
      note = value
    })

    void command.do()
    expect(note).toBe('新')
    void command.undo()
    expect(note).toBe('旧')
  })

  it('setCardMeta：do/undo 整体替换 meta', () => {
    let meta: Record<string, unknown> = {}
    const command = createSetCardMetaCommand(
      'c_001',
      {},
      metaWithTags({}, ['标签']),
      (_id, value) => {
        meta = value
      },
    )

    void command.do()
    expect(tagsOfMeta(meta)).toEqual(['标签'])
    void command.undo()
    expect(meta).toEqual({})
  })
})

describe('分区颜色与置顶置底（T3.9）', () => {
  it('setPartitionColor：do/undo 对称', () => {
    let color = 'auto'
    const command = createSetPartitionColorCommand('p_001', 'auto', '#5A7D6A', (_id, value) => {
      color = value
    })

    void command.do()
    expect(color).toBe('#5A7D6A')
    void command.undo()
    expect(color).toBe('auto')
  })

  it('zIndexDeltasFor：置顶 = 最大值 + 1，已置顶不产生变化', () => {
    const cards = [
      { id: 'c_001', zIndex: 0 },
      { id: 'c_002', zIndex: 5 },
    ]
    expect(zIndexDeltasFor(cards, ['c_001'], 'front')).toEqual([
      { id: 'c_001', from: 0, to: 6 },
    ])
    expect(zIndexDeltasFor(cards, ['c_002'], 'front')).toEqual([])
  })

  it('zIndexDeltasFor：置底 = 最小值 - 1', () => {
    const cards = [
      { id: 'c_001', zIndex: 2 },
      { id: 'c_002', zIndex: 5 },
    ]
    expect(zIndexDeltasFor(cards, ['c_002'], 'back')).toEqual([
      { id: 'c_002', from: 5, to: 1 },
    ])
  })

  it('setCardsZIndex 命令：do/undo 对称', () => {
    const updates: { id: string; zIndex: number }[] = []
    const apply = (value: { id: string; zIndex: number }[]) => {
      updates.length = 0
      updates.push(...value)
    }
    const command = createSetCardsZIndexCommand([{ id: 'c_001', from: 0, to: 6 }], apply)

    void command.do()
    expect(updates).toEqual([{ id: 'c_001', zIndex: 6 }])
    void command.undo()
    expect(updates).toEqual([{ id: 'c_001', zIndex: 0 }])
  })

  // 回归守卫：新建空间所有卡片 zIndex 全为 0，旧实现的「card.zIndex === bound 即跳过」
  // 会让置顶 / 置底对任何卡片永远空转（用户实测缺陷，2026-09-11）
  it('zIndexDeltasFor：全部卡片 zIndex 相等时，置顶 / 置底仍能生效', () => {
    const cards = [
      { id: 'c_001', zIndex: 0 },
      { id: 'c_002', zIndex: 0 },
      { id: 'c_003', zIndex: 0 },
    ]
    expect(zIndexDeltasFor(cards, ['c_001'], 'front')).toEqual([
      { id: 'c_001', from: 0, to: 1 },
    ])
    expect(zIndexDeltasFor(cards, ['c_003'], 'back')).toEqual([
      { id: 'c_003', from: 0, to: -1 },
    ])
  })

  it('zIndexDeltasFor：目标与其它卡片并列最大 / 最小时，也要移出并列', () => {
    const cards = [
      { id: 'c_001', zIndex: 5 },
      { id: 'c_002', zIndex: 5 },
      { id: 'c_003', zIndex: 1 },
    ]
    // c_001 与 c_002 并列最大：置顶 c_001 应把它单独抬到并列之上
    expect(zIndexDeltasFor(cards, ['c_001'], 'front')).toEqual([
      { id: 'c_001', from: 5, to: 6 },
    ])
    // c_003 与其它并列最小 / 严格最小时才跳过：此处 c_003 已严格最小 → 置底空转
    expect(zIndexDeltasFor(cards, ['c_003'], 'back')).toEqual([])
  })

  it('zIndexDeltasFor：画布只剩目标自己时不产生变化', () => {
    expect(zIndexDeltasFor([{ id: 'c_001', zIndex: 0 }], ['c_001'], 'front')).toEqual([])
    expect(zIndexDeltasFor([{ id: 'c_001', zIndex: 0 }], ['c_001'], 'back')).toEqual([])
  })
})
