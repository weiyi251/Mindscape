// ============================================================================
// 模块说明（中文）
// 连线渲染的源码级反例守卫测试。固化 2026-09-11 两个真实 bug 的教训：
//
//   1. CSS 变量（var(--xxx)）不能写在 SVG 表现属性（stroke=/fill= attribute）里
//      —— 值整段失效 → stroke 回退为 none → 连线/箭头全部隐形。
//      颜色必须经 Tailwind 类（stroke-* / fill-*）承载。
//   2. Tailwind 没有 pointer-events-stroke 工具类（只有 none / auto）
//      —— 类名不存在 → path 继承 svg 根的 pointer-events:none
//      → 连线点不中、双击编辑标签打不开。命中开关必须用内联 style。
//
// 纯读源码断言（vitest node 环境，无需 DOM）。
// ============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const connectionSource = readFileSync(resolve(__dirname, 'Connection.tsx'), 'utf-8')
const canvasSource = readFileSync(resolve(__dirname, 'Canvas.tsx'), 'utf-8')

describe('连线渲染守卫（var() 陷阱 / pointer-events 陷阱）', () => {
  it('SVG 表现属性里禁止出现 var()（颜色必须走类或 style）', () => {
    // stroke="..." / fill="..." 中含 var(-- 即违规（style={{...}} 不受影响）
    const violation = /\b(?:stroke|fill)=["'{][^"'}]*var\(--/
    expect(violation.test(connectionSource)).toBe(false)
    expect(violation.test(canvasSource)).toBe(false)
  })

  it('连线命中开关必须用内联 style 的 pointerEvents: stroke', () => {
    expect(connectionSource).toContain("pointerEvents: 'stroke'")
    // 曾经的错误写法：Tailwind 里不存在的工具类
    expect(connectionSource).not.toContain('pointer-events-stroke')
  })

  it('连线颜色由 Tailwind 类承载（stroke-muted-foreground / stroke-primary 存在）', () => {
    expect(connectionSource).toContain('stroke-muted-foreground')
    expect(connectionSource).toContain('stroke-primary')
    expect(connectionSource).toContain('fill-muted-foreground')
  })
})
