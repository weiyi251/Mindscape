import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { CanvasTouchToolbar } from './CanvasTouchToolbar'
import { CANVAS_TOUCH_TOOLBAR_TEXT } from './canvasOverlayText'

const render = (selectMode: boolean, withSearch = true) =>
  renderToStaticMarkup(
    <CanvasTouchToolbar
      selectMode={selectMode}
      onSelectModeChange={vi.fn()}
      onSearch={withSearch ? vi.fn() : undefined}
      onFit={vi.fn()}
      onReset={vi.fn()}
    />,
  )

describe('CanvasTouchToolbar（M2 移动端兜底按钮）', () => {
  it('四个按钮：框选 / 搜索 / 适应 / 复位（搜索是 M3 补的 Ctrl+F 触屏替身）', () => {
    const html = render(false)
    expect(html.match(/<button/g)).toHaveLength(4)
    expect(html).toContain(CANVAS_TOUCH_TOOLBAR_TEXT.select)
    expect(html).toContain(CANVAS_TOUCH_TOOLBAR_TEXT.search)
    expect(html).toContain(CANVAS_TOUCH_TOOLBAR_TEXT.fit)
    expect(html).toContain(CANVAS_TOUCH_TOOLBAR_TEXT.reset)
  })

  it('宿主没有搜索动作时不挂空按钮', () => {
    const html = render(false, false)
    expect(html.match(/<button/g)).toHaveLength(3)
    expect(html).not.toContain(CANVAS_TOUCH_TOOLBAR_TEXT.search)
  })

  it('选择模式开着：标签变成「框选中」且只有一个按钮处于按下态', () => {
    const html = render(true)
    expect(html).toContain(CANVAS_TOUCH_TOOLBAR_TEXT.selectOn)
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
  })

  it('选择模式关着：aria-pressed=false', () => {
    expect(render(false)).toContain('aria-pressed="false"')
  })

  it('按钮带 44px 最小点按区（触屏拇指尺寸，不靠桌面 hover 才发现可点）', () => {
    expect(render(false)).toContain('min-h-[44px]')
  })

  it('半透明底不用 backdrop-filter（17.11 反模式：WebView 下严重掉帧）', () => {
    expect(render(false)).not.toContain('backdrop-')
  })
})
