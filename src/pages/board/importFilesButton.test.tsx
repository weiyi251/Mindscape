// ============================================================================
// 模块说明（中文）
// importFilesButton.tsx 的静态渲染断言（2026-09-21 移动端适配 M4）。
// 环境是 node、不引 jsdom（AGENTS.md），所以这里只锁「标记齐不齐」：
// 隐藏的文件输入（multiple + accept + hidden）+ 一个纯图标按钮（aria-label / title）。
// `pickedFilesFrom` 与文案常量都在 importFilesFlow.ts，其测试在同目录的 flow 测试里。
// 点击 → 系统选择器 → 落盘 的真实流程由真机验证（docs/移动端适配计划.md §5 清单）。
// ============================================================================

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { IMPORT_FILE_ACCEPT, IMPORT_FILES_TEXT } from './importFilesFlow'
import { ImportFilesButton } from './importFilesButton'

const render = () => renderToStaticMarkup(<ImportFilesButton onFiles={vi.fn()} />)

describe('ImportFilesButton 标记', () => {
  it('一个文件输入 + 一个按钮（按钮面上不出现文字，与顶栏其余图标按钮一致）', () => {
    const html = render()
    expect(html.match(/<input/g)).toHaveLength(1)
    expect(html.match(/<button/g)).toHaveLength(1)
    expect(html).not.toContain(`>${IMPORT_FILES_TEXT.label}<`)
  })

  it('文件输入：multiple + accept + 不占位（hidden），语义靠 data 标记定位', () => {
    const html = render()
    expect(html).toContain('type="file"')
    expect(html).toContain('multiple=""')
    expect(html).toContain(`accept="${IMPORT_FILE_ACCEPT}"`)
    expect(html).toContain('class="hidden"')
    expect(html).toContain('data-import-files=""')
  })

  it('按钮用 aria-label / title 承载语义（读屏与长按提示都靠它）', () => {
    const html = render()
    expect(html).toContain(`aria-label="${IMPORT_FILES_TEXT.label}"`)
    expect(html).toContain(`title="${IMPORT_FILES_TEXT.title}"`)
  })

  it('文案与 accept 可换、可单选（空间列表页借它导入一个布局文件）', () => {
    const html = renderToStaticMarkup(
      <ImportFilesButton
        onFiles={vi.fn()}
        title="选一个 mindscape-layout.json"
        label="导入空间"
        accept=".json"
        multiple={false}
      />,
    )

    expect(html).not.toContain('multiple=""')
    expect(html).toContain('accept=".json"')
    expect(html).toContain('aria-label="导入空间"')
    expect(html).toContain('title="选一个 mindscape-layout.json"')
  })
})
