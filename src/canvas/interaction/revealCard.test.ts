// ============================================================================
// 模块说明（中文）
// revealCard.ts 单测：键盘上方安全区的平移量、越界方向、退化输入与订阅胶水。
// 环境为 node（无 jsdom），因此一律用注入的 fake controller / fake visualViewport。
// ============================================================================

import { describe, expect, it, vi } from 'vitest'

import { onVisualViewportResize, panToReveal, revealCard } from './revealCard'
import type { RevealController } from './revealCard'

const SIZE = { width: 400, height: 800 }
/**
 * 默认安全区（margin 16、ratio 0.55）：
 *   x ∈ [16, 16 + (400 - 32) = 384]
 *   y ∈ [16, 16 + (800 × 0.55 - 32) = 424]   ← 键盘上沿再留 16 余量
 * 下面的期望值都按「可用高 408、底界 424」手算，改动时一起核对。
 */

describe('panToReveal：键盘上方安全区', () => {
  it('卡片已在安全区内 → null（画面不该为了编辑而抖动）', () => {
    expect(
      panToReveal(
        { zoom: 1, offsetX: 0, offsetY: 0 },
        SIZE,
        { x: 40, y: 60, w: 120, h: 80 },
      ),
    ).toBeNull()
  })

  it('卡片落在键盘区（下半屏）→ 向上平移，抬进安全区', () => {
    const delta = panToReveal(
      { zoom: 1, offsetX: 0, offsetY: 0 },
      SIZE,
      { x: 40, y: 600, w: 120, h: 80 },
    )
    expect(delta).not.toBeNull()
    // 期望顶边 = 16 + (408 - 80) / 2 = 180 → dy = 180 - 600 = -420
    expect(delta?.dy).toBeCloseTo(-420, 6)
    expect(delta?.dx).toBe(0)
  })

  it('卡片比安全区还高 → 顶部对齐而不是居中（正文从键盘上方开始读）', () => {
    const delta = panToReveal(
      { zoom: 1, offsetX: 0, offsetY: 0 },
      SIZE,
      { x: 40, y: 600, w: 120, h: 900 },
    )
    expect(delta?.dy).toBeCloseTo(16 - 600, 6)
  })

  it('横向越右界 → 按越界量拉回，不做居中', () => {
    const delta = panToReveal(
      { zoom: 1, offsetX: 0, offsetY: 0 },
      SIZE,
      { x: 300, y: 60, w: 200, h: 80 },
    )
    expect(delta?.dx).toBeCloseTo(384 - 500, 6)
    expect(delta?.dy).toBe(0)
  })

  it('横向越左界（负坐标）→ 拉到 margin', () => {
    const delta = panToReveal(
      { zoom: 1, offsetX: 0, offsetY: 0 },
      SIZE,
      { x: -260, y: 60, w: 200, h: 80 },
    )
    expect(delta?.dx).toBeCloseTo(16 - -260, 6)
  })

  it('缩放参与换算：画布坐标要先乘 zoom', () => {
    // 卡片在画布 (0,0) 尺寸 100×100，zoom 2 → 容器里 200×200；offsetY 500 → 明显在键盘下
    const delta = panToReveal({ zoom: 2, offsetX: 0, offsetY: 500 }, SIZE, {
      x: 0,
      y: 0,
      w: 100,
      h: 100,
    })
    // 期望顶边 = 16 + (408 - 200) / 2 = 120 → dy = 120 - 500 = -380
    expect(delta?.dy).toBeCloseTo(-380, 6)
  })

  it('offset 生效：已经偏上的卡片不需要再动', () => {
    expect(
      panToReveal({ zoom: 1, offsetX: 0, offsetY: -560 }, SIZE, { x: 40, y: 600, w: 120, h: 80 }),
    ).toBeNull()
  })

  it('容器尺寸非法（未布局 / 分屏到零宽）→ null，不产生 NaN 平移', () => {
    expect(panToReveal({ zoom: 1, offsetX: 0, offsetY: 0 }, { width: 0, height: 0 }, { x: 0, y: 0, w: 10, h: 10 })).toBeNull()
    expect(
      panToReveal({ zoom: 1, offsetX: 0, offsetY: 0 }, { width: 20, height: 20 }, { x: 0, y: 0, w: 10, h: 10 }),
    ).toBeNull()
  })

  it('zoom 为 0（异常视口）按 1 处理而不是除零', () => {
    const delta = panToReveal({ zoom: 0, offsetX: 0, offsetY: 0 }, SIZE, {
      x: 40,
      y: 600,
      w: 120,
      h: 80,
    })
    expect(delta?.dy).toBeCloseTo(-420, 6)
  })

  it('margin / safeHeightRatio 可注入（真机手感调参的口）', () => {
    const delta = panToReveal(
      { zoom: 1, offsetX: 0, offsetY: 0 },
      SIZE,
      { x: 40, y: 600, w: 120, h: 80 },
      { safeHeightRatio: 0.9, marginPx: 4 },
    )
    // 安全区 y ∈ [4, 800*0.9-4=716]，卡片 600..680 已在区内 → 不用动
    expect(delta).toBeNull()
  })
})

describe('revealCard：读到视口并写入平移', () => {
  const fakeController = (
    state = { zoom: 1, offsetX: 0, offsetY: 0 },
    size = SIZE,
  ): RevealController & { panBy: ReturnType<typeof vi.fn> } => ({
    getState: () => state,
    getViewportSize: () => size,
    panBy: vi.fn(),
  })

  it('越界时按算好的增量平移，并返回 true', () => {
    const controller = fakeController()
    const moved = revealCard(controller, { x: 40, y: 600, w: 120, h: 80 })
    expect(moved).toBe(true)
    expect(controller.panBy).toHaveBeenCalledWith(0, expect.closeTo(-420, 6))
  })

  it('已在安全区内：不平移、返回 false（不产生无谓的 transform 写入）', () => {
    const controller = fakeController()
    expect(revealCard(controller, { x: 40, y: 60, w: 120, h: 80 })).toBe(false)
    expect(controller.panBy).not.toHaveBeenCalled()
  })

  it('控制器或卡片缺失 → false（切空间途中退出编辑的兜底）', () => {
    expect(revealCard(null, { x: 0, y: 0, w: 10, h: 10 })).toBe(false)
    expect(revealCard(fakeController(), undefined)).toBe(false)
  })
})

describe('onVisualViewportResize：键盘弹出后再让一次位', () => {
  it('订阅 resize 并在退订时移除', () => {
    const handlers: Record<string, () => void> = {}
    const target = {
      addEventListener: vi.fn((type: string, listener: () => void) => {
        handlers[type] = listener
      }),
      removeEventListener: vi.fn((type: string) => {
        delete handlers[type]
      }),
    }
    const onResize = vi.fn()
    const unsubscribe = onVisualViewportResize(target, onResize)

    handlers.resize?.()
    expect(onResize).toHaveBeenCalledTimes(1)

    unsubscribe()
    expect(target.removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(handlers.resize).toBeUndefined()
    handlers.resize?.()
    expect(onResize).toHaveBeenCalledTimes(1)
  })

  it('没有 visualViewport（老 WebView / node）→ 空实现，不抛错', () => {
    const unsubscribe = onVisualViewportResize(null, vi.fn())
    expect(() => unsubscribe()).not.toThrow()
  })
})
