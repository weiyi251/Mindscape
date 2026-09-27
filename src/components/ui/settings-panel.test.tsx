// ============================================================================
// 模块说明（中文）
// 设置面板的两条布局规则（2026-09-28 移动端第三轮：「不要让文字贴在顶部，不要太满」）。
//
// 环境仍是 node（不引 jsdom）：`renderToStaticMarkup` 只会跑到 useState 的初始函数，
// 静态渲染里 useEffect 根本不执行 —— 组件里的副作用（插件 store 的读取等）不会触发，
// 因此用两个**假页面**替换掉真实页面表，只考察布局本身。
//
// 锁两件事：
//   1. 只有一张可见页时**整条导航都不渲染** —— 手机上它是一条几十像素高、
//      只能点一个按钮的横条，是「太满」里最容易去掉的一块。
//   2. 有多张页时导航照旧（桌面左右分栏依赖它，红线 R2）。
// ============================================================================

import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { SettingsPanel } from './settings-panel'

// 真实页表会拖进插件 store 等一堆副作用，这里整表替身掉：
// 本文件只考察「导航该不该渲染」，与页面内容无关。
// 工厂够不着测试里的 let 变量（vi.mock 会被提升到 import 之前），
// 故经 `settingsPanelMock.pages` 这一个可变对象间接传值。
vi.mock('./settingsPages', () => ({
  SETTINGS_PAGES: [{ id: 'a', label: '甲', Component: () => <span>甲</span> }],
  visibleSettingsPages: () => settingsPanelMock.pages,
}))

export const settingsPanelMock = {
  pages: [{ id: 'a', label: '甲', Component: () => <span>甲</span> }],
}

/** FloatingModal 初算矩形要用 window.innerWidth/innerHeight，给最小替身 */
function withWindow(render: () => string): string {
  ;(globalThis as { window?: unknown }).window = { innerWidth: 1280, innerHeight: 800 }
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
  }
}

const markup = () => withWindow(() => renderToStaticMarkup(<SettingsPanel open onClose={() => {}} />))

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

describe('设置面板导航（多页才渲染）', () => {
  it('只有一张可见页时整条导航都不渲染（手机上省掉一条横条）', () => {
    settingsPanelMock.pages = [{ id: 'a', label: '甲', Component: () => <span>甲</span> }]
    const html = markup()
    expect(html).not.toContain('<nav')
    expect(html).toContain('甲')
  })

  it('有两张以上可见页时导航照旧出现（桌面左右分栏）', () => {
    const single = settingsPanelMock.pages
    settingsPanelMock.pages = [...single, { id: 'b', label: '乙', Component: () => <span>乙</span> }]
    try {
      const html = markup()
      expect(html).toContain('<nav')
      expect(html).toContain('甲')
      expect(html).toContain('乙')
    } finally {
      settingsPanelMock.pages = single
    }
  })
})
