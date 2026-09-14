// ============================================================================
// 模块说明（中文）
// 图片卡「实际分辨率」徽章逻辑（imageResolution.ts）的单元测试。
//
// 分两类：
//   · 纯函数 —— 格式化（正整数才可展示）逐例钉死；
//   · DOM 胶水 —— 用手写的假对象（记录 classList 调用与文本写入）覆盖
//     「写入 / 空文本不写 / 找不到徽章静默 / load / error 事件」。
//     不引 jsdom（用户裁决），胶水依赖的接口窄到假对象足够仿真。
// ============================================================================

import { describe, expect, it, vi } from 'vitest'

import {
  IMAGE_RESOLUTION_BADGE_ATTR,
  IMAGE_RESOLUTION_HIDDEN_CLASS,
  IMAGE_RESOLUTION_UNAVAILABLE,
  formatImageResolution,
  handleImageError,
  handleImageLoad,
  writeImageResolutionBadge,
} from './imageResolution'
import type { ResolutionBadgeElement, ResolutionHostElement } from './imageResolution'

/** 假徽章 + 假宿主：记录 remove/add 的类名与写入的文本 */
function makeHostWithBadge(): {
  host: ResolutionHostElement
  badge: ResolutionBadgeElement
  removed: string[]
} {
  const removed: string[] = []
  const badge: ResolutionBadgeElement = {
    textContent: '',
    classList: {
      add: vi.fn(),
      remove: (name: string) => {
        removed.push(name)
      },
    },
  }
  const host: ResolutionHostElement = {
    querySelector: <E extends ResolutionBadgeElement>(selectors: string) =>
      selectors === `[${IMAGE_RESOLUTION_BADGE_ATTR}]` ? (badge as unknown as E) : null,
  }
  return { host, badge, removed }
}

describe('formatImageResolution', () => {
  it('正整数输出「宽 × 高」', () => {
    expect(formatImageResolution(1920, 1080)).toBe('1920 × 1080')
    expect(formatImageResolution(1, 1)).toBe('1 × 1')
    expect(formatImageResolution(4096, 2304)).toBe('4096 × 2304')
  })

  it('零 / 负数 / 小数 / 非有限值都不可展示（= 尺寸还没读到）', () => {
    expect(formatImageResolution(0, 100)).toBeNull()
    expect(formatImageResolution(100, -1)).toBeNull()
    expect(formatImageResolution(100.5, 100)).toBeNull()
    expect(formatImageResolution(100, Number.NaN)).toBeNull()
    expect(formatImageResolution(Number.POSITIVE_INFINITY, 100)).toBeNull()
  })
})

describe('writeImageResolutionBadge', () => {
  it('写文本并取消 hidden', () => {
    const { host, badge, removed } = makeHostWithBadge()

    writeImageResolutionBadge(host, '1920 × 1080')

    expect(badge.textContent).toBe('1920 × 1080')
    expect(removed).toEqual([IMAGE_RESOLUTION_HIDDEN_CLASS])
  })

  it('宿主为 null / 文本为 null / 空串 → 什么都不动（图片还没加载好时保持隐藏）', () => {
    expect(() => writeImageResolutionBadge(null, '1 × 1')).not.toThrow()

    for (const text of [null, '']) {
      const { host, badge, removed } = makeHostWithBadge()
      writeImageResolutionBadge(host, text)
      expect(badge.textContent).toBe('')
      expect(removed).toEqual([])
    }
  })

  it('找不到徽章元素时静默跳过，不抛错', () => {
    const emptyHost: ResolutionHostElement = { querySelector: () => null }
    expect(() => writeImageResolutionBadge(emptyHost, '1 × 1')).not.toThrow()
  })
})

describe('事件处理器', () => {
  /** 造假事件：currentTarget 是带 naturalWidth/Height 与 closest 的假 img */
  function makeEvent(size: { w: number; h: number } | null) {
    const { host, badge, removed } = makeHostWithBadge()
    const img = {
      naturalWidth: size?.w ?? 0,
      naturalHeight: size?.h ?? 0,
      // 仿真 DOM 层级：img → shell（data-card-id）→ 卡片根（徽章在这里）
      closest: (selectors: string) =>
        selectors === '[data-card-id]' ? { parentElement: host } : null,
    }
    return { event: { currentTarget: img as unknown as Element }, badge, removed }
  }

  it('load：把 naturalWidth/Height 写成「宽 × 高」并取消隐藏', () => {
    const { event, badge, removed } = makeEvent({ w: 3840, h: 2160 })

    handleImageLoad(event)

    expect(badge.textContent).toBe('3840 × 2160')
    expect(removed).toContain(IMAGE_RESOLUTION_HIDDEN_CLASS)
  })

  it('load：natural 尺寸无效（未加载 / 加载失败后的 0）→ 徽章保持隐藏', () => {
    const { event, badge, removed } = makeEvent(null)

    handleImageLoad(event)

    expect(badge.textContent).toBe('')
    expect(removed).toEqual([])
  })

  it('error：显示「尺寸不可读」，不留永远空着的标签', () => {
    const { event, badge, removed } = makeEvent(null)

    handleImageError(event)

    expect(badge.textContent).toBe(IMAGE_RESOLUTION_UNAVAILABLE)
    expect(removed).toContain(IMAGE_RESOLUTION_HIDDEN_CLASS)
  })
})
