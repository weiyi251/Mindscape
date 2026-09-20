// ============================================================================
// 模块说明（中文）
// 提示条文案与拼接的单元测试（A2，2026-09-20）。
// 文案与组件分文件（见 unframed-folders-text.ts 顶部说明），因此这里的用例
// 不依赖 React，纯取值断言。
// ============================================================================

import { describe, expect, it } from 'vitest'

import {
  UNFRAMED_FOLDERS_TEXT,
  UNFRAMED_NAME_LIMIT,
  unframedNamesLabel,
} from './unframed-folders-text'

describe('unframedNamesLabel', () => {
  it('不超过上限时全部列出', () => {
    expect(unframedNamesLabel(['甲'])).toBe('甲')
    expect(unframedNamesLabel(['甲', '乙'])).toBe('甲、乙')
    expect(unframedNamesLabel(['甲', '乙', '丙'])).toBe('甲、乙、丙')
  })

  it('恰好到上限仍全部列出（边界不多折叠一个）', () => {
    const names = ['甲', '乙', '丙'].slice(0, UNFRAMED_NAME_LIMIT)
    expect(unframedNamesLabel(names)).toBe('甲、乙、丙')
    expect(unframedNamesLabel(names)).not.toContain('等')
  })

  it('超过上限时折叠为「等 N 个」', () => {
    const names = ['甲', '乙', '丙', '丁', '戊']
    expect(unframedNamesLabel(names)).toBe(`甲、乙、丙${UNFRAMED_FOLDERS_TEXT.more(2)}`)
  })

  it('空列表返回空串（调用方已保证不为空，这里是防御）', () => {
    expect(unframedNamesLabel([])).toBe('')
  })
})

describe('UNFRAMED_FOLDERS_TEXT', () => {
  it('数量前缀随数量变化', () => {
    expect(UNFRAMED_FOLDERS_TEXT.lead(1)).toContain('1 个文件夹')
    expect(UNFRAMED_FOLDERS_TEXT.lead(12)).toContain('12 个文件夹')
  })

  it('三个动作文案齐备且互不相同', () => {
    const values = [
      UNFRAMED_FOLDERS_TEXT.generate,
      UNFRAMED_FOLDERS_TEXT.generating,
      UNFRAMED_FOLDERS_TEXT.dismiss,
    ]
    expect(new Set(values).size).toBe(3)
  })
})
