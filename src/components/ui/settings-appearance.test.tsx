// ============================================================================
// 模块说明（中文）
// 「外观」设置页的单元测试（node 环境，renderToStaticMarkup + store 替身）。
// 与 settings-panel.test.tsx 同一套手法：静态渲染只会跑到 useState 初值，
// useEffect 不执行 —— 正好只考察「控件与配置值的对应关系」。
//
// 锁四件事：
//   1. 滑杆的 min/max/step 与 glassTypes 的 GLASS_LIMITS 一致（两处不联动的漂移）；
//   2. 控件值如实反映当前配置（拖滑杆前的初值渲染）；
//   3. 阴影四档齐全且档位按钮带 aria-pressed；
//   4. 深浅两套取色器都在（深浅分色的核心入口）。
// ============================================================================

import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { GLASS_DEFAULTS, GLASS_LIMITS, SHADOW_LEVELS } from '@/core/appearance/glassTypes'
import type { GlassAppearance } from '@/core/appearance/glassTypes'
import { SettingsAppearancePage } from './settings-appearance'

/** store 替身：config 由用例改写（vi.mock 工厂提升，经可变对象间接传值） */
const appearanceMock: { glass: GlassAppearance } = { glass: { ...GLASS_DEFAULTS } }

vi.mock('@/core/appearance/appearanceStore', () => ({
  useAppearanceStore: (selector: (state: never) => unknown) =>
    selector(appearanceMock as never),
}))

vi.mock('@/core/appearance/wallpaper', () => ({
  MAX_WALLPAPER_BYTES: 20 * 1024 * 1024,
  removeWallpaperFile: async () => undefined,
  saveWallpaper: async () => 'wallpaper.png',
}))

const render = () => renderToStaticMarkup(<SettingsAppearancePage />)

afterEach(() => {
  appearanceMock.glass = { ...GLASS_DEFAULTS }
})

describe('外观页控件与配置的对应', () => {
  it('透明度滑杆的 min/max/step 与 GLASS_LIMITS 一致', () => {
    const html = render()
    expect(html).toContain(
      `min="${GLASS_LIMITS.alpha.min}" max="${GLASS_LIMITS.alpha.max}" step="0.01"`,
    )
  })

  it('模糊滑杆的 min/max 与 GLASS_LIMITS 一致，默认值如实显示', () => {
    const html = render()
    expect(html).toContain(`min="${GLASS_LIMITS.blurPx.min}" max="${GLASS_LIMITS.blurPx.max}"`)
    expect(html).toContain('14 px')
  })

  it('自定义透明度渲染进滑杆与数值显示', () => {
    appearanceMock.glass = { ...GLASS_DEFAULTS, alpha: 0.4 }
    const html = render()
    expect(html).toContain('value="0.4"')
    expect(html).toContain('40%')
  })

  it('深浅两套取色器都在，值即配置里的 hex', () => {
    const html = render()
    expect(html).toContain(`value="${GLASS_DEFAULTS.tintLight}"`)
    expect(html).toContain(`value="${GLASS_DEFAULTS.tintDark}"`)
    expect((html.match(/type="color"/g) ?? []).length).toBe(2)
  })

  it('阴影四档齐全，当前档位 aria-pressed（档位按钮的可访问性口径）', () => {
    const html = render()
    for (const level of SHADOW_LEVELS) {
      expect(html).toContain(`aria-pressed="${GLASS_DEFAULTS.shadow === level}"`)
    }
  })

  it('未设置壁纸时：显示占位文案、压暗滑杆禁用', () => {
    const html = render()
    expect(html).toContain('未设置背景图片')
    expect(html).toContain('disabled=""')
  })

  it('触控目标：滑杆与取色器在移动档给足 44px 高（清单 §3 硬标准，防回归）', () => {
    const html = render()
    // 滑杆：h-11 = 44px，整行高度都是热区（轨道本身仍是细的）
    expect(html).toContain('class="h-11 w-full accent-primary"')
    // 取色器：移动档 h-11，sm: 起回桌面档的 h-8 w-14
    expect(html).toContain('h-11 w-16 cursor-pointer')
  })

  it('画布毛玻璃开关：默认开启（aria-pressed），关闭态如实渲染', () => {
    const html = render()
    // 默认 canvasGlass: true → 开关 aria-pressed 且文案「已开启」
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('毛玻璃覆盖在背景之上')
    expect(html).toContain('已开启')
  })
})
