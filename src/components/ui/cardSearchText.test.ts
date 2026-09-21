// ============================================================================
// 模块说明（中文）
// 搜索浮层文案表单测（2026-09-21 移动端适配 M3）。
// 被测点：两套措辞的键位对齐（组件按平台能力表二选一，缺键会在触屏上渲染 undefined）；
// 触屏版不得出现快捷键字样（安卓没有物理键盘，写出来就是误导）。
// ============================================================================

import { describe, expect, it } from 'vitest'

import { CARD_SEARCH_STATIC_TEXT, CARD_SEARCH_TEXT } from './cardSearchText'

const SHORTCUT_MARKS = ['Enter', 'Esc', 'Shift', 'Ctrl'] as const

describe('CARD_SEARCH_TEXT 两套平台文案', () => {
  it('桌面与触屏的键完全对齐（组件按平台取值，缺键会渲染成 undefined）', () => {
    expect(Object.keys(CARD_SEARCH_TEXT.touch).sort()).toEqual(
      Object.keys(CARD_SEARCH_TEXT.desktop).sort(),
    )
  })

  it('桌面版把快捷键写进提示（沿用原有的可发现性）', () => {
    expect(CARD_SEARCH_TEXT.desktop.previous).toContain('Shift+Enter')
    expect(CARD_SEARCH_TEXT.desktop.next).toContain('Enter')
    expect(CARD_SEARCH_TEXT.desktop.close).toContain('Esc')
    expect(CARD_SEARCH_TEXT.desktop.empty).toContain('Enter')
  })

  it('触屏版一个快捷键字样都不出现', () => {
    for (const value of Object.values(CARD_SEARCH_TEXT.touch)) {
      for (const mark of SHORTCUT_MARKS) {
        expect(value, `${value} 不该出现 ${mark}`).not.toContain(mark)
      }
    }
  })

  it('触屏空态引导改成点按动作', () => {
    expect(CARD_SEARCH_TEXT.touch.empty).toContain('点')
  })

  it('每格都非空（中文文案常量表不允许留白）', () => {
    for (const group of Object.values(CARD_SEARCH_TEXT)) {
      for (const value of Object.values(group)) expect(value.trim()).not.toBe('')
    }
    for (const value of Object.values(CARD_SEARCH_STATIC_TEXT)) expect(value.trim()).not.toBe('')
  })
})
