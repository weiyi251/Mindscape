// ============================================================================
// 模块说明（中文）
// canvasOverlayText（画布浮层文案表）的单元测试：
// 这里锁的不是「字符串等于什么」，而是两条跨端约束 ——
//   1. 桌面提示必须出现快捷键，触屏提示必须不出现（触屏没有 Ctrl 可教）；
//   2. 移动端按钮标签必须短，否则 44px 点按区在窄屏上会挤成两行。
// 改文案的人只要违反其中一条，这条测试就会红。
// ============================================================================

import { describe, expect, it } from 'vitest'

import { CANVAS_OVERLAY_TEXT, CANVAS_TOUCH_TOOLBAR_TEXT } from './canvasOverlayText'

describe('CANVAS_OVERLAY_TEXT（状态条与桌面按钮）', () => {
  it('桌面提示带快捷键，触屏提示一个都不带', () => {
    expect(CANVAS_OVERLAY_TEXT.desktopHint).toContain('Ctrl')
    expect(CANVAS_OVERLAY_TEXT.touchHint).not.toContain('Ctrl')
  })

  it('触屏提示把 M2 的四个手势都念到（捏合 / 平移 / 长按 / 框选）', () => {
    for (const keyword of ['捏合', '平移', '长按', '框选']) {
      expect(CANVAS_OVERLAY_TEXT.touchHint).toContain(keyword)
    }
  })

  it('桌面按钮标签保留快捷键说明（与键盘口径同一份真相）', () => {
    expect(CANVAS_OVERLAY_TEXT.desktopFit).toContain('Ctrl+Alt+0')
    expect(CANVAS_OVERLAY_TEXT.desktopReset).toContain('Ctrl+0')
  })
})

describe('CANVAS_TOUCH_TOOLBAR_TEXT（移动端兜底按钮）', () => {
  it('标签都够短：两个汉字级别的长度，不占满一行', () => {
    for (const [name, label] of Object.entries(CANVAS_TOUCH_TOOLBAR_TEXT)) {
      expect(label.length, name).toBeLessThanOrEqual(4)
    }
  })

  it('开 / 关两种「框选」态共用同一个词根，避免按钮文案跳字', () => {
    expect(CANVAS_TOUCH_TOOLBAR_TEXT.selectOn).toContain(CANVAS_TOUCH_TOOLBAR_TEXT.select)
    expect(CANVAS_TOUCH_TOOLBAR_TEXT.selectOn).not.toBe(CANVAS_TOUCH_TOOLBAR_TEXT.select)
  })
})
