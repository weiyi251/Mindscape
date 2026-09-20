// ============================================================================
// 模块说明（中文）
// contextMenus.tsx 的单测。菜单组装是**纯函数**（副作用全部回调注入），
// 因此不需要 DOM / jsdom，直接调用并断言返回的项数组即可。
// 覆盖点：配置中心项的正确透传、二级菜单的回调改写、按上下文过滤/插入的项。
// ============================================================================

import { describe, expect, it, vi } from 'vitest'

import { PARTITION_PALETTE } from '@/core/board/partitions'
import { NOTE_PALETTE } from '@/core/board/noteColors'
import { UNCLASSIFIED_DIR } from '@/core/board/ingest'
import { CARD_ACTION, CONNECTION_ACTION, PARTITION_ACTION } from '@/core/registry/menus'
import { registerCanvasMenuItem, resetPluginCenter } from '@/core/registry/pluginCenter'
import type { Card, Connection, Partition } from '@/core/types'

import {
  buildCardMenuItems,
  buildCardMoveItems,
  buildCanvasMenuItems,
  buildConnectionMenuItems,
  buildNoteColorItems,
  buildPartitionColorItems,
  buildPartitionMenuItems,
  withShortcutLabel,
} from './contextMenus'

// --- 最小假数据：构建函数只读 id / type / filePath / folderPath / name 等字段 ---

const fileCard = (over: Partial<Card> = {}): Card =>
  ({
    id: 'c1',
    type: 'file',
    filePath: 'a.txt',
    originalPath: 'a.txt',
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    note: '',
    group: '',
    zIndex: 0,
    meta: {},
    ...over,
  }) as Card

const partition = (over: Partial<Partition> = {}): Partition =>
  ({
    id: 'p1',
    name: '分区A',
    folderPath: '分区A',
    x: 0,
    y: 0,
    w: 200,
    h: 200,
    color: 'auto',
    collapsed: false,
    meta: {},
    ...over,
  }) as Partition

const connection = (over: Partial<Connection> = {}): Connection =>
  ({ id: 'x1', from: 'c1', to: 'c2', label: '', color: 'gray', meta: {}, ...over }) as Connection

describe('withShortcutLabel', () => {
  it('把配置中心的默认键位拼进操作名', () => {
    const label = withShortcutLabel('撤销', 'edit.undo')
    expect(label.startsWith('撤销（')).toBe(true)
    expect(label.endsWith('）')).toBe(true)
    // 默认绑定必定非空，括号里应该有内容
    expect(label.length).toBeGreaterThan('撤销（）'.length)
  })
})

describe('buildCardMenuItems', () => {
  const base = {
    screen: { x: 10, y: 20 },
    spacePath: 'E:/space',
    removedView: false,
    selectedIds: [] as string[],
    selectedCards: [] as Card[],
    onMove: vi.fn(),
    onRestore: vi.fn(),
    onSetColor: vi.fn(),
    onRenameFile: vi.fn(),
    onDeleteForever: vi.fn(),
  }

  it('普通卡片：菜单项来自配置中心，「移除」标红', () => {
    const items = buildCardMenuItems({
      ...base,
      card: fileCard(),
    })
    const ids = items.map((item) => item.id)
    expect(ids).toContain(CARD_ACTION.remove)
    expect(ids).toContain(CARD_ACTION.move)
    expect(ids).toContain(CARD_ACTION.renameFile)
    expect(ids).not.toContain(CARD_ACTION.setColor)
    expect(items.find((item) => item.id === CARD_ACTION.remove)?.danger).toBe(true)
    // 非移除视图不插入「恢复」项
    expect(ids).not.toContain('card.restore')
  })

  it('「移动到…」改写为二级菜单回调，并带上卡片与屏幕坐标', () => {
    const onMove = vi.fn()
    const card = fileCard()
    const items = buildCardMenuItems({
      ...base,
      card,
      onMove,
    })
    items.find((item) => item.id === CARD_ACTION.move)?.run()
    // 2026-09-20 起支持批量：目标以**数组**交给流程层（单卡即长度 1 的数组）
    expect(onMove).toHaveBeenCalledWith([card], { x: 10, y: 20 })
  })

  it('多选批量移动（2026-09-20）：右键的卡在选中集合里时整批移动，标签带张数', () => {
    const onMove = vi.fn()
    const card = fileCard({ id: 'c1' })
    const other = fileCard({ id: 'c2', filePath: 'b.txt', originalPath: 'b.txt' })
    const items = buildCardMenuItems({
      ...base,
      card,
      selectedIds: ['c1', 'c2'],
      selectedCards: [card, other],
      onMove,
    })

    expect(items.find((item) => item.id === CARD_ACTION.move)?.label).toBe('移动 2 张到…')
    items.find((item) => item.id === CARD_ACTION.move)?.run()
    expect(onMove).toHaveBeenCalledWith([card, other], { x: 10, y: 20 })
  })

  it('选中集合只有右键那张卡（单选）时不显示批量标签', () => {
    const card = fileCard({ id: 'c1' })
    const items = buildCardMenuItems({
      ...base,
      card,
      selectedIds: ['c1'],
      selectedCards: [card],
    })
    expect(items.find((item) => item.id === CARD_ACTION.move)?.label).toBe('移动到…')
  })

  it('「重命名文件」改写为浮层回调，只带卡片', () => {
    const onRenameFile = vi.fn()
    const card = fileCard()
    const items = buildCardMenuItems({
      ...base,
      card,
      onRenameFile,
    })
    items.find((item) => item.id === CARD_ACTION.renameFile)?.run()
    expect(onRenameFile).toHaveBeenCalledWith(card)
  })

  it('便签没有文件：不出现「移动到…」与「重命名文件」；出现「便签颜色…」且改写为二级菜单回调', () => {
    const onSetColor = vi.fn()
    const card = fileCard({ type: 'note', filePath: '' })
    const items = buildCardMenuItems({
      ...base,
      card,
      onSetColor,
    })
    const ids = items.map((item) => item.id)
    expect(ids).not.toContain(CARD_ACTION.move)
    expect(ids).not.toContain(CARD_ACTION.renameFile)
    expect(ids).toContain(CARD_ACTION.setColor)
    items.find((item) => item.id === CARD_ACTION.setColor)?.run()
    expect(onSetColor).toHaveBeenCalledWith(card, { x: 10, y: 20 })
  })

  it('已移除视图：首项为「恢复此卡片」并带分隔线', () => {
    const onRestore = vi.fn()
    const items = buildCardMenuItems({
      ...base,
      removedView: true,
      card: fileCard(),
      onRestore,
    })
    expect(items[0].id).toBe('card.restore')
    expect(items[0].label).toBe('恢复此卡片')
    expect(items[0].separatorBefore).toBe(true)
    items[0].run()
    expect(onRestore).toHaveBeenCalledWith(['c1'])
  })

  it('已移除视图 + 卡片在选中集合里：整批恢复', () => {
    const onRestore = vi.fn()
    const items = buildCardMenuItems({
      ...base,
      removedView: true,
      selectedIds: ['c1', 'c2', 'c3'],
      card: fileCard(),
      onRestore,
    })
    expect(items[0].label).toBe('恢复选中的 3 张卡片')
    items[0].run()
    expect(onRestore).toHaveBeenCalledWith(['c1', 'c2', 'c3'])
  })

  it('已移除视图：「彻底删除」紧跟「恢复」之后且标红，整批/单卡文案正确', () => {
    const onDeleteForever = vi.fn()
    const single = buildCardMenuItems({
      ...base,
      removedView: true,
      card: fileCard(),
      onDeleteForever,
    })
    expect(single[1].id).toBe('card.deleteForever')
    expect(single[1].label).toBe('彻底删除此文件')
    expect(single[1].danger).toBe(true)
    single[1].run()
    expect(onDeleteForever).toHaveBeenCalledWith(['c1'])

    const batch = buildCardMenuItems({
      ...base,
      removedView: true,
      selectedIds: ['c1', 'c2', 'c3'],
      card: fileCard(),
      onDeleteForever,
    })
    expect(batch[1].label).toBe('彻底删除选中的 3 个文件')
    batch[1].run()
    expect(onDeleteForever).toHaveBeenCalledWith(['c1', 'c2', 'c3'])
  })

  it('非移除视图：不显示「彻底删除」', () => {
    const items = buildCardMenuItems({ ...base, card: fileCard() })
    expect(items.map((item) => item.id)).not.toContain('card.deleteForever')
  })
})

describe('buildPartitionMenuItems', () => {
  const base = { screen: { x: 1, y: 2 }, spacePath: 'E:/space' }

  it('应用内剪贴板为空：不显示「粘贴」', () => {
    const ids = buildPartitionMenuItems({
      ...base,
      partition: partition(),
      hasCopiedCards: false,
      onSetColor: vi.fn(),
    }).map((item) => item.id)
    expect(ids).not.toContain(PARTITION_ACTION.paste)
    expect(ids).toContain(PARTITION_ACTION.rename)
  })

  it('剪贴板非空：显示「粘贴」', () => {
    const ids = buildPartitionMenuItems({
      ...base,
      partition: partition(),
      hasCopiedCards: true,
      onSetColor: vi.fn(),
    }).map((item) => item.id)
    expect(ids).toContain(PARTITION_ACTION.paste)
  })

  it('「指定颜色」改写为二级色板回调，带上分区 id', () => {
    const onSetColor = vi.fn()
    const items = buildPartitionMenuItems({
      ...base,
      partition: partition(),
      hasCopiedCards: false,
      onSetColor,
    })
    items.find((item) => item.id === PARTITION_ACTION.setColor)?.run()
    expect(onSetColor).toHaveBeenCalledWith('p1', { x: 1, y: 2 })
  })
})

describe('buildPartitionColorItems', () => {
  it('首项为「自动」，其后是调色板每一项', () => {
    const items = buildPartitionColorItems(vi.fn())
    expect(items).toHaveLength(PARTITION_PALETTE.length + 1)
    expect(items[0].id).toBe(`${PARTITION_ACTION.setColor}:auto`)
    // 色板项带 swatch，供渲染层画色块
    expect(items[1].swatch).toBe(PARTITION_PALETTE[0])
  })

  it('点击回调收到正确的颜色键', () => {
    const onPick = vi.fn()
    const items = buildPartitionColorItems(onPick)
    items[0].run()
    expect(onPick).toHaveBeenLastCalledWith('auto')
    items[2].run()
    expect(onPick).toHaveBeenLastCalledWith(PARTITION_PALETTE[1])
  })
})

describe('buildNoteColorItems', () => {
  it('首项为「默认便签纸」，其后是便签调色板每一项（带 swatch）', () => {
    const items = buildNoteColorItems(vi.fn())
    expect(items).toHaveLength(NOTE_PALETTE.length + 1)
    expect(items[0].id).toBe(`${CARD_ACTION.setColor}:default`)
    expect(items[1].swatch).toBe(NOTE_PALETTE[0])
    expect(items[1].id).toBe(`${CARD_ACTION.setColor}:${NOTE_PALETTE[0]}`)
  })

  it('点击「默认便签纸」回调收到 null，点击色板项收到色值', () => {
    const onPick = vi.fn()
    const items = buildNoteColorItems(onPick)
    items[0].run()
    expect(onPick).toHaveBeenLastCalledWith(null)
    items[3].run()
    expect(onPick).toHaveBeenLastCalledWith(NOTE_PALETTE[2])
  })
})

describe('buildCardMoveItems', () => {
  it('卡片已在根目录：不列「未分类」，只列其余分区', () => {
    const items = buildCardMoveItems({
      partitions: [partition({ id: 'p1', folderPath: '分区A' })],
      currentFolder: '',
      onMove: vi.fn(),
    })
    expect(items.map((item) => item.id)).toEqual([`${CARD_ACTION.move}:p1`])
  })

  it('卡片在子文件夹：首项为「未分类」（= 空间主目录）', () => {
    const onMove = vi.fn()
    const items = buildCardMoveItems({
      partitions: [partition({ id: 'p1', folderPath: '分区A' })],
      currentFolder: '分区A',
      onMove,
    })
    expect(items[0].id).toBe(`${CARD_ACTION.move}:unclassified`)
    expect(items[0].label).toBe(UNCLASSIFIED_DIR)
    items[0].run()
    expect(onMove).toHaveBeenCalledWith('', undefined, null)
  })

  it('当前所在分区不列出（no-op）', () => {
    const items = buildCardMoveItems({
      partitions: [
        partition({ id: 'p1', folderPath: '分区A' }),
        partition({ id: 'p2', name: '分区B', folderPath: '分区B' }),
      ],
      currentFolder: '分区A',
      onMove: vi.fn(),
    })
    const ids = items.map((item) => item.id)
    expect(ids).not.toContain(`${CARD_ACTION.move}:p1`)
    expect(ids).toContain(`${CARD_ACTION.move}:p2`)
  })
})

describe('buildConnectionMenuItems', () => {
  it('两项：编辑标签 / 删除连线，删除项标红', () => {
    const items = buildConnectionMenuItems({ connection: connection(), spacePath: 'E:/space' })
    expect(items.map((item) => item.id)).toEqual([
      CONNECTION_ACTION.editLabel,
      CONNECTION_ACTION.remove,
    ])
    expect(items[1].danger).toBe(true)
  })
})

describe('buildCanvasMenuItems', () => {
  const base = {
    canvasPoint: { x: 300, y: 200 },
    spacePath: 'E:\\Mindscape\\空间A',
    onCreateNote: vi.fn(),
    onCreatePartition: vi.fn(),
    onPaste: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
  }

  it('剪贴板为空：无「粘贴」；含新建便签 / 新建分区 / 撤销 / 重做', () => {
    const items = buildCanvasMenuItems({ ...base, hasCopiedCards: false })
    const ids = items.map((item) => item.id)
    expect(ids).toEqual([
      'canvas.createNote',
      'canvas.createPartition',
      'canvas.undo',
      'canvas.redo',
    ])
    expect(items.find((item) => item.id === 'canvas.undo')?.separatorBefore).toBe(true)
  })

  it('剪贴板非空：插入「粘贴」并带上画布坐标', () => {
    const onPaste = vi.fn()
    const items = buildCanvasMenuItems({ ...base, hasCopiedCards: true, onPaste })
    expect(items.map((item) => item.id)).toContain('canvas.paste')
    items.find((item) => item.id === 'canvas.paste')?.run()
    expect(onPaste).toHaveBeenCalledWith({ x: 300, y: 200 })
  })

  it('「新建便签」把落点偏移左上，避免正好压在指针下', () => {
    const onCreateNote = vi.fn()
    const items = buildCanvasMenuItems({ ...base, hasCopiedCards: false, onCreateNote })
    items[0].run()
    expect(onCreateNote).toHaveBeenCalledWith(200, 180)
  })

  // ---- 新建分区（2026-09-14 用户要求：空间内直接创建分区）----

  it('「新建分区」把右键点原样交给回调（作为新框中心）', () => {
    const onCreatePartition = vi.fn()
    const items = buildCanvasMenuItems({ ...base, hasCopiedCards: false, onCreatePartition })
    items.find((item) => item.id === 'canvas.createPartition')?.run()
    expect(onCreatePartition).toHaveBeenCalledWith({ x: 300, y: 200 })
    expect(items.find((item) => item.id === 'canvas.createPartition')?.label).toBe('新建分区')
  })

  it('撤销 / 重做的标签带当前键位', () => {
    const items = buildCanvasMenuItems({ ...base, hasCopiedCards: false })
    const undo = items.find((item) => item.id === 'canvas.undo')
    const redo = items.find((item) => item.id === 'canvas.redo')
    expect(undo?.label.startsWith('撤销（')).toBe(true)
    expect(redo?.label.startsWith('重做（')).toBe(true)
  })

  // ---- 插件注册的画布菜单项（2026-09-14 扩展点）----

  it('插件项插在「创建类」与「撤销类」之间，首项带分隔线，id 加 plugin: 前缀', () => {
    resetPluginCenter()
    registerCanvasMenuItem({
      id: 'mindscape.color-card.create',
      label: '新建色卡…',
      action: vi.fn(),
    })

    const items = buildCanvasMenuItems({ ...base, hasCopiedCards: true })
    expect(items.map((item) => item.id)).toEqual([
      'canvas.createNote',
      'canvas.createPartition',
      'canvas.paste',
      'plugin:mindscape.color-card.create',
      'canvas.undo',
      'canvas.redo',
    ])
    expect(items[3].label).toBe('新建色卡…')
    expect(items[3].separatorBefore).toBe(true)

    resetPluginCenter()
  })

  it('插件项动作带上当前空间路径（插件据此决定默认输出位置等）', () => {
    resetPluginCenter()
    const action = vi.fn()
    registerCanvasMenuItem({ id: 'demo.create', label: '演示项', action })

    const items = buildCanvasMenuItems({ ...base, hasCopiedCards: false })
    items.find((item) => item.id === 'plugin:demo.create')?.run()

    // 待办卡片插件起见，画布菜单动作同时携带 canvasPoint（右键点），
    // 插件可据此决定新建卡片的落点
    expect(action).toHaveBeenCalledWith({
      spacePath: 'E:\\Mindscape\\空间A',
      canvasPoint: { x: 300, y: 200 },
    })

    resetPluginCenter()
  })

  it('没有插件贡献时菜单与插件功能上线前完全一致（不多出分隔线 / 空项）', () => {
    resetPluginCenter()
    const items = buildCanvasMenuItems({ ...base, hasCopiedCards: false })
    expect(items).toHaveLength(4)
  })
})

describe('buildCardMenuItems · 锁定卡片（2026-09-20）', () => {
  const base = {
    screen: { x: 10, y: 20 },
    spacePath: 'E:/space',
    removedView: false,
    selectedIds: [] as string[],
    selectedCards: [] as Card[],
    onMove: vi.fn(),
    onRestore: vi.fn(),
    onSetColor: vi.fn(),
    onRenameFile: vi.fn(),
    onDeleteForever: vi.fn(),
  }

  it('未锁定显示「锁定卡片」，已锁定显示「解锁卡片」', () => {
    const unlocked = buildCardMenuItems({ ...base, card: fileCard() })
    expect(unlocked.find((item) => item.id === CARD_ACTION.toggleLock)?.label).toBe('锁定卡片')

    const lockedCard = fileCard()
    lockedCard.meta = { locked: true }
    const locked = buildCardMenuItems({ ...base, card: lockedCard })
    expect(locked.find((item) => item.id === CARD_ACTION.toggleLock)?.label).toBe('解锁卡片')
  })
})
