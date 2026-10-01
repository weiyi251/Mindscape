// ============================================================================
// 模块说明（中文）
// SpaceList 响应式留白守卫（2026-10-01 用户反馈「手机端空间卡片太靠右」）。
//
// 根因：`<main>` 只有桌面档 `px-8 py-6`，而顶栏是 `px-4 sm:px-8` —— 手机上
// 顶栏文字离屏 16px、空间卡片离屏 32px，两套缩进并存，卡片整体比标题缩进一截，
// 看起来「靠右」。修复后 main 与顶栏同款：移动档 px-4 py-4、sm: 起回桌面值。
//
// 这里直接对源码做 class 字面量断言（与 safe-area.test.ts 锁 globals.css 同思路）：
// 渲染 SpaceList 要 mock 一整条 Tauri 依赖链，成本远超收益；要锁的只是 class 串。
// ============================================================================

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'SpaceList.tsx'), 'utf8')

/** 取 <main> 的 className 字面量并拆成 token（ Tailwind class 一枚一项） */
function mainClassTokens(): string[] {
  const matched = /<main className="([^"]*)"/.exec(source)
  expect(matched, 'SpaceList.tsx 里应存在 <main className="…">').toBeTruthy()
  return matched![1].split(/\s+/).filter(Boolean)
}

describe('SpaceList 主区留白分档（手机偏右回归守卫）', () => {
  it('移动档用 px-4 py-4（与顶栏同款缩进）', () => {
    const tokens = mainClassTokens()
    expect(tokens).toContain('px-4')
    expect(tokens).toContain('py-4')
  })

  it('桌面档由 sm: 前缀兜回 px-8 py-6（桌面零回归）', () => {
    const tokens = mainClassTokens()
    expect(tokens).toContain('sm:px-8')
    expect(tokens).toContain('sm:py-6')
  })

  it('不得再出现不带 sm: 前缀的 px-8 / py-6（会把桌面值漏到手机档）', () => {
    const tokens = mainClassTokens()
    expect(tokens).not.toContain('px-8')
    expect(tokens).not.toContain('py-6')
  })
})
