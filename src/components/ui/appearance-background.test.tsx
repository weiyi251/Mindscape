// ============================================================================
// 模块说明（中文）
// appearance-background 的单元测试（node 环境，renderToStaticMarkup）。
// store 替身化（node 里没有 Tauri 读盘），锁四件事：
//   无壁纸时壁纸层为空但画布玻璃层仍在（「毛玻璃覆盖在背景之上」的兜底观感）、
//   有壁纸时图片与遮罩层齐全、
//   画布玻璃层受 canvasGlass 开关控制（低端设备关掉即回到无玻璃）、
//   背景不拦截指针事件（画布拖拽不能被吃掉）。
// ============================================================================

import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { AppearanceBackground } from './appearance-background'

/** store 替身：bgUrl / canvasGlass 由用例改写（vi.mock 工厂提升，经可变对象间接传值） */
const backgroundMock = { bgUrl: null as string | null, canvasGlass: true }

vi.mock('@/core/appearance/appearanceStore', () => ({
  useAppearanceStore: (selector: (state: { bgUrl: string | null; glass: { canvasGlass: boolean } }) => unknown) =>
    selector({ bgUrl: backgroundMock.bgUrl, glass: { canvasGlass: backgroundMock.canvasGlass } }),
}))

const render = () => renderToStaticMarkup(<AppearanceBackground />)

afterEach(() => {
  backgroundMock.bgUrl = null
  backgroundMock.canvasGlass = true
})

describe('AppearanceBackground 背景图层', () => {
  it('无壁纸时壁纸层为空，但画布玻璃层仍渲染（磨砂盖在底色上）', () => {
    backgroundMock.bgUrl = null
    const html = render()
    expect(html).not.toContain('background-image')
    expect(html).not.toContain('glass-bg-dim')
    expect(html).toContain('glass-canvas-layer')
  })

  it('有壁纸时图片层（cover + 居中）与遮罩层齐全', () => {
    backgroundMock.bgUrl = 'blob:fake-url'
    const html = render()
    expect(html).toContain('background-image:url(&quot;blob:fake-url&quot;)')
    expect(html).toContain('bg-cover')
    expect(html).toContain('glass-bg-dim')
  })

  it('画布玻璃层受 canvasGlass 开关控制：关闭后不渲染（低端设备退路）', () => {
    backgroundMock.canvasGlass = false
    const html = render()
    expect(html).not.toContain('glass-canvas-layer')
  })

  it('层级口径：玻璃层 -z-10 在壁纸层 -z-20 之上（毛玻璃覆盖在背景之上）', () => {
    backgroundMock.bgUrl = 'blob:fake-url'
    const html = render()
    expect(html).toContain('-z-10')
    expect(html).toContain('-z-20')
  })

  it('背景不拦截指针事件（画布拖拽不能被壁纸吃掉）', () => {
    backgroundMock.bgUrl = 'blob:fake-url'
    expect(render()).toContain('pointer-events-none')
  })
})
