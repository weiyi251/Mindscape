// ============================================================================
// 模块说明（中文）
// FloatingModal 整屏模式的两条跨端约束（真机第一轮：设置面板「太满、✕ 点不到」）。
//
// 环境仍是 node（不引 jsdom）：`renderToStaticMarkup` 只会跑到 useState 的初始函数，
// 而那里需要的全部外部量就是 `window.innerWidth/innerHeight` —— 给一个最小替身即可，
// 效果（useEffect / useLayoutEffect）在静态渲染里根本不执行，不必伪造 DOM。
//
// 锁两件事：
//   1. `data-compact` 必须如实标出来 —— globals.css 里那条
//      `[data-floating-modal][data-compact='true']` 的安全区内边距全靠它触发。
//      窄视口没有它，标题栏（含 ✕）就压在安卓状态栏底下；宽视口带上它，桌面浮窗白让一圈。
//   2. 关闭按钮两档尺寸不得互相串台：触屏整屏档要够拇指按（44px），
//      桌面档保持 20px 的小叉子不变（红线 R2）。
// ============================================================================

import { afterEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { FloatingModal } from './floating-modal'

/** 只喂 FloatingModal 初算矩形用得上的两个量，别的 DOM API 一律不给（缺了会立刻报错） */
function withViewport(width: number, height: number, render: () => string): string {
  const previous = (globalThis as { window?: unknown }).window
  ;(globalThis as { window?: unknown }).window = { innerWidth: width, innerHeight: height }
  // 静态渲染器对 useLayoutEffect 有一句固定唠叨（它不参与输出），每次渲染都刷一屏，
  // 会把真实报错埋掉 —— 只吞这一句，其余原样放行。
  const realError = console.error
  console.error = (...args: unknown[]) => {
    const first = args[0]
    if (typeof first === 'string' && first.includes('useLayoutEffect does nothing')) return
    realError(...(args as []))
  }
  try {
    return render()
  } finally {
    console.error = realError
    if (previous === undefined) delete (globalThis as { window?: unknown }).window
    else (globalThis as { window?: unknown }).window = previous
  }
}

const markup = (width: number, height: number) =>
  withViewport(
    width,
    height,
    () =>
      renderToStaticMarkup(
        <FloatingModal open title="设置" onClose={() => {}}>
          <span>内容</span>
        </FloatingModal>,
      ),
  )

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

describe('FloatingModal（整屏 / 桌面两档）', () => {
  it('窄视口：data-compact=true，安全区那条 CSS 才会命中', () => {
    const html = markup(360, 800)
    expect(html).toContain('data-compact="true"')
    expect(html).toContain('rounded-none')
    // 44px 的拇指 targets（标题栏 h-12 + 关闭按钮 h-11 w-11）
    expect(html).toContain('h-12')
    expect(html).toContain('h-11 w-11')
  })

  it('宽视口：data-compact=false，标题栏仍可拖动、关闭按钮仍是桌面 20px（R2）', () => {
    const html = markup(1280, 800)
    expect(html).toContain('data-compact="false"')
    expect(html).toContain('cursor-move')
    expect(html).toContain('h-5 w-5')
    expect(html).toContain('rounded-lg')
    expect(html).not.toContain('h-11 w-11')
  })

  it('整屏模式不画缩放手柄（铺满视口，没有可缩的空间）', () => {
    expect(markup(360, 800)).not.toContain('data-floating-modal-resize')
    expect(markup(1280, 800)).toContain('data-floating-modal-resize')
  })
})
