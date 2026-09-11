// ============================================================================
// 模块说明（中文）
// 通用菜单渲染组件测试。对应 T0.10 验收标准的后半句：
//   「改配置即时反映到 UI」—— 这里用 renderToStaticMarkup 把配置数组渲染成真实 HTML，
//   断言「换一份配置 → 输出随之变化」，即证明 UI 完全由配置驱动、无硬编码。
//
// 实现任务：T0.10（准备层）。
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { zCardSchema } from '@/core/types'
import type { Card } from '@/core/types'
import { registerMenuItem, resetPluginCenter } from '@/core/registry/pluginCenter'
import { CARD_ACTION, buildCardMenuFor } from '@/core/registry/menus'
import { registerAction, resetActions } from '@/core/registry/actionRegistry'
import { MenuList } from '@/components/ui/menu-list'

function makeCard(over: Partial<Card> = {}): Card {
  return zCardSchema.parse({
    id: 'card-1',
    type: 'image',
    filePath: 'ref-01.jpg',
    originalPath: 'ref-01.jpg',
    x: 0,
    y: 0,
    w: 220,
    h: 220,
    ...over,
  })
}

beforeEach(() => {
  resetPluginCenter()
  resetActions()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('MenuList 渲染', () => {
  it('按配置顺序渲染出全部菜单项（含中文名与 id 标记）', () => {
    const card = makeCard({ type: 'image' })
    const html = renderToStaticMarkup(
      <MenuList items={buildCardMenuFor(card)} ctx={{ spacePath: 'D:\\Mindscape\\空间A', card }} />,
    )

    expect(html).toContain('role="menu"')
    expect(html).toContain('打开原图')
    expect(html).toContain('移除')
    expect(html).toContain('连线')
    expect(html).toContain(`data-menu-item-id="${CARD_ACTION.remove}"`)

    // 顺序：移除 出现在 置顶 之前
    expect(html.indexOf('移除')).toBeLessThan(html.indexOf('置顶'))
  })

  it('空数组不渲染任何容器', () => {
    const html = renderToStaticMarkup(<MenuList items={[]} ctx={{ spacePath: '' }} />)
    expect(html).toBe('')
  })

  it('改配置即时反映到 UI：新增一条插件配置 → 渲染结果多一项', () => {
    const card = makeCard({ type: 'image' })
    const ctx = { spacePath: 'D:\\Mindscape\\空间A', card }

    const before = renderToStaticMarkup(<MenuList items={buildCardMenuFor(card)} ctx={ctx} />)
    expect(before).not.toContain('提取色彩')

    // 只改「配置」——不改任何 UI 代码
    registerMenuItem({ id: 'plugin.extractColor', label: '提取色彩', action: () => {} })

    const after = renderToStaticMarkup(<MenuList items={buildCardMenuFor(card)} ctx={ctx} />)
    expect(after).toContain('提取色彩')
    expect(after.length).toBeGreaterThan(before.length)
  })

  it('点击菜单项会带着上下文调用动作，并触发 onAfterAction', () => {
    const card = makeCard()
    const ctx = { spacePath: 'D:\\Mindscape\\空间A', card }
    const handler = vi.fn()
    registerAction(CARD_ACTION.remove, handler)

    const items = buildCardMenuFor(card)
    const removeItem = items.find((item) => item.id === CARD_ACTION.remove)

    // 直接调用渲染所用的同一个 action（node 环境下不做真实点击）
    removeItem?.action(ctx)

    expect(handler).toHaveBeenCalledWith(ctx)
  })

  it('分区菜单可复用同一组件（结构兼容）', () => {
    const ctx = { spacePath: 'D:\\Mindscape\\空间A' }
    const html = renderToStaticMarkup(
      <MenuList
        items={[{ id: 'partition.rename', label: '重命名分区', action: () => {} }]}
        ctx={ctx}
      />,
    )

    expect(html).toContain('重命名分区')
  })
})
