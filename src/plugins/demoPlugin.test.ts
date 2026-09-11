// ============================================================================
// 模块说明（中文）
// 临时测试插件集成测试 —— 直接对应 T0.9 的验收标准：
//   「写一个临时测试插件，能注册卡片类型 + 菜单项 + 钩子并生效。」
//
// 与 pluginCenter.test.ts 的区别：
//   · pluginCenter.test.ts 验证「接口本身」的行为；
//   · 本文件验证「第三方插件按 17.8 文档写法写一遍，是否真的能被核心读取生效」，
//     即端到端的插件可用性证明。
//
// 实现任务：T0.9（准备层）。
// ============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'

import { zCardSchema } from '@/core/types'
import type { Card } from '@/core/types'
import {
  getRegisteredCardType,
  getPluginMenuItemsForCard,
  listRegisteredToolbarItems,
  emitHook,
  resetPluginCenter,
} from '@/core/registry/pluginCenter'
import {
  installDemoPlugin,
  resetDemoState,
  demoCardMovedHookCount,
  demoHookState,
  demoActionLog,
  DEMO_CARD_TYPE,
  readDemoMeta,
  writeDemoMeta,
} from '@/plugins/demoPlugin'

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

/** 取某卡片可见的插件菜单 id 列表，方便断言 */
function menuIdsFor(card: Card): string[] {
  return getPluginMenuItemsForCard(card).map((item) => item.id)
}

beforeEach(() => {
  vi.restoreAllMocks()
  resetPluginCenter()
  resetDemoState()
  installDemoPlugin()
})

describe('T0.9 验收：临时测试插件注册卡片类型', () => {
  it('插件新增的卡片类型可被核心查到，且能渲染出节点', () => {
    const def = getRegisteredCardType(DEMO_CARD_TYPE)

    expect(def).toBeDefined()
    expect(def?.defaultSize).toEqual({ w: 160, h: 160 })

    // render 是合法的 React 渲染函数：返回一个带有 data-card-id 的 React 元素
    const node = def?.render({ card: makeCard({ id: 'c-9' }), selected: true })
    expect(node).toMatchObject({
      props: {
        'data-card-id': 'c-9',
        'data-selected': true,
        className: 'demo-color-card',
      },
    })
  })
})

describe('T0.9 验收：临时测试插件注册菜单项', () => {
  it('按卡片类型区分菜单：图片卡片显示导出项，色卡显示改色项', () => {
    const imageMenu = menuIdsFor(makeCard({ type: 'image' }))
    expect(imageMenu).toContain('demo.exportImage')
    expect(imageMenu).not.toContain('demo.editColor')

    const colorCardMenu = menuIdsFor(makeCard({ type: DEMO_CARD_TYPE }))
    expect(colorCardMenu).toContain('demo.editColor')
    expect(colorCardMenu).not.toContain('demo.exportImage')
  })

  it('appliesTo 生效：标记满 3 次的卡片不再显示「标记为参考」', () => {
    const plain = makeCard({ type: 'note' })
    expect(menuIdsFor(plain)).toContain('demo.markReference')

    const full = makeCard({
      type: 'note',
      meta: { demoPlugin: { color: '#5A7D6A', markedCount: 3 } },
    })
    expect(menuIdsFor(full)).not.toContain('demo.markReference')
  })

  it('菜单动作真的能被调用（带上上下文）', () => {
    const card = makeCard({ type: 'image' })
    const item = getPluginMenuItemsForCard(card).find((m) => m.id === 'demo.exportImage')

    item?.action({ spacePath: 'D:\\Mindscape\\空间A', card })

    expect(demoActionLog.lastAction).toBe('demo.exportImage')
    expect(demoActionLog.lastPayload).toEqual({ spacePath: 'D:\\Mindscape\\空间A', card })
  })
})

describe('T0.9 验收：临时测试插件注册工具栏项', () => {
  it('工具栏项注册成功且动作可执行', () => {
    const item = listRegisteredToolbarItems().find((t) => t.id === 'demo.toolbar.addColorCard')
    expect(item?.label).toBe('新建色卡')

    item?.action()
    expect(demoActionLog.lastAction).toBe('demo.toolbar.addColorCard')
  })
})

describe('T0.9 验收：临时测试插件注册钩子', () => {
  it('钩子注册成功，核心触发后插件逻辑被执行', () => {
    expect(demoCardMovedHookCount()).toBe(1)

    emitHook('cardMoved', { id: 'card-1', x: 10, y: 20 })
    emitHook('cardMoved', { id: 'card-1', x: 30, y: 40 })

    expect(demoHookState.cardMovedCount).toBe(2)
  })

  it('插件未监听的钩子不受影响', () => {
    expect(emitHook('spaceClosed', null)).toBe(0)
    expect(demoHookState.cardMovedCount).toBe(0)
  })
})

describe('T0.9 验收：插件 meta 扩展位可用', () => {
  it('插件私有数据可写入 card.meta 并读回，不污染其他字段', () => {
    const card = makeCard({ type: DEMO_CARD_TYPE })

    expect(readDemoMeta(card)).toEqual({ color: '#5A7D6A', markedCount: 0 })

    const meta = writeDemoMeta(card, { color: '#C4703E', markedCount: 1 })
    const updated = { ...card, meta }

    expect(readDemoMeta(updated)).toEqual({ color: '#C4703E', markedCount: 1 })
    // 写入是纯函数：原卡片 meta 未被修改
    expect(card.meta).toEqual({})
  })
})
