// 模块说明（中文）
// 「文件夹被外部改动」提示条文案的单元测试（A1，2026-09-20）。
// 文案与组件分文件（见 external-change-text.ts 顶部说明），因此本文件纯取值断言、不依赖 React。

import { describe, expect, it } from 'vitest'

import { EXTERNAL_CHANGE_TEXT } from './external-change-text'

describe('EXTERNAL_CHANGE_TEXT.lead', () => {
  it('文件数变化 → 给出前后数量', () => {
    const text = EXTERNAL_CHANGE_TEXT.lead({ prevFiles: 12, files: 15 })
    expect(text).toContain('12 → 15')
    expect(text).toContain('外部')
  })

  it('文件数减少同样给出前后数量', () => {
    expect(EXTERNAL_CHANGE_TEXT.lead({ prevFiles: 8, files: 3 })).toContain('8 → 3')
  })

  it('数量没变（改名 / 覆盖）→ 换一种措辞，不出现「8 → 8」这种噪声', () => {
    const text = EXTERNAL_CHANGE_TEXT.lead({ prevFiles: 8, files: 8 })
    expect(text).not.toContain('8 → 8')
    expect(text).toContain('名称或内容有变化')
  })
})

describe('EXTERNAL_CHANGE_TEXT 其余文案', () => {
  it('补充说明解释「重新扫描后会发生什么」（已消失的文件会记入已移除）', () => {
    expect(EXTERNAL_CHANGE_TEXT.hint).toContain('已移除')
  })

  it('三个动作文案齐备且互不相同', () => {
    const values = [
      EXTERNAL_CHANGE_TEXT.rescan,
      EXTERNAL_CHANGE_TEXT.rescanning,
      EXTERNAL_CHANGE_TEXT.dismiss,
    ]
    expect(new Set(values).size).toBe(3)
  })
})
