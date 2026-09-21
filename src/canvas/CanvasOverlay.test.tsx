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
      onSearch={vi.fn()}
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
    // 搜索入口只服务触屏：桌面的 Ctrl+F 已经在画布快捷键里，不重复挂按钮
    expect(html).not.toContain('>搜索<')
  })

  it('触屏：换成手势提示与短按钮，不再出现桌面快捷键文案', () => {
    const html = renderToStaticMarkup(<Harness touch />)
    expect(html).toContain(CANVAS_OVERLAY_TEXT.touchHint)
    expect(html).toContain('>框选<')
    expect(html).toContain('>搜索<')
    expect(html).not.toContain('Ctrl+0')
  })

  it('卡片数照常渲染，缩放百分比留给 DOM 直写（不进 props，17.3）', () => {
    const html = renderToStaticMarkup(<Harness touch={false} />)
    expect(html).toContain('7 张')
    expect(html).toContain('100%')
  })
})

// 真机第一轮反馈「有的 ui 重叠了」：状态条与按钮条原本各挂各的
// `absolute bottom-3`（一左一右），手机上四五个 44px 按钮吃掉大半屏宽，
// 状态条被压住又在窄屏上换行，两层直接叠在一起。
describe('CanvasOverlay 布局（真机第一轮：底部浮层重叠）', () => {
  it('桌面：左下角状态条 + 右下角按钮条，两个独立 absolute 定位（红线 R2）', () => {
    const html = renderToStaticMarkup(<Harness touch={false} />)
    expect(html).toContain('absolute bottom-3 left-3')
    expect(html).toContain('absolute bottom-3 right-3')
    expect(html).not.toContain('flex-col')
  })

  it('触屏：两块改成同一个竖排容器，不再各自 absolute', () => {
    const html = renderToStaticMarkup(<Harness touch />)
    expect(html).toContain('flex flex-col')
    // 桌面有 2 个 absolute（状态条 + 按钮条），触屏只剩通栏容器这 1 个
    expect(html.match(/absolute/g)).toHaveLength(1)
    expect(html).toContain('bottom-3 left-3 right-3')
  })

  it('触屏：通栏容器不吃指针，按钮那一行单独放开', () => {
    const html = renderToStaticMarkup(<Harness touch />)
    // 外层若可命中，两行之间与行旁的空白就拖不动画布了
    const wrapper = html.slice(0, html.indexOf('>', html.indexOf('flex flex-col')) + 1)
    expect(wrapper).toContain('pointer-events-none')
    expect(html).toContain('pointer-events-auto')
  })
})
