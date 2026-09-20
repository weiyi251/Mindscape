// ============================================================================
// 模块说明（中文）
// 「磁盘有文件夹、画布没有框」提示条的单元测试（A2，2026-09-20）。
//
// 环境约束（用户裁决）：不引入 jsdom，因此只做两件事 ——
//   · 文案拼接纯函数的取值断言；
//   · 用 renderToStaticMarkup 静态渲染展示层，断言「配置 → HTML」的映射正确。
// 交互观感（按钮落点、长名单截断）由真机确认。
// ============================================================================

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { UnframedFoldersNotice } from './unframed-folders-bar'
import { UNFRAMED_FOLDERS_TEXT } from './unframed-folders-text'

function render(over: Partial<Parameters<typeof UnframedFoldersNotice>[0]> = {}) {
  return renderToStaticMarkup(
    <UnframedFoldersNotice
      names={['空文件夹一']}
      busy={false}
      onGenerate={() => {}}
      onDismiss={() => {}}
      {...over}
    />,
  )
}

describe('UnframedFoldersNotice 渲染', () => {
  it('显示数量 + 文件夹名 + 两个操作按钮', () => {
    const html = render({ names: ['空的素材', '待整理'] })

    expect(html).toContain(UNFRAMED_FOLDERS_TEXT.lead(2))
    expect(html).toContain('空的素材、待整理')
    expect(html).toContain(UNFRAMED_FOLDERS_TEXT.generate)
    expect(html).toContain(UNFRAMED_FOLDERS_TEXT.dismiss)
    // 不出现 Tailwind 内置调色板类名（语义 token 守卫的组件级回归）
    expect(html).not.toContain('bg-blue-')
  })

  it('补框进行中：按钮文案变为「生成中…」且两个按钮都禁用（防重复入栈）', () => {
    const html = render({ busy: true })

    expect(html).toContain(UNFRAMED_FOLDERS_TEXT.generating)
    expect(html.match(/disabled=""/g) ?? []).toHaveLength(2)
  })

  it('空闲态：两个按钮都渲染且都可点（不输出 disabled 属性）', () => {
    const html = render()

    expect(html.match(/<button/g) ?? []).toHaveLength(2)
    expect(html.match(/disabled=""/g) ?? []).toHaveLength(0)
  })
})
