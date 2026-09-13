// ============================================================================
// 模块说明（中文）
// pluginCenter 单元测试 —— 覆盖 17.8 五个插件接口的基本行为。
// 每个用例前调用 resetPluginCenter()，保证用例之间互不污染。
//
// 实现任务：T0.9（准备层）。
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { zCardSchema } from '@/core/types'
import type { Card } from '@/core/types'
import {
  registerCardType,
  getRegisteredCardType,
  listRegisteredCardTypes,
  registerMenuItem,
  listRegisteredMenuItems,
  getPluginMenuItemsForCard,
  registerCanvasMenuItem,
  listRegisteredCanvasMenuItems,
  registerToolbarItem,
  listRegisteredToolbarItems,
  registerHook,
  unregisterHook,
  emitHook,
  emitHookTyped,
  countHookHandlers,
  createPluginApi,
  disposePlugin,
  hasPluginContributions,
  listPluginContributions,
  getRegistryVersion,
  resetPluginCenter,
} from '@/core/registry/pluginCenter'
import type { CardTypeDef, CanvasMenuItem, MenuItem } from '@/core/registry/pluginCenter'

/** 造一张合法卡片；未指定的字段走 zod 默认值 */
function makeCard(over: Partial<Card> = {}): Card {
  return zCardSchema.parse({
    id: 'card-1',
    type: 'image',
    filePath: 'a.png',
    originalPath: 'a.png',
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    ...over,
  })
}

function makeCardType(type: string): CardTypeDef {
  return {
    type,
    render: () => null,
    menu: [],
    defaultSize: { w: 100, h: 100 },
  }
}

function makeMenuItem(id: string, appliesTo?: MenuItem['appliesTo']): MenuItem {
  return { id, label: `菜单 ${id}`, appliesTo, action: () => {} }
}

function makeCanvasMenuItem(id: string): CanvasMenuItem {
  return { id, label: `画布菜单 ${id}`, action: () => {} }
}

beforeEach(() => {
  resetPluginCenter()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// 初始状态
// ---------------------------------------------------------------------------

describe('resetPluginCenter', () => {
  it('空白状态下所有注册表为空', () => {
    expect(listRegisteredCardTypes()).toEqual([])
    expect(listRegisteredMenuItems()).toEqual([])
    expect(listRegisteredToolbarItems()).toEqual([])
    expect(getPluginMenuItemsForCard(makeCard())).toEqual([])
    expect(countHookHandlers('cardMoved')).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 接口 1：registerCardType
// ---------------------------------------------------------------------------

describe('接口 1 registerCardType', () => {
  it('注册后可查到同一个定义', () => {
    const def = makeCardType('demo')
    registerCardType(def)

    expect(getRegisteredCardType('demo')).toBe(def)
    expect(listRegisteredCardTypes()).toHaveLength(1)
  })

  it('未注册的类型返回 undefined', () => {
    expect(getRegisteredCardType('not-registered')).toBeUndefined()
  })

  it('type 为空时抛错', () => {
    expect(() => registerCardType(makeCardType(''))).toThrow(/type 不能为空/)
  })

  it('重复注册同一 type：console.warn 提示并被新定义覆盖', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    registerCardType(makeCardType('demo'))
    const second = makeCardType('demo')
    registerCardType(second)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(getRegisteredCardType('demo')).toBe(second)
    expect(listRegisteredCardTypes()).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 接口 2：registerMenuItem
// ---------------------------------------------------------------------------

describe('接口 2 registerMenuItem', () => {
  it('不限定类型时对所有卡片可见', () => {
    registerMenuItem(makeMenuItem('common'))

    const ids = getPluginMenuItemsForCard(makeCard({ type: 'note' })).map((m) => m.id)
    expect(ids).toEqual(['common'])
  })

  it('通过第二个参数限定卡片类型：不匹配的类型看不到', () => {
    registerMenuItem(makeMenuItem('only-image'), 'image')

    expect(getPluginMenuItemsForCard(makeCard({ type: 'image' })).map((m) => m.id)).toEqual([
      'only-image',
    ])
    expect(getPluginMenuItemsForCard(makeCard({ type: 'note' }))).toEqual([])
    expect(getPluginMenuItemsForCard(makeCard({ type: 'file' }))).toEqual([])
  })

  it('appliesTo 返回 false 时对该卡片隐藏', () => {
    registerMenuItem(makeMenuItem('big-only', (card) => card.w >= 200))

    expect(getPluginMenuItemsForCard(makeCard({ w: 300 })).map((m) => m.id)).toEqual(['big-only'])
    expect(getPluginMenuItemsForCard(makeCard({ w: 100 }))).toEqual([])
  })

  it('类型限定与 appliesTo 同时生效（两者都满足才可见）', () => {
    registerMenuItem(makeMenuItem('image-and-big', (card) => card.w >= 200), 'image')

    expect(getPluginMenuItemsForCard(makeCard({ type: 'image', w: 300 }))).toHaveLength(1)
    expect(getPluginMenuItemsForCard(makeCard({ type: 'image', w: 100 }))).toHaveLength(0)
    expect(getPluginMenuItemsForCard(makeCard({ type: 'note', w: 300 }))).toHaveLength(0)
  })

  it('id 为空时抛错', () => {
    expect(() => registerMenuItem(makeMenuItem(''))).toThrow(/id 不能为空/)
  })

  it('同一 id + 不同类型限定视为两条独立菜单项', () => {
    registerMenuItem(makeMenuItem('same'), 'image')
    registerMenuItem(makeMenuItem('same'), 'note')

    expect(listRegisteredMenuItems()).toHaveLength(2)
    expect(getPluginMenuItemsForCard(makeCard({ type: 'image' }))).toHaveLength(1)
    expect(getPluginMenuItemsForCard(makeCard({ type: 'note' }))).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 接口 3：registerToolbarItem
// ---------------------------------------------------------------------------

describe('接口 3 registerToolbarItem', () => {
  it('注册后可列出，且动作可执行', () => {
    const calls: string[] = []
    registerToolbarItem({
      id: 'tb-1',
      label: '新建',
      action: () => calls.push('clicked'),
    })

    const items = listRegisteredToolbarItems()
    expect(items).toHaveLength(1)
    expect(items[0].label).toBe('新建')

    items[0].action()
    expect(calls).toEqual(['clicked'])
  })

  it('id 为空时抛错', () => {
    expect(() => registerToolbarItem({ id: '', label: 'x', action: () => {} })).toThrow(
      /id 不能为空/,
    )
  })

  it('重复注册同一 id：console.warn 提示并覆盖', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    registerToolbarItem({ id: 'tb-1', label: '旧', action: () => {} })
    registerToolbarItem({ id: 'tb-1', label: '新', action: () => {} })

    expect(warn).toHaveBeenCalledTimes(1)
    expect(listRegisteredToolbarItems()).toHaveLength(1)
    expect(listRegisteredToolbarItems()[0].label).toBe('新')
  })
})

// ---------------------------------------------------------------------------
// 接口 5：registerHook / emitHook
// ---------------------------------------------------------------------------

describe('接口 5 registerHook / emitHook', () => {
  it('注册后触发钩子会调用回调并返回调用数量', () => {
    const seen: unknown[] = []
    registerHook('cardMoved', (payload) => seen.push(payload))

    const called = emitHook('cardMoved', { id: 'card-1' })

    expect(called).toBe(1)
    expect(seen).toEqual([{ id: 'card-1' }])
    expect(countHookHandlers('cardMoved')).toBe(1)
  })

  it('同一钩子可挂多个回调，全部被调用', () => {
    const order: string[] = []
    registerHook('cardCreated', () => order.push('a'))
    registerHook('cardCreated', () => order.push('b'))

    expect(emitHook('cardCreated', null)).toBe(2)
    expect(order).toEqual(['a', 'b'])
  })

  it('未注册任何回调时返回 0', () => {
    expect(emitHook('cardRemoved', null)).toBe(0)
  })

  it('单个回调抛错不影响其他回调，且不计入返回数量', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ok = vi.fn()

    registerHook('spaceOpened', () => {
      throw new Error('插件内部错误')
    })
    registerHook('spaceOpened', ok)

    expect(emitHook('spaceOpened', '/some/path')).toBe(1)
    expect(ok).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledTimes(1)
  })

  it('注销后不再被调用', () => {
    const fn = vi.fn()
    registerHook('spaceClosed', fn)
    unregisterHook('spaceClosed', fn)

    expect(emitHook('spaceClosed', null)).toBe(0)
    expect(fn).not.toHaveBeenCalled()
    expect(countHookHandlers('spaceClosed')).toBe(0)
  })

  it('注销未注册的回调不会抛错', () => {
    expect(() => unregisterHook('cardSelected', () => {})).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// 接口 2b：画布空白菜单（2026-09-14 新增）
// ---------------------------------------------------------------------------

describe('接口 2b registerCanvasMenuItem', () => {
  it('注册后可按顺序列出，动作可执行', () => {
    const calls: string[] = []
    registerCanvasMenuItem({ id: 'canvas-a', label: '新建色卡', action: () => calls.push('a') })
    registerCanvasMenuItem(makeCanvasMenuItem('canvas-b'))

    const items = listRegisteredCanvasMenuItems()
    expect(items.map((item) => item.id)).toEqual(['canvas-a', 'canvas-b'])

    items[0].action({ spacePath: 'E:/空间' })
    expect(calls).toEqual(['a'])
  })

  it('id 为空时抛错', () => {
    expect(() => registerCanvasMenuItem(makeCanvasMenuItem(''))).toThrow(/id 不能为空/)
  })

  it('重复注册同一 id：console.warn 提示并覆盖', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    registerCanvasMenuItem(makeCanvasMenuItem('dup'))
    registerCanvasMenuItem(makeCanvasMenuItem('dup'))

    expect(warn).toHaveBeenCalledTimes(1)
    expect(listRegisteredCanvasMenuItems()).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// registryVersion（2026-09-14 新增）：任何注册 / 注销都自增
// ---------------------------------------------------------------------------

describe('getRegistryVersion', () => {
  it('注册与注销都会让版本号自增', () => {
    const start = getRegistryVersion()

    registerCardType(makeCardType('version-card'))
    const afterCard = getRegistryVersion()
    expect(afterCard).toBeGreaterThan(start)

    registerMenuItem(makeMenuItem('version-menu'))
    registerCanvasMenuItem(makeCanvasMenuItem('version-canvas'))
    registerToolbarItem({ id: 'version-tb', label: 'x', action: () => {} })
    registerHook('cardSelected', () => {})
    expect(getRegistryVersion()).toBeGreaterThan(afterCard)

    const beforeDispose = getRegistryVersion()
    disposePlugin('com.example.version')
    // 未登记过的插件也算一次「操作」（内部统一 bump），至少不倒退
    expect(getRegistryVersion()).toBeGreaterThanOrEqual(beforeDispose)
  })

  it('重复注册（覆盖）同样自增', () => {
    registerCardType(makeCardType('dup-version'))
    const before = getRegistryVersion()
    registerCardType(makeCardType('dup-version'))
    expect(getRegistryVersion()).toBeGreaterThan(before)
  })
})

// ---------------------------------------------------------------------------
// createPluginApi / disposePlugin（2026-09-14 新增）：归属与回收
// ---------------------------------------------------------------------------

describe('createPluginApi + disposePlugin', () => {
  it('pluginId 为空时抛错', () => {
    expect(() => createPluginApi('')).toThrow(/pluginId 不能为空/)
  })

  it('通过 API 注册的条目会被记为该插件的归属', () => {
    const api = createPluginApi('com.example.alpha')
    api.registerCardType(makeCardType('alpha-card'))
    api.registerMenuItem(makeMenuItem('alpha-menu'), 'alpha-card')
    api.registerCanvasMenuItem(makeCanvasMenuItem('alpha-canvas'))
    api.registerToolbarItem({ id: 'alpha-tb', label: '新建', action: () => {} })
    api.registerHook('cardMoved', () => {})

    expect(api.pluginId).toBe('com.example.alpha')
    expect(hasPluginContributions('com.example.alpha')).toBe(true)
    expect(listPluginContributions('com.example.alpha')).toEqual({
      cardTypes: 1,
      menuItems: 1,
      canvasMenuItems: 1,
      toolbarItems: 1,
      hooks: 1,
    })
  })

  it('disposePlugin 摘除该插件的全部注册，且不影响其他插件', () => {
    const alpha = createPluginApi('com.example.alpha')
    const beta = createPluginApi('com.example.beta')

    alpha.registerCardType(makeCardType('alpha-card'))
    alpha.registerMenuItem(makeMenuItem('alpha-menu'))
    alpha.registerCanvasMenuItem(makeCanvasMenuItem('alpha-canvas'))
    alpha.registerToolbarItem({ id: 'alpha-tb', label: 'a', action: () => {} })
    const alphaHook = vi.fn()
    alpha.registerHook('cardMoved', alphaHook)

    beta.registerCardType(makeCardType('beta-card'))
    const betaHook = vi.fn()
    beta.registerHook('cardMoved', betaHook)

    const removed = disposePlugin('com.example.alpha')

    expect(removed).toBe(5)
    expect(getRegisteredCardType('alpha-card')).toBeUndefined()
    expect(listRegisteredMenuItems()).toHaveLength(0)
    expect(listRegisteredCanvasMenuItems()).toHaveLength(0)
    expect(listRegisteredToolbarItems()).toHaveLength(0)
    // alpha 的钩子已摘除，beta 的仍在
    expect(emitHook('cardMoved', null)).toBe(1)
    expect(alphaHook).not.toHaveBeenCalled()
    expect(betaHook).toHaveBeenCalledTimes(1)

    // beta 的注册毫发无损
    expect(getRegisteredCardType('beta-card')).toBeDefined()
    expect(hasPluginContributions('com.example.beta')).toBe(true)
    expect(hasPluginContributions('com.example.alpha')).toBe(false)
  })

  it('disposePlugin 幂等：未登记的插件返回 0 且不抛错', () => {
    expect(disposePlugin('com.example.never-installed')).toBe(0)
    expect(() => disposePlugin('')).not.toThrow()
  })

  it('注册 → 注销 → 再注册（模拟启停循环）能回到干净状态', () => {
    const first = createPluginApi('com.example.loop')
    first.registerCardType(makeCardType('loop-card'))
    expect(listRegisteredCardTypes()).toHaveLength(1)

    disposePlugin('com.example.loop')
    expect(listRegisteredCardTypes()).toHaveLength(0)

    const second = createPluginApi('com.example.loop')
    second.registerCardType(makeCardType('loop-card'))
    expect(listRegisteredCardTypes()).toHaveLength(1)
    expect(listPluginContributions('com.example.loop').cardTypes).toBe(1)
  })

  it('同名 id 被两个插件先后注册：注销前者不会误删后者覆盖上去的定义', () => {
    const alpha = createPluginApi('com.example.alpha')
    const beta = createPluginApi('com.example.beta')

    alpha.registerCardType(makeCardType('shared'))
    const betaDef = makeCardType('shared')
    beta.registerCardType(betaDef)

    // 后注册者覆盖，当前生效的是 beta 的定义
    expect(getRegisteredCardType('shared')).toBe(betaDef)

    // 注销 alpha：同一性校验发现当前值已不是 alpha 的定义 → 不删、也不计数
    expect(disposePlugin('com.example.alpha')).toBe(0)
    expect(getRegisteredCardType('shared')).toBe(betaDef)

    // 再注销 beta：这次才是它的定义，正常摘除
    expect(disposePlugin('com.example.beta')).toBe(1)
    expect(getRegisteredCardType('shared')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// emitHookTyped（2026-09-14 新增）
// ---------------------------------------------------------------------------

describe('emitHookTyped', () => {
  it('与 emitHook 行为一致，只是载荷受 HookPayloadMap 约束', () => {
    const seen: unknown[] = []
    registerHook('cardMoved', (payload) => seen.push(payload))

    const called = emitHookTyped('cardMoved', { cardId: 'card-1', x: 12, y: 34 })

    expect(called).toBe(1)
    expect(seen).toEqual([{ cardId: 'card-1', x: 12, y: 34 }])
  })
})

// ---------------------------------------------------------------------------
// resetPluginCenter（扩展后）：归属记录也要清空
// ---------------------------------------------------------------------------

describe('resetPluginCenter 清空归属', () => {
  it('重置后不再有任何插件的归属记录', () => {
    const api = createPluginApi('com.example.tmp')
    api.registerCardType(makeCardType('tmp-card'))
    expect(hasPluginContributions('com.example.tmp')).toBe(true)

    resetPluginCenter()

    expect(hasPluginContributions('com.example.tmp')).toBe(false)
    expect(listRegisteredCanvasMenuItems()).toEqual([])
  })
})
