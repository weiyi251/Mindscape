// ============================================================================
// 模块说明（中文）
// 壁纸垫底层可见性守卫（2026-10-02 用户实测踩坑后的防回归）。
//
// 坑：appearance-background 的壁纸层是 `fixed inset-0 -z-10`。按 CSS 绘制顺序，
// body 的背景画在负 z 定位元素**之后**（即盖在上面）—— body 一旦有不透明背景
// （如 `@apply bg-background`），壁纸就被完全盖住，表现为「上传了壁纸但中间
// 看不到」。底色必须放 html（根元素背景画在最底，负 z 层在其上可见）。
//
// 本守卫直接读 globals.css 源码断言两件事：
//   1. body 规则块透明（壁纸可见的前提）；
//   2. html 规则块带主题底色（壁纸之下 / 无壁纸时的兜底）。
// ============================================================================

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const cssPath = join(dirname(fileURLToPath(import.meta.url)), '../styles/globals.css')
const css = readFileSync(cssPath, 'utf8')

describe('壁纸垫底层可见性（CSS 层叠守卫）', () => {
  it('body 规则块必须透明：不得含 bg-background 或不透明背景色', () => {
    const bodyBlock = css.match(/html > body \{[\s\S]*?\n {2}\}/)
    expect(bodyBlock).not.toBeNull()
    expect(bodyBlock![0]).toContain('transparent')
    expect(bodyBlock![0]).not.toContain('bg-background')
  })

  it('html 规则块带 bg-background（壁纸之下的主题底色兜底）', () => {
    const htmlBlock = css.match(/\n {2}html \{[\s\S]*?\n {2}\}/)
    expect(htmlBlock).not.toBeNull()
    expect(htmlBlock![0]).toContain('bg-background')
  })

  it('画布玻璃层存在且含模糊（毛玻璃覆盖在背景之上；背衬是静态壁纸，性能安全）', () => {
    expect(css).toContain('.glass-canvas-layer')
    const layerBlock = css.match(/\.glass-canvas-layer \{[\s\S]*?\n {2}\}/)
    expect(layerBlock).not.toBeNull()
    expect(layerBlock![0]).toContain('backdrop-filter: blur(var(--glass-blur))')
    expect(layerBlock![0]).toContain('--glass-canvas-alpha')
  })
})
