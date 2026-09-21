// ============================================================================
// 模块说明（中文）
// 安全区（safe-area）守卫 —— 锁住「viewport-fit=cover」与「该读 env() 的两处都读了」。
// 对应移动端真机第一轮（2026-09-21）：顶栏整条钻到安卓状态栏底下。
//
// 为什么两条必须一起看：targetSdk 35+ 起安卓强制 edge-to-edge，WebView 铺满整屏，
// 系统不再让出顶部那一条。修法只在 CSS：把 #root 的内边距交给 env(safe-area-inset-*)。
// 但 WebView 只有在视口声明 `viewport-fit=cover` 之后才会给出非 0 的 env()，
// 所以这两处**任删其一都等于没修**，而且删掉的那一处在另一处看起来完全正常 ——
// 只能靠静态断言钉住。
//
// 环境：node（不引 jsdom），读文本做静态检查。
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT_DIR = fileURLToPath(new URL('../..', import.meta.url))

/** 取 `<meta name="viewport">` 的 content 值（整段可能被注释文案提到多次） */
function viewportContent(): string {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8')
  const meta = html.match(/<meta\s+name="viewport"[^>]*content="([^"]*)"/)
  return meta?.[1] ?? ''
}

function globalsCss(): string {
  return fs.readFileSync(path.join(ROOT_DIR, 'src/styles/globals.css'), 'utf8')
}

/** `#root` 的**安全区那条**规则（另一条 `html, body, #root { height }` 不算） */
function rootPaddingRule(css: string): string {
  return css.match(/#root\s*\{[^}]*\bpadding[^}]*\}/)?.[0] ?? ''
}

describe('安全区留白（安卓 edge-to-edge）', () => {
  it('viewport 声明 viewport-fit=cover，否则 env() 恒为 0', () => {
    expect(viewportContent()).toContain('viewport-fit=cover')
  })

  it('#root 把上下左右四条边都交给 env(safe-area-inset-*)', () => {
    const rule = rootPaddingRule(globalsCss())
    expect(rule, '#root 的 padding 规则被删了').not.toBe('')
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      expect(rule, `#root 少了 ${side} 的安全区`).toContain(`env(safe-area-inset-${side})`)
    }
  })

  it('全局样式用 height: 100% 而不是 100vh 撑高度（vh 按整屏算，#root 的内边距只会把它下移、底部被裁）', () => {
    const css = globalsCss()
    expect(css).not.toMatch(/height:\s*100vh/)
    expect(css).toMatch(/html,\s*body,\s*#root\s*\{\s*height:\s*100%/s)
  })

  // `position: fixed` 按视口定位，#root 的内边距管不到它 —— 真机第一轮「设置面板的 ✕
  // 压在状态栏底下点不到」就是这么来的。整屏浮窗必须自己让一次。
  it('整屏浮窗（fixed）另有一条安全区规则，且靠 data-compact 触发', () => {
    const rule =
      globalsCss().match(/\[data-floating-modal\]\[data-compact='true'\]\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rule, 'fixed 定位的整屏浮窗没有让安全区').not.toBe('')
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      expect(rule, `浮窗少了 ${side} 的安全区`).toContain(`env(safe-area-inset-${side})`)
    }
    // 属性得真的写在上，否则上面那条规则永远不命中
    const tsx = fs.readFileSync(
      path.join(ROOT_DIR, 'src/components/ui/floating-modal.tsx'),
      'utf8',
    )
    expect(tsx).toContain("data-compact={compact ? 'true' : 'false'}")
  })
})
