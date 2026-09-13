// ============================================================================
// 模块说明（中文）
// zoomKeys 的单测：核心回归点是「Shift 按下时 event.key 是上档字符 ')'」——
// 旧实现用 key === '0' 判断导致 Ctrl+Shift+0 永远不生效（2026-09-13 用户反馈），
// 修复后以 event.code（物理键位）为准。
// ============================================================================
import { describe, expect, it } from 'vitest'

import { isResetViewShortcut, isZeroKey, isZoomToFitShortcut } from './zoomKeys'

describe('isZeroKey（物理键位判断数字 0）', () => {
  it('Shift 按下时 key 变为上档字符 ")"，仍靠 code=Digit0 命中（回归：Ctrl+Shift+0 失效）', () => {
    expect(isZeroKey({ key: ')', code: 'Digit0', ctrlKey: true, shiftKey: true, altKey: false })).toBe(true)
  })

  it('小键盘 0（code=Numpad0，key 为 "0"）命中', () => {
    expect(isZeroKey({ key: '0', code: 'Numpad0', ctrlKey: true, shiftKey: false, altKey: false })).toBe(true)
  })

  it('非 0 键不命中', () => {
    expect(isZeroKey({ key: '1', code: 'Digit1', ctrlKey: true, shiftKey: true, altKey: false })).toBe(false)
    expect(isZeroKey({ key: 'a', code: 'KeyA', ctrlKey: true, shiftKey: false, altKey: false })).toBe(false)
  })

  it('key 兜底：code 缺失（非标准布局）但 key 为 "0" 时命中', () => {
    expect(isZeroKey({ key: '0', code: '', ctrlKey: true, shiftKey: false, altKey: false })).toBe(true)
  })
})

describe('isZoomToFitShortcut（适应内容）', () => {
  it('Ctrl+Alt+Digit0 命中（主组合键）', () => {
    expect(isZoomToFitShortcut({ key: '0', code: 'Digit0', ctrlKey: true, shiftKey: false, altKey: true })).toBe(true)
  })

  it('Ctrl+Alt+Numpad0 命中（主组合键·小键盘）', () => {
    expect(isZoomToFitShortcut({ key: '0', code: 'Numpad0', ctrlKey: true, shiftKey: false, altKey: true })).toBe(true)
  })

  it('Ctrl+Shift+Digit0 命中（兼容旧组合键，key 为上档字符 ")" 也必须命中）', () => {
    expect(isZoomToFitShortcut({ key: ')', code: 'Digit0', ctrlKey: true, shiftKey: true, altKey: false })).toBe(true)
  })

  it('Ctrl+Shift+Numpad0 命中（兼容旧组合键）', () => {
    expect(isZoomToFitShortcut({ key: '0', code: 'Numpad0', ctrlKey: true, shiftKey: true, altKey: false })).toBe(true)
  })

  it('缺 Shift / 缺 Alt（Ctrl+0）不命中 —— 否则抢占复原视图', () => {
    expect(isZoomToFitShortcut({ key: '0', code: 'Digit0', ctrlKey: true, shiftKey: false, altKey: false })).toBe(false)
  })

  it('缺 Ctrl 不命中', () => {
    expect(isZoomToFitShortcut({ key: ')', code: 'Digit0', ctrlKey: false, shiftKey: true, altKey: false })).toBe(false)
  })

  it('Alt+0（无 Ctrl）不命中', () => {
    expect(isZoomToFitShortcut({ key: '0', code: 'Digit0', ctrlKey: false, shiftKey: false, altKey: true })).toBe(false)
  })
})

describe('isResetViewShortcut（Ctrl+0 复原视图）', () => {
  it('Ctrl+Digit0（无 Shift / Alt）命中', () => {
    expect(isResetViewShortcut({ key: '0', code: 'Digit0', ctrlKey: true, shiftKey: false, altKey: false })).toBe(true)
  })

  it('带 Shift 时不命中（否则抢占适应内容）', () => {
    expect(isResetViewShortcut({ key: ')', code: 'Digit0', ctrlKey: true, shiftKey: true, altKey: false })).toBe(false)
  })

  it('带 Alt 时不命中（否则抢占适应内容）', () => {
    expect(isResetViewShortcut({ key: '0', code: 'Digit0', ctrlKey: true, shiftKey: false, altKey: true })).toBe(false)
  })
})
