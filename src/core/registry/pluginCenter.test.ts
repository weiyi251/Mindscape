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
  registerToolbarItem,
  listRegisteredToolbarItems,
  registerHook,
  unregisterHook,
  emitHook,
  countHookHandlers,
  resetPluginCenter,
} from '@/core/registry/pluginCenter'
import type { CardTypeDef, MenuItem } from '@/core/registry/pluginCenter'

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
