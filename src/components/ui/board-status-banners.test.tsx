// ============================================================================
// 模块说明（中文）
// 顶部状态提示条展示层的单元测试（A1，2026-09-20）。
//
// 环境约束（用户裁决：不引入 jsdom）→ 用 renderToStaticMarkup 静态渲染，
// 断言「props → HTML」的映射；容器（BoardStatusBanners）的订阅与聚焦监听属交互，
// 由真机验证，不在本文件覆盖。
// ============================================================================

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { ExternalChangeNotice } from './board-status-banners'
import { EXTERNAL_CHANGE_TEXT } from './external-change-text'

function render(over: Partial<Parameters<typeof ExternalChangeNotice>[0]> = {}) {
  return renderToStaticMarkup(
    <ExternalChangeNotice
      change={{ prevFiles: 3, files: 5 }}
      busy={false}
      onRescan={() => {}}
      onDismiss={() => {}}
      {...over}
    />,
  )
}

describe('ExternalChangeNotice 渲染', () => {
  it('显示变动摘要 + 补充说明 + 两个动作按钮', () => {
    const html = render()

    expect(html).toContain('3 → 5')
    expect(html).toContain(EXTERNAL_CHANGE_TEXT.hint)
    expect(html).toContain(EXTERNAL_CHANGE_TEXT.rescan)
    expect(html).toContain(EXTERNAL_CHANGE_TEXT.dismiss)
  })

  it('数量没变时用另一种措辞（不出现「3 → 3」）', () => {
    const html = render({ change: { prevFiles: 3, files: 3 } })

    expect(html).not.toContain('3 → 3')
    expect(html).toContain('名称或内容有变化')
  })

  it('扫描中：按钮文案变为「扫描中…」且两个按钮都禁用（防重复重扫）', () => {
    const html = render({ busy: true })

    expect(html).toContain(EXTERNAL_CHANGE_TEXT.rescanning)
    expect(html.match(/disabled=""/g) ?? []).toHaveLength(2)
  })

  it('空闲态：两个按钮都可点（不输出 disabled 属性）', () => {
    const html = render()

    expect(html.match(/<button/g) ?? []).toHaveLength(2)
    expect(html.match(/disabled=""/g) ?? []).toHaveLength(0)
  })
})
