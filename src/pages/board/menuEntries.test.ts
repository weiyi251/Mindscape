// ============================================================================
// 模块说明（中文）
// menuEntries（右键菜单弹出入口）的**接线测试**（2026-09-20 自 Board 外抽时补）。
//
// 覆盖：三个入口都正确组装菜单并写入浮层 state；批量移动的选中集合透传；
// 分区菜单「粘贴」按剪贴板状态裁剪；连线已被删除时静默早退。
// ============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  openCardContextMenu,
  openConnectionContextMenu,
  openPartitionContextMenu,
} from './menuEntries'
import type { MenuEntryDeps } from './menuEntries'
import { CARD_ACTION, PARTITION_ACTION } from '@/core/registry/menus'
import { useBoardStore } from '@/core/store/boardStore'
import { useSpacesStore } from '@/core/store/spacesStore'
import type { Card, Connection, Partition, Space } from '@/core/types'
import type { ContextMenuState } from '@/components/ui/context-menu'

const SPACE = {
  id: 'sp_1',
  name: '空间',
  type: 'local',
  folderPath: 'D:\\空间',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastOpenedAt: '2026-01-01T00:00:00.000Z',
  favorite: false,
  meta: {},
} as Space

function card(patch: Partial<Card> = {}): Card {
  return {
    id: 'c1',
    type: 'image',
    filePath: 'a.png',
    originalPath: 'a.png',
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

function partition(patch: Partial<Partition> = {}): Partition {
  return {
    id: 'p1',
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

function makeDeps(over: Partial<MenuEntryDeps> = {}) {
  const menus: ContextMenuState[] = []
  const deps: MenuEntryDeps = {
    setContextMenu: (menu) => menus.push(menu),
    removedView: false,
    selectedIds: [],
    cards: [],
    onMove: vi.fn(),
    onRestore: vi.fn(),
    onSetColor: vi.fn(),
    onDeleteForever: vi.fn(),
    onRenameFile: vi.fn(),
    hasCopiedCards: false,
    onSetPartitionColor: vi.fn(),
    ...over,
  }
  return { deps, menus }
}

beforeEach(() => {
  useSpacesStore.setState({ spaces: [SPACE], currentSpaceId: SPACE.id })
  useBoardStore.setState({ connections: [] })
})

describe('openCardContextMenu', () => {
  it('组装卡片菜单并写入浮层坐标', () => {
    const target = card()
    const { deps, menus } = makeDeps({ cards: [target] })

    openCardContextMenu(target, { x: 12, y: 34 }, deps)

    expect(menus).toHaveLength(1)
    expect(menus[0]).toMatchObject({ x: 12, y: 34 })
    expect(menus[0].items.map((item) => item.id)).toContain(CARD_ACTION.remove)
  })

  it('多选时把选中集合内的卡片整批交给 onMove（批量移动的上下文来源）', () => {
    const first = card({ id: 'c1' })
    const second = card({ id: 'c2', filePath: 'b.png', originalPath: 'b.png' })
    const onMove = vi.fn()
    const { deps, menus } = makeDeps({
      cards: [first, second],
      selectedIds: ['c1', 'c2'],
      onMove,
    })

    openCardContextMenu(first, { x: 0, y: 0 }, deps)
    menus[0].items.find((item) => item.id === CARD_ACTION.move)?.run()

    expect(onMove).toHaveBeenCalledWith([first, second], { x: 0, y: 0 })
  })

  it('未打开空间时空间路径为空串（各 flow 会静默早退）', () => {
    useSpacesStore.setState({ spaces: [], currentSpaceId: null })
    const target = card()
    const { deps, menus } = makeDeps({ cards: [target] })

    openCardContextMenu(target, { x: 0, y: 0 }, deps)

    expect(menus).toHaveLength(1)
  })
})

describe('openPartitionContextMenu', () => {
  it('剪贴板为空时不显示「粘贴」；有内容时显示', () => {
    const target = partition()

    const empty = makeDeps({ hasCopiedCards: false })
    openPartitionContextMenu(target, { x: 1, y: 2 }, empty.deps)
    expect(empty.menus[0].items.map((item) => item.id)).not.toContain(PARTITION_ACTION.paste)

    const filled = makeDeps({ hasCopiedCards: true })
    openPartitionContextMenu(target, { x: 1, y: 2 }, filled.deps)
    expect(filled.menus[0].items.map((item) => item.id)).toContain(PARTITION_ACTION.paste)
  })

  it('「指定颜色」以 partitionId 调 onSetPartitionColor', () => {
    const onSetPartitionColor = vi.fn()
    const { deps, menus } = makeDeps({ onSetPartitionColor })

    openPartitionContextMenu(partition(), { x: 5, y: 6 }, deps)
    menus[0].items.find((item) => item.id === PARTITION_ACTION.setColor)?.run()

    expect(onSetPartitionColor).toHaveBeenCalledWith('p1', { x: 5, y: 6 })
  })
})

describe('openConnectionContextMenu', () => {
  it('连线存在时组装菜单', () => {
    const connection = { id: 'k1', from: 'c1', to: 'c2', label: '', color: '#888', meta: {} } as Connection
    useBoardStore.setState({ connections: [connection] })
    const { deps, menus } = makeDeps()

    openConnectionContextMenu('k1', { x: 7, y: 8 }, deps)

    expect(menus).toHaveLength(1)
    expect(menus[0]).toMatchObject({ x: 7, y: 8 })
  })

  it('连线已被删除（数据层找不到）→ 不动浮层', () => {
    const { deps, menus } = makeDeps()

    openConnectionContextMenu('not-there', { x: 0, y: 0 }, deps)

    expect(menus).toEqual([])
  })
})
