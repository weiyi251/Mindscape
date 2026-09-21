import { describe, expect, it, vi } from 'vitest'
import { useRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { CanvasOverlay } from './CanvasOverlay'
import { CANVAS_OVERLAY_TEXT } from './canvasOverlayText'

function Harness({ touch }: { touch: boolean }) {
  const zoomLabelRef = useRef<HTMLSpanElement>(null)
  return (
    <CanvasOverlay
      cardCount={7}
      zoomLabelRef={zoomLabelRef}
      touch={touch}
      selectMode={false}
      onSelectModeChange={vi.fn()}
      onFit={vi.fn()}
      onReset={vi.fn()}
    />
  )
}

describe('CanvasOverlay（桌面 / 触屏两套浮层）', () => {
  it('桌面：状态条给出快捷键提示，右下角是带快捷键的长标签按钮（外观零改动）', () => {
    const html = renderToStaticMarkup(<Harness touch={false} />)
    expect(html).toContain(CANVAS_OVERLAY_TEXT.desktopHint)
    expect(html).toContain(CANVAS_OVERLAY_TEXT.desktopFit)
    expect(html).toContain(CANVAS_OVERLAY_TEXT.desktopReset)
    expect(html).not.toContain('框选中')
  })

  it('触屏：换成手势提示与短按钮，不再出现桌面快捷键文案', () => {
    const html = renderToStaticMarkup(<Harness touch />)
    expect(html).toContain(CANVAS_OVERLAY_TEXT.touchHint)
    expect(html).toContain('>框选<')
    expect(html).not.toContain('Ctrl+0')
  })

  it('卡片数照常渲染，缩放百分比留给 DOM 直写（不进 props，17.3）', () => {
    const html = renderToStaticMarkup(<Harness touch={false} />)
    expect(html).toContain('7 张')
    expect(html).toContain('100%')
  })
})
