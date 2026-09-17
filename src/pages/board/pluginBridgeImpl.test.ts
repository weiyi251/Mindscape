// ============================================================================
// 模块说明（中文）
// pages/board/pluginBridgeImpl.ts 的单元测试。
//
// 覆盖点：插件画布桥三个入口的合同 ——
//   · usedCardIds      画布卡 + 已移除记录同一 id 空间（防「恢复错卡」回归）；
//   · createCardFromFile（自 Board 外抽的迁移回归）插件字段覆盖推导值、
//     undoable=false 直写不入栈；
//   · createCard       无文件建卡：返回新卡 id、落点 / 尺寸 / meta 生效、
//     未打开空间 / 只读返回 null、撤销一次卡片消失；
//   · updateCardContent meta 整体替换 + 高度更新，撤销一次完整还原（原子）。
//
// 全部用真实 History + 真实 boardStore 单例（setState 置状态），不碰 Tauri。
// ============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LayoutWriter } from '@/core/board/layoutWriter'
import { History } from '@/core/commands/history'
import { useBoardStore } from '@/core/store/boardStore'
import { useSpacesStore } from '@/core/store/spacesStore'
import { zCardSchema } from '@/core/types'
import type { Card, Space } from '@/core/types'

import { createPluginBoardBridge, usedCardIds } from './pluginBridgeImpl'
import type { PluginBridgeDeps } from './pluginBridgeImpl'

const SPACE: Space = {
  id: 'sp_001',
  name: '项目A',
  type: '项目',
  folderPath: 'D:\\Mindscape\\01_项目A',
  createdAt: '2026-09-10T11:00:00',
  lastOpenedAt: '2026-09-10T11:00:00',
  favorite: false,
  meta: {},
}

/** 最小合法卡片（zod 往返，与真实落盘数据同形） */
function makeCard(id: string, overrides: Partial<Card> = {}): Card {
  return zCardSchema.parse({
    id,
    type: 'note',
    filePath: '',
    originalPath: '',
    x: 0,
    y: 0,
    w: 200,
    h: 160,
    ...overrides,
  })
}

/** 桥依赖假件：坐标恒 (50, 60)，buildIngestedCard 产出固定尺寸的图片卡 */
function makeDeps(overrides: Partial<PluginBridgeDeps> = {}): PluginBridgeDeps {
  return {
    viewportCenterCanvasPoint: () => ({ x: 50, y: 60 }),
    buildIngestedCard: async (params) =>
      zCardSchema.parse({
        id: params.id,
        type: 'image',
        filePath: '推导.png',
        originalPath: '推导.png',
        x: Math.round(params.point.x),
        y: Math.round(params.point.y),
        w: 100,
        h: 80,
      }),
    commitIngestedCards: vi.fn(async () => {}),
    history: new History(),
    writer: { schedule: vi.fn() } as unknown as LayoutWriter,
    ...overrides,
  }
}

beforeEach(() => {
  useBoardStore.setState({ cards: [], partitions: [], removed: [], readOnly: false, connections: [] })
  useSpacesStore.setState({ spaces: [], currentSpaceId: null })
})

// ---------------------------------------------------------------------------
// usedCardIds（自 Board.tsx 迁入，防「恢复错卡」回归）
// ---------------------------------------------------------------------------

describe('usedCardIds：画布卡 + 已移除记录同一 id 空间', () => {
  it('返回画布卡片 id 与 removed 记录 id 的拼接', () => {
    useBoardStore.setState({
      cards: [makeCard('c_2'), makeCard('c_1')],
      removed: [{ id: 'c_0', originalPath: '旧.png', movedTo: 'D:\\已移除' }],
    })
    expect(usedCardIds()).toEqual(['c_2', 'c_1', 'c_0'])
  })
})

// ---------------------------------------------------------------------------
// createCard：无文件建卡（待办卡等插件自绘类型）
// ---------------------------------------------------------------------------

describe('createPluginBoardBridge · createCard', () => {
  it('默认落点用视口中心；返回新卡 id，卡片入 store 且类型 / 无文件语义正确', async () => {
    useSpacesStore.setState({ spaces: [SPACE], currentSpaceId: SPACE.id })
    const deps = makeDeps()
    const bridge = createPluginBoardBridge(deps)

    const id = await bridge.createCard({ type: 'todo' })

    expect(id).toBeTruthy()
    const card = useBoardStore.getState().cards.find((item) => item.id === id)
    expect(card?.type).toBe('todo')
    expect(card?.x).toBe(50)
    expect(card?.y).toBe(60)
    expect(card?.filePath).toBe('')
    expect(card?.w).toBe(200)
    expect(card?.h).toBe(160)
    expect(deps.writer.schedule).toHaveBeenCalled()
  })

  it('插件给定落点（四舍五入）、尺寸与 meta 生效', async () => {
    useSpacesStore.setState({ spaces: [SPACE], currentSpaceId: SPACE.id })
    const bridge = createPluginBoardBridge(makeDeps())

    const id = await bridge.createCard({
      type: 'todo',
      x: 10.6,
      y: 20.2,
      w: 220,
      h: 140,
      meta: { items: [{ id: 't1', text: '甲', done: false }] },
    })

    const card = useBoardStore.getState().cards.find((item) => item.id === id)
    expect(card?.x).toBe(11)
    expect(card?.y).toBe(20)
    expect(card?.w).toBe(220)
    expect(card?.h).toBe(140)
    expect(card?.meta).toEqual({ items: [{ id: 't1', text: '甲', done: false }] })
  })

  it('未打开空间 / 只读模式返回 null，不建卡', async () => {
    const bridge = createPluginBoardBridge(makeDeps())
    await expect(bridge.createCard({ type: 'todo' })).resolves.toBeNull()
    expect(useBoardStore.getState().cards).toHaveLength(0)

    useSpacesStore.setState({ spaces: [SPACE], currentSpaceId: SPACE.id })
    useBoardStore.setState({ readOnly: true })
    await expect(bridge.createCard({ type: 'todo' })).resolves.toBeNull()
    expect(useBoardStore.getState().cards).toHaveLength(0)
  })

  it('撤销一次卡片消失（addCards 命令：undo 只删卡，无文件可删）', async () => {
    useSpacesStore.setState({ spaces: [SPACE], currentSpaceId: SPACE.id })
    const deps = makeDeps()
    const bridge = createPluginBoardBridge(deps)

    const id = await bridge.createCard({ type: 'todo' })
    expect(useBoardStore.getState().cards).toHaveLength(1)

    await deps.history.undo()
    expect(useBoardStore.getState().cards.find((item) => item.id === id)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// updateCardContent：meta 整体替换 + 高度自适应（原子可撤销）
// ---------------------------------------------------------------------------

describe('createPluginBoardBridge · updateCardContent', () => {
  it('meta 整体替换 + 高度更新，宽度保持不变', async () => {
    useSpacesStore.setState({ spaces: [SPACE], currentSpaceId: SPACE.id })
    useBoardStore.setState({ cards: [makeCard('c_1', { w: 220, h: 120 })] })
    const bridge = createPluginBoardBridge(makeDeps())

    await expect(
      bridge.updateCardContent({ cardId: 'c_1', meta: { items: ['甲'] }, h: 160 }),
    ).resolves.toBe(true)

    const card = useBoardStore.getState().cards.find((item) => item.id === 'c_1')
    expect(card?.meta).toEqual({ items: ['甲'] })
    expect(card?.h).toBe(160)
    expect(card?.w).toBe(220)
  })

  it('撤销一次 meta 与高度一起还原（原子，不撕裂）', async () => {
    useSpacesStore.setState({ spaces: [SPACE], currentSpaceId: SPACE.id })
    useBoardStore.setState({ cards: [makeCard('c_1', { w: 220, h: 120 })] })
    const deps = makeDeps()
    const bridge = createPluginBoardBridge(deps)

    await bridge.updateCardContent({ cardId: 'c_1', meta: { items: ['甲', '乙'] }, h: 180 })
    await deps.history.undo()

    const card = useBoardStore.getState().cards.find((item) => item.id === 'c_1')
    expect(card?.meta).toEqual({})
    expect(card?.h).toBe(120)
  })

  it('卡片不存在 / 只读模式返回 false', async () => {
    useSpacesStore.setState({ spaces: [SPACE], currentSpaceId: SPACE.id })
    const bridge = createPluginBoardBridge(makeDeps())

    await expect(bridge.updateCardContent({ cardId: '不存在', meta: {} })).resolves.toBe(false)

    useBoardStore.setState({ readOnly: true, cards: [makeCard('c_1')] })
    await expect(bridge.updateCardContent({ cardId: 'c_1', meta: {} })).resolves.toBe(false)
  })
})

// ---------------------------------------------------------------------------
// createCardFromFile：自 Board.tsx 外抽的迁移回归（字段覆盖 / undoable 分支）
// ---------------------------------------------------------------------------

describe('createPluginBoardBridge · createCardFromFile（迁移回归）', () => {
  it('插件给的字段优先于推导值：类型 / 路径 / 尺寸 / meta', async () => {
    useSpacesStore.setState({ spaces: [SPACE], currentSpaceId: SPACE.id })
    const deps = makeDeps()
    const bridge = createPluginBoardBridge(deps)

    await expect(
      bridge.createCardFromFile({
        relativePath: '色卡.png',
        absolutePath: `${SPACE.folderPath}\\色卡.png`,
        type: 'colorCard',
        w: 120,
        h: 120,
        meta: { hoverLabel: '#ABCDEF' },
      }),
    ).resolves.toBe(true)

    // 默认可撤销：卡片经拖入同款提交链交出去（卡片内容从调用参数断言 ——
    // 假 commitIngestedCards 不真写 store，真写入由 Board 集成路径负责）
    expect(deps.commitIngestedCards).toHaveBeenCalledTimes(1)
    const [cardsArg] = vi.mocked(deps.commitIngestedCards).mock.calls[0]
    const card = cardsArg[0]
    expect(card?.type).toBe('colorCard')
    expect(card?.filePath).toBe('色卡.png')
    expect(card?.w).toBe(120)
    expect(card?.meta).toEqual({ hoverLabel: '#ABCDEF' })
  })

  it('undoable=false：直写入 store、不入撤销链、调度落盘', async () => {
    useSpacesStore.setState({ spaces: [SPACE], currentSpaceId: SPACE.id })
    const deps = makeDeps()
    const bridge = createPluginBoardBridge(deps)

    await expect(
      bridge.createCardFromFile({
        relativePath: '现画.png',
        absolutePath: `${SPACE.folderPath}\\现画.png`,
        type: 'colorCard',
        undoable: false,
      }),
    ).resolves.toBe(true)

    expect(useBoardStore.getState().cards).toHaveLength(1)
    expect(deps.commitIngestedCards).not.toHaveBeenCalled()
    expect(deps.writer.schedule).toHaveBeenCalled()
  })

  it('未打开空间返回 false', async () => {
    const bridge = createPluginBoardBridge(makeDeps())
    await expect(
      bridge.createCardFromFile({
        relativePath: 'a.png',
        absolutePath: 'D:\\a.png',
        type: 'image',
      }),
    ).resolves.toBe(false)
  })
})
