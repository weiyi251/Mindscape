// ============================================================================
// 模块说明（中文）
// 插件列表行的两档触控尺寸（2026-09-28 移动端第三轮：「不要太满」）。
//
// 组件是纯展示（数据来自父组件，可用性判定来自 core/plugin/lifecycle 的纯函数），
// 所以 node 环境静态渲染即可断言类名，不必引入 jsdom。
//
// 锁两件事：
//   1. 窄屏（Tailwind 移动优先的基础类）两个按钮都要 ≥44px —— 此前是 py-0.5 的
//      20px 小按钮，清单 §3 的 44px 点按区只有 button.tsx 那一处做到了，
//      这些手写按钮一直在标准线以下。
//   2. 桌面必须回落到原来的小尺寸（红线 R2），靠 `sm:min-h-0` 兜回去。
// ============================================================================

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { PluginListItem } from './plugin-list-item'
import type { PluginRecord } from '@/core/plugin/types'

const plugin: PluginRecord = {
  id: 'demo',
  name: '示例插件',
  version: '1.0.0',
  description: '用于断言触控尺寸的假记录',
  author: '测试',
  source: 'builtin',
  installDir: null,
  main: 'index.js',
  state: 'active',
  detail: '内置 · 已启用',
  config: {},
  contributions: { cardTypes: 1, menuItems: 0, canvasMenuItems: 0, hooks: 0 },
}

const markup = () =>
  renderToStaticMarkup(
    <PluginListItem plugin={plugin} pending={false} expanded={false} onToggle={() => {}} onToggleDetail={() => {}} />,
  )

describe('插件列表行（触控尺寸两档）', () => {
  it('窄屏：启用 / 停用与「详情」两个按钮都给到 44px', () => {
    const html = markup()
    // 两个按钮的最小二号：至少要出现两次 min-h-[44px]
    expect(html.match(/min-h-\[44px\]/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  it('桌面的一档用 sm: 兜回小尺寸，不会被紧凑档带大（R2）', () => {
    const html = markup()
    expect(html).toContain('sm:min-h-0')
    expect(html).toContain('sm:py-0.5')
  })

  it('窄屏字号提到 12px 档（正文 text-sm / 小结 text-xs），桌面仍回落到 text-xs / text-[11px]', () => {
    const html = markup()
    expect(html).toContain('text-sm font-medium')
    expect(html).toContain('sm:text-xs')
    expect(html).toContain('sm:text-[11px]')
  })
})
