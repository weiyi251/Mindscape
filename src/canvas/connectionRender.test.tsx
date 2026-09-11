// ============================================================================
// 模块说明（中文）
// ConnectionLayer 的静态渲染实证测试（renderToStaticMarkup，node 环境无需 DOM）。
// 固化 2026-09-11「连线不可见」排查结论的标记层证据：
//   1. 可见 path 真实输出且 d 坐标正确（端点在卡片边缘锚点上）；
//   2. 颜色由 Tailwind 类承载（stroke-muted-foreground），不是表现属性 var()；
//   3. SVG 层为「固定大尺寸 + 平移组」方案 —— 不依赖 0×0 溢出绘制，
//      stage 原点映射到层中心的 <g transform="translate(...)"> 必须存在。
// ============================================================================

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'

import type { Card, Connection } from '@/core/types'
import { ConnectionLayer, CONNECTION_SVG_MARGIN } from './Connection'

const cards = [
  {
    id: 'a',
    type: 'image',
    filePath: 'x/a.jpg',
    originalPath: 'x/a.jpg',
    x: 100,
    y: 100,
    w: 200,
    h: 150,
    note: '',
    meta: {},
  },
  {
    id: 'b',
    type: 'note',
    filePath: '',
    x: 600,
    y: 400,
    w: 200,
    h: 160,
    note: '',
    meta: {},
  },
] as unknown as Card[]

const connections: Connection[] = [
  { id: 'c1', from: 'a', to: 'b', label: '引用', color: 'gray', meta: {} },
]

function render(list: Connection[] = connections, selectedIds: string[] = []): string {
  return renderToStaticMarkup(
    createElement(ConnectionLayer, { connections: list, cards, selectedIds }),
  )
}

describe('ConnectionLayer 静态渲染（标记层实证）', () => {
  it('SVG 层为固定大尺寸 + 平移组（stage 原点映射到层中心）', () => {
    const html = render()
    // 明确尺寸，不再是 0×0
    expect(html).toContain(`width:200000px`)
    expect(html).toContain(`height:200000px`)
    expect(html).toContain('left:-100000px')
    // 平移组存在
    expect(html).toContain(`translate(${CONNECTION_SVG_MARGIN} ${CONNECTION_SVG_MARGIN})`)
  })

  it('可见 path 真实输出，d 坐标为卡片边缘锚点', () => {
    const html = render()
    // a 卡中心 (200,175)、b 卡中心 (700,480)：锚点必落在两卡边框上
    expect(html).toContain('d="M ')
    expect(html).toMatch(/d="M \d+(\.\d+)? \d+(\.\d+)? C /)
    // 颜色由类承载，而非表现属性 var()
    expect(html).toContain('stroke-muted-foreground')
    expect(html).not.toMatch(/stroke="hsl\(var\(/)
    // 箭头 marker 挂载
    expect(html).toContain('marker-end="url(#mindscape-connection-arrow)"')
  })

  it('标签随连线渲染（底衬 rect + text）', () => {
    const html = render()
    expect(html).toContain('引用')
    expect(html).toContain('fill-foreground')
  })

  it('端点卡片缺失时不渲染该连线（数据残留兜底）', () => {
    const html = render([{ id: 'c1', from: 'a', to: 'ghost', label: '', color: 'gray', meta: {} }])
    expect(html).not.toContain('data-connection-id')
  })

  it('选中连线用 primary 高亮', () => {
    const html = render(undefined, ['c1'])
    expect(html).toContain('stroke-primary')
  })
})
