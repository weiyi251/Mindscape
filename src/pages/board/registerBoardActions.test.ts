// ============================================================================
// 模块说明（中文）
// registerBoardActions 的**接线测试**（2026-09-20 自 Board.tsx 外抽时补）。
//
// 覆盖的是「配置中心的动作 id → Board 实现」这张映射表本身：外抽最容易出的错就是
// 某个 id 漏接 / 接错 handler（菜单点了没反应，且不会有任何报错）。测试用假 handler
// 记录调用，再用 actionRegistry.runAction 按 id 驱动 —— 走的正是真实菜单点击的路径。
// ============================================================================

import { beforeEach, describe, expect, it } from 'vitest'

import { registerBoardActions } from './registerBoardActions'
import type { BoardActionDeps } from './registerBoardActions'
import { runAction } from '@/core/registry/actionRegistry'
import { CARD_ACTION, CONNECTION_ACTION, PARTITION_ACTION } from '@/core/registry/menus'
import { useSpacesStore } from '@/core/store/spacesStore'
import type { Card, Connection, Partition, Space } from '@/core/types'

function makeCard(patch: Partial<Card> = {}): Card {
  return {
    id: 'c_1',
    type: 'image',
    filePath: '图.png',
    originalPath: '图.png',
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    rotation: 0,
    zIndex: 0,
    note: '',
    meta: {},
    ...patch,
  }
}

function makePartition(patch: Partial<Partition> = {}): Partition {
  return {
    id: 'p_1',
    name: '分区A',
    folderPath: '分区A',
    x: 0,
    y: 0,
    w: 400,
    h: 300,
    color: '#888888',
    collapsed: false,
    meta: {},
    ...patch,
  }
}

function makeConnection(patch: Partial<Connection> = {}): Connection {
  return { id: 'k_1', from: 'c_1', to: 'c_2', label: '', color: '#888888', meta: {}, ...patch }
}

const SPACE: Space = {
  id: 'sp_1',
  name: '空间',
  type: 'local',
  folderPath: 'D:\\空间',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastOpenedAt: '2026-01-01T00:00:00.000Z',
  favorite: false,
  meta: {},
}

/** 菜单上下文：spacePath 为必填（MenuContext 契约），其余按用例给 */
function ctx(patch: { card?: Card; partition?: Partition; connection?: Connection }) {
  return { spacePath: SPACE.folderPath, ...patch }
}

function makeDeps() {
  const calls: string[] = []
  const deps: BoardActionDeps = {
    handleRemoveCards: (ids) => calls.push(`remove:${ids.join(',')}`),
    handleCardZIndex: (id, to) => calls.push(`zIndex:${id}:${to}`),
    handleCardNote: (card) => calls.push(`note:${card.id}`),
    handleCardTags: (card) => calls.push(`tags:${card.id}`),
    openCardWithSystem: async (card) => {
      calls.push(`open:${card.id}`)
    },
    handleTogglePartitionCollapsed: (id) => calls.push(`collapse:${id}`),
    handleEditConnectionLabel: (id) => calls.push(`connLabel:${id}`),
    handleRemoveConnections: (ids) => calls.push(`connRemove:${ids.join(',')}`),
    handleCopyCards: async (cards) => {
      calls.push(`copy:${cards.map((card) => card.id).join(',')}`)
    },
    pasteCards: async (point, dest) => {
      calls.push(`paste:${Math.round(point.x)},${Math.round(point.y)}:${dest?.partitionId ?? '-'}`)
    },
    setPendingConnectFrom: (cardId) => calls.push(`connect:${cardId}`),
    canvasApiRef: {
      current: {
        beginNoteEdit: (id: string) => calls.push(`noteEdit:${id}`),
        beginPartitionRename: (id: string) => calls.push(`partitionRename:${id}`),
      } as never,
    },
  }
  return { deps, calls }
}

beforeEach(() => {
  useSpacesStore.setState({ spaces: [SPACE], currentSpaceId: SPACE.id })
})

describe('registerBoardActions · 卡片菜单映射', () => {
  it('打开原图 / 移除 / 置顶 / 置底 / 备注 / 标签 / 连线', () => {
    const { deps, calls } = makeDeps()
    registerBoardActions(deps)
    const card = makeCard()

    runAction(CARD_ACTION.openOriginal, '打开原图', ctx({ card }))
    runAction(CARD_ACTION.remove, '移除', ctx({ card }))
    runAction(CARD_ACTION.bringToFront, '置顶', ctx({ card }))
    runAction(CARD_ACTION.sendToBack, '置底', ctx({ card }))
    runAction(CARD_ACTION.addNote, '加备注', ctx({ card }))
    runAction(CARD_ACTION.editLabel, '编辑标签', ctx({ card }))
    runAction(CARD_ACTION.connect, '连线', ctx({ card }))

    expect(calls).toEqual([
      'open:c_1',
      'remove:c_1',
      'zIndex:c_1:front',
      'zIndex:c_1:back',
      'note:c_1',
      'tags:c_1',
      'connect:c_1',
    ])
  })

  it('「加备注」在便签上走行内编辑（不弹窗）', () => {
    const { deps, calls } = makeDeps()
    registerBoardActions(deps)

    runAction(CARD_ACTION.addNote, '加备注', ctx({ card: makeCard({ type: 'note' }) }))

    expect(calls).toEqual(['noteEdit:c_1'])
  })

  it('复制：走 handleCopyCards', () => {
    const { deps, calls } = makeDeps()
    registerBoardActions(deps)

    runAction(CARD_ACTION.copy, '复制', ctx({ card: makeCard() }))

    expect(calls).toEqual(['copy:c_1'])
  })

  it('缺少卡片上下文时不调用任何 handler（空白处误触不发散）', () => {
    const { deps, calls } = makeDeps()
    registerBoardActions(deps)

    for (const id of [CARD_ACTION.remove, CARD_ACTION.bringToFront, CARD_ACTION.copy]) {
      runAction(id, 'x', ctx({}))
    }

    expect(calls).toEqual([])
  })
})

describe('registerBoardActions · 分区 / 连线菜单映射', () => {
  it('分区粘贴：落点 = 分区中心（展开态含标题条高度）', () => {
    const { deps, calls } = makeDeps()
    registerBoardActions(deps)

    runAction(PARTITION_ACTION.paste, '粘贴', ctx({ partition: makePartition({ x: 100, y: 50, w: 400, h: 300 }) }))

    // 中心 y = 50 + 32 + (300-32)/2 = 216；destDir = D:\空间\分区A
    expect(calls).toEqual(['paste:300,216:p_1'])
  })

  it('分区粘贴：折叠态只算标题条高度', () => {
    const { deps, calls } = makeDeps()
    registerBoardActions(deps)

    runAction(PARTITION_ACTION.paste, '粘贴', ctx({
      partition: makePartition({ x: 0, y: 0, w: 400, h: 300, collapsed: true }),
    }))

    expect(calls).toEqual(['paste:200,16:p_1'])
  })

  it('分区改名走行内编辑态 / 折叠 / 连线标签 / 断开连线', () => {
    const { deps, calls } = makeDeps()
    registerBoardActions(deps)

    runAction(PARTITION_ACTION.rename, '重命名分区', ctx({ partition: makePartition() }))
    runAction(PARTITION_ACTION.toggleCollapse, '折叠', ctx({ partition: makePartition() }))
    runAction(CONNECTION_ACTION.editLabel, '编辑标签', ctx({ connection: makeConnection() }))
    runAction(CONNECTION_ACTION.remove, '删除连线', ctx({ connection: makeConnection() }))

    expect(calls).toEqual(['partitionRename:p_1', 'collapse:p_1', 'connLabel:k_1', 'connRemove:k_1'])
  })

  it('未打开空间时分区粘贴安全早退', () => {
    useSpacesStore.setState({ spaces: [], currentSpaceId: null })
    const { deps, calls } = makeDeps()
    registerBoardActions(deps)

    runAction(PARTITION_ACTION.paste, '粘贴', ctx({ partition: makePartition() }))

    expect(calls).toEqual([])
  })
})
