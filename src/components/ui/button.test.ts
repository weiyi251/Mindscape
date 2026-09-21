// ============================================================================
// 模块说明（中文）
// 按钮尺寸档的单测（2026-09-21 移动端适配 M3）。
//
// 锁两条跨端约束（不是「字符串等于什么」）：
//   1. **紧凑档（视口宽 < 640，即 COMPACT_VIEWPORT_WIDTH）下每档按钮都够 44px**，
//      手指才点得到 —— 移动端所有页面共用这一套按钮，逐个组件补不如在源头补；
//   2. **不带修饰符的桌面类不许变**（红线 R2 桌面零回归）：触屏的加大一律走
//      `max-sm:` 前缀，桌面窗口里高度仍是原来的 h-9 / h-8 / h-10。
// 44px 是 M2 右下角工具条（CanvasTouchToolbar）用的同一个门槛。
// ============================================================================

import { describe, expect, it } from 'vitest'

import { buttonVariants } from './button'

/** 拇指可点的最小边长（px） */
const TOUCH_TARGET_PX = 44

const SIZES = ['default', 'sm', 'lg', 'icon'] as const

/** Tailwind 数字刻度 → px（h-11 = 2.75rem = 44px）；不是高度类则返回 null */
function heightOf(token: string): number | null {
  const match = /^(?:min-)?h-(\d+)$/.exec(token)
  return match ? Number(match[1]) * 4 : null
}

function classes(size: (typeof SIZES)[number]): string[] {
  return (buttonVariants({ size }) ?? '').split(/\s+/).filter(Boolean)
}

/** 某档在「桌面（无修饰符）」与「紧凑档（max-sm:）」下的最大高度 */
function heights(size: (typeof SIZES)[number]): { desktop: number; compact: number } {
  let desktop = 0
  let compact = 0
  for (const token of classes(size)) {
    if (token.startsWith('max-sm:')) {
      compact = Math.max(compact, heightOf(token.slice('max-sm:'.length)) ?? 0)
    } else if (!token.includes(':')) {
      desktop = Math.max(desktop, heightOf(token) ?? 0)
    }
  }
  // 紧凑档只写增量：没写 max-sm:h-* 的档沿用桌面高度
  return { desktop, compact: Math.max(desktop, compact) }
}

describe('按钮尺寸档（M3 触屏点按区）', () => {
  it('紧凑档每一档都至少 44px 高（手指点得到）', () => {
    for (const size of SIZES) {
      expect(heights(size).compact, size).toBeGreaterThanOrEqual(TOUCH_TARGET_PX)
    }
  })

  it('桌面高度一字不变（加大只发生在 max-sm: 里，红线 R2）', () => {
    expect(heights('default').desktop).toBe(36)
    expect(heights('sm').desktop).toBe(32)
    expect(heights('lg').desktop).toBe(40)
    expect(heights('icon').desktop).toBe(36)
  })

  it('图标档在紧凑档连宽度一起给到 44px（否则只有高，仍是细条）', () => {
    const tokens = classes('icon')
    expect(tokens).toContain('max-sm:h-11')
    expect(tokens).toContain('max-sm:w-11')
    expect(tokens).toContain('h-9')
    expect(tokens).toContain('w-9')
  })

  it('触屏加大全部走 max-sm: 前缀（不允许出现裸的 h-11 / w-11）', () => {
    for (const size of SIZES) {
      for (const token of classes(size)) {
        if (/^(?:min-)?[hw]-(?:1[1-9]|[2-9]\d)$/.test(token)) {
          expect.fail(`${size} 档出现裸的 ${token}：桌面外观会被一起改掉`)
        }
      }
    }
  })
})
