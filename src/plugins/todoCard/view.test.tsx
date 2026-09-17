// ============================================================================
// 模块说明（中文）
// 待办卡片界面（view.tsx）的静态渲染回归测试。
//
// 背景（2026-09-18 修复「长文本被截断、不换行」）：罪魁祸首是条目文本用了
// **单行 input + truncate 类** —— 它天生只能显示一行，多余的字直接变省略号。
// 这类问题编译器拦不住、也不会报错，很容易在后续改动里悄悄回来，
// 所以这里用 renderToStaticMarkup 断言结构与类名（node 环境，不需要 jsdom）。
//
// 只断言「结构契约」，不断言真实换行后的像素 —— 那是浏览器的活儿，
// 真正的布局观感仍由用户真机确认（见 HANDOVER §9）。
// ============================================================================

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { PluginHostApi } from '@/core/plugin/types'
import { zCardSchema } from '@/core/types'
import type { Card } from '@/core/types'
import { metaWithTodos } from './todos'
import type { TodoItem } from './todos'
import { TodoCardView } from './view'

const ITEMS: TodoItem[] = [
  { id: 't1', text: '第一条待办', done: false },
  { id: 't2', text: '很长很长的一条待办，长到必须换行才看得全', done: true },
]

function makeCard(): Card {
  return zCardSchema.parse({
    id: 'c_1',
    type: 'todo',
    filePath: '',
    originalPath: '',
    x: 0,
    y: 0,
    w: 220,
    h: 120,
    meta: metaWithTodos({}, ITEMS),
  })
}

/** 假 API：只看有没有被调用，真实写入由桥完成（另有 pluginBridgeImpl.test.ts 覆盖） */
function makeApi(): PluginHostApi {
  return {
    board: {
      updateCardContent: vi.fn(async () => true),
      syncCardGeometry: vi.fn(async () => true),
    },
  } as unknown as PluginHostApi
}

/** 渲染成静态 HTML 字符串 */
function html(): string {
  return renderToStaticMarkup(<TodoCardView card={makeCard()} api={makeApi()} />)
}

describe('TodoCardView 静态渲染', () => {
  it('条目文本用多行控件 textarea（input 天生只能单行 —— 这是 bug 的根，不得回退）', () => {
    const markup = html()
    expect(markup.match(/<textarea/g)?.length).toBe(ITEMS.length)
    // 页面上只允许剩一个 input：底部「添加待办」的占位行（它本来就是单行、回车建条目）。
    // 条目行里再出现 input 就说明有人把多行改回单行了
    expect(markup.match(/<input/g)?.length).toBe(1)
    expect(markup).toContain('placeholder="添加待办，回车确认"')
  })

  it('条目文本不带 truncate —— 有了它就又变成省略号了', () => {
    expect(html()).not.toContain('truncate')
  })

  it('文本区允许换行：保留空白 + 长词断行（break-words 防超长串撑出卡片）', () => {
    const markup = html()
    expect(markup).toContain('whitespace-pre-wrap')
    expect(markup).toContain('break-words')
  })

  it('每一行都带 data-todo-row，几何测量靠它按 id 找回位置', () => {
    const markup = html()
    expect(markup).toContain('data-todo-row="t1"')
    expect(markup).toContain('data-todo-row="t2"')
  })

  it('连线点带齐两个标记，且用 self-center 垂直居中（换行后仍落在行的中间）', () => {
    const markup = html()
    expect(markup).toContain('data-connect-handle="c_1"')
    expect(markup).toContain('data-connect-item="t1"')
    expect(markup).toContain('data-connect-item="t2"')
    expect(markup).toContain('self-center')
  })

  it('卡内交互元素都带 data-card-interactive（否则点击会被画布当成拖拽）', () => {
    const markup = html()
    // 两条待办 × 三个交互件（复选框 / 文本框 / 删除）+ 底部添加行的输入框
    expect(markup.match(/data-card-interactive/g)?.length).toBe(ITEMS.length * 3 + 1)
  })

  it('内容层用文档流排布（flex-col），行位置由浏览器算出而非写死', () => {
    expect(html()).toContain('flex flex-col')
  })
})
