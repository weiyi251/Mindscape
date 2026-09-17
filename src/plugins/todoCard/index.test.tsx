// ============================================================================
// 模块说明（中文）
// 待办卡片插件入口（index.tsx）的单元测试。
//
// 验证「插件按约定接上了宿主」这件事：
//   · activate 注册一个卡片类型（todo）+ 一个画布菜单项，不多不少
//   · 卡片类型声明 widthOnly 手柄（高度自适应，不允许拖高）与默认尺寸
//   · 渲染函数交出 React 元素
//   · 菜单动作经 api.board.createCard 在右键点建卡（无文件建卡，meta 初始齐备）
//
// 用假的 PluginHostApi：真实 API 要 Tauri 与存储，这里只关心调用契约。
// ============================================================================

import { describe, expect, it, vi } from 'vitest'

import type { CardTypeDef, CanvasMenuItem } from '@/core/registry/pluginCenter'
import type { PluginHostApi } from '@/core/plugin/types'
import { TODO_CARD_TYPE, TODO_MENU_ITEM_ID, TODO_CARD_PLUGIN_ID, todoCardPlugin } from './index'
import { TODO_CARD_TEXT } from './text'
import { todoCardHeight } from './todos'

interface Harness {
  api: PluginHostApi
  cardTypes: CardTypeDef[]
  menuItems: CanvasMenuItem[]
  createdCards: Record<string, unknown>[]
}

function makeHarness(): Harness {
  const cardTypes: CardTypeDef[] = []
  const menuItems: CanvasMenuItem[] = []
  const createdCards: Record<string, unknown>[] = []

  const api = {
    pluginId: TODO_CARD_PLUGIN_ID,
    registerCardType: (def: CardTypeDef) => cardTypes.push(def),
    registerMenuItem: vi.fn(),
    registerCanvasMenuItem: (item: CanvasMenuItem) => menuItems.push(item),
    registerToolbarItem: vi.fn(),
    registerHook: vi.fn(),
    ui: { openDialog: vi.fn(), closeDialog: vi.fn() },
    fs: { writeBytes: vi.fn(), pickDirectory: vi.fn() },
    board: {
      currentSpacePath: () => null,
      createCardFromFile: vi.fn(),
      createCard: (input: Record<string, unknown>) => {
        createdCards.push(input)
        return Promise.resolve('c_new')
      },
      updateCardContent: vi.fn(async () => true),
    },
    config: { getAll: () => ({}), set: vi.fn() },
  } as unknown as PluginHostApi

  return { api, cardTypes, menuItems, createdCards }
}

describe('todoCardPlugin 元信息', () => {
  it('清单字段齐全，id 与导出常量一致', () => {
    const manifest = todoCardPlugin.manifest
    expect(manifest.id).toBe(TODO_CARD_PLUGIN_ID)
    expect(manifest.name).toBe(TODO_CARD_TEXT.pluginName)
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(manifest.description).toBe(TODO_CARD_TEXT.pluginDescription)
    expect(manifest.author).toBe(TODO_CARD_TEXT.pluginAuthor)
    expect(manifest.main.endsWith('.js')).toBe(true)
  })
})

describe('todoCardPlugin.activate', () => {
  it('注册一个卡片类型 + 一个画布菜单项，不动右键菜单 / 工具栏 / 钩子', async () => {
    const harness = makeHarness()

    await todoCardPlugin.activate(harness.api)

    expect(harness.cardTypes).toHaveLength(1)
    expect(harness.menuItems).toHaveLength(1)
    expect(harness.menuItems[0].id).toBe(TODO_MENU_ITEM_ID)
    expect(harness.menuItems[0].label).toBe(TODO_CARD_TEXT.menuLabel)

    expect(harness.api.registerMenuItem).not.toHaveBeenCalled()
    expect(harness.api.registerToolbarItem).not.toHaveBeenCalled()
    expect(harness.api.registerHook).not.toHaveBeenCalled()
  })

  it('卡片类型：type=todo、widthOnly 手柄（高度自适应）、默认尺寸与空卡高度一致', async () => {
    const harness = makeHarness()
    await todoCardPlugin.activate(harness.api)

    const def = harness.cardTypes[0]
    expect(def.type).toBe(TODO_CARD_TYPE)
    expect(def.resizeHandles).toBe('widthOnly')
    expect(def.defaultSize).toEqual({ w: 220, h: todoCardHeight(0) })
    expect(def.menu).toEqual([])
    // 渲染函数交出 React 元素（宿主渲染它才有内容）
    expect(def.render({ card: makeTodoCard(), selected: false })).toBeTruthy()
  })

  it('画布菜单动作：经 createCard 在右键点建 todo 卡，meta 初始齐备', async () => {
    const harness = makeHarness()
    await todoCardPlugin.activate(harness.api)

    harness.menuItems[0].action({ spacePath: 'E:\\Mindscape\\空间A', canvasPoint: { x: 120, y: 80 } })

    expect(harness.createdCards).toHaveLength(1)
    const input = harness.createdCards[0]
    expect(input.type).toBe(TODO_CARD_TYPE)
    expect(input.x).toBe(120)
    expect(input.y).toBe(80)
    expect(input.w).toBe(220)
    expect(input.h).toBe(todoCardHeight(0))
    expect(input.meta).toEqual({ items: [], itemAnchors: {} })
  })

  it('右键坐标缺省时不传 x / y（宿主放视口中心）', async () => {
    const harness = makeHarness()
    await todoCardPlugin.activate(harness.api)

    harness.menuItems[0].action({ spacePath: 'E:\\Mindscape\\空间A' })

    expect(harness.createdCards[0].x).toBeUndefined()
    expect(harness.createdCards[0].y).toBeUndefined()
  })
})

/** 最小合法 todo 卡（zod 形状） */
function makeTodoCard(): Parameters<CardTypeDef['render']>[0]['card'] {
  return {
    id: 'c_1',
    type: TODO_CARD_TYPE,
    filePath: '',
    originalPath: '',
    x: 0,
    y: 0,
    w: 220,
    h: todoCardHeight(0),
    rotation: 0,
    zIndex: 0,
    group: undefined,
    note: '',
    meta: { items: [], itemAnchors: {} },
  }
}
