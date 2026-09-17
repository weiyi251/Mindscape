// ============================================================================
// 模块说明（中文）
// 待办卡片插件文案表（text.ts）的单元测试。
// 与色卡插件同思路：文案漏写 / 留空不会让编译失败，只会静默出现在界面上，
// 这里把「每条文案非空、关键入口不被误改」变成会失败的断言。
// ============================================================================

import { describe, expect, it } from 'vitest'

import { TODO_CARD_TEXT } from './text'

describe('TODO_CARD_TEXT', () => {
  it('所有字符串文案都非空', () => {
    for (const [key, value] of Object.entries(TODO_CARD_TEXT)) {
      expect(value.trim().length, `文案 ${key} 为空`).toBeGreaterThan(0)
    }
  })

  it('文案里不出现十六进制色值字面量（否则要进守卫规则 3 的豁免清单）', () => {
    for (const [key, value] of Object.entries(TODO_CARD_TEXT)) {
      expect(value, `文案 ${key} 含 hex 字面量`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    }
  })

  it('界面入口与关键提示的文案有唯一出处（防误改导致菜单 / 悬停提示空白）', () => {
    expect(TODO_CARD_TEXT.menuLabel).toBe('新建待办')
    expect(TODO_CARD_TEXT.addPlaceholder).toContain('回车')
    expect(TODO_CARD_TEXT.connectLabel).toContain('连线')
  })
})
