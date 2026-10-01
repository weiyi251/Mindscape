// ============================================================================
// 模块说明（中文）
// appearance-background 的单元测试（node 环境，renderToStaticMarkup）。
// store 替身化（node 里没有 Tauri 读盘），锁三件事：
//   无壁纸时不渲染任何图层（与改造前观感一致）、
//   有壁纸时图片与遮罩层齐全、
//   遮罩颜色走 CSS 变量类（组件里不出现颜色字面量，architecture 规则 3）。
// ============================================================================

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { AppearanceBackground } from './appearance-background'

/** store 替身：bgUrl 由用例改写（vi.mock 工厂提升，经可变对象间接传值） */
const backgroundMock = { bgUrl: null as string | null }

vi.mock('@/core/appearance/appearanceStore', () => ({
  useAppearanceStore: (selector: (state: { bgUrl: string | null }) => unknown) =>
    selector({ bgUrl: backgroundMock.bgUrl }),
}))

const render = () => renderToStaticMarkup(<AppearanceBackground />)

describe('AppearanceBackground 背景图层', () => {
  it('无壁纸时整层为空（body 底色即最终观感，零回归）', () => {
    backgroundMock.bgUrl = null
    const html = render()
    expect(html).not.toContain('background-image')
    expect(html).not.toContain('glass-bg-dim')
  })

  it('有壁纸时图片层（cover + 居中）与遮罩层齐全', () => {
    backgroundMock.bgUrl = 'blob:fake-url'
    const html = render()
    expect(html).toContain('background-image:url(&quot;blob:fake-url&quot;)')
    expect(html).toContain('bg-cover')
    expect(html).toContain('glass-bg-dim')
  })

  it('壁纸层不拦截指针事件（画布拖拽不能被壁纸吃掉）', () => {
    backgroundMock.bgUrl = 'blob:fake-url'
    expect(render()).toContain('pointer-events-none')
  })
})
