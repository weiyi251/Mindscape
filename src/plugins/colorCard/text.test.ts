// ============================================================================
// 模块说明（中文）
// 色卡插件文案表（text.ts）的单元测试。
//
// 看上去像在「测常量」，但拦住的是真实事故：漏写一条文案 → 界面上出现空白按钮 /
// 空标题；格式化函数改写时漏掉参数 → 提示语里少了文件路径，用户不知道存到哪了。
// 这两类问题不会让编译失败，只会静静地出现在界面上。
// ============================================================================

import { describe, expect, it } from 'vitest'

import { COLOR_CARD_TEXT, COLOR_PRESET_LABELS, RATIO_PRESET_LABELS, SIZE_PRESET_LABELS } from './text'

describe('COLOR_CARD_TEXT', () => {
  it('所有字符串文案都非空', () => {
    for (const [key, value] of Object.entries(COLOR_CARD_TEXT)) {
      if (typeof value !== 'string') continue
      expect(value.trim().length, `文案 ${key} 为空`).toBeGreaterThan(0)
    }
  })

  it('文案里不出现十六进制色值字面量（否则要进守卫规则 3 的豁免清单）', () => {
    for (const [key, value] of Object.entries(COLOR_CARD_TEXT)) {
      if (typeof value !== 'string') continue
      expect(value, `文案 ${key} 含 hex 字面量`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    }
  })

  it('格式化文案把参数带进结果里', () => {
    expect(COLOR_CARD_TEXT.sizeHint(16, 4096)).toContain('16')
    expect(COLOR_CARD_TEXT.sizeHint(16, 4096)).toContain('4096')
    expect(COLOR_CARD_TEXT.fileNamePreview('色卡-x.png')).toContain('色卡-x.png')
    expect(COLOR_CARD_TEXT.savedTo('E:\\a\\b.png')).toContain('E:\\a\\b.png')
    expect(COLOR_CARD_TEXT.saveFailed('磁盘已满')).toContain('磁盘已满')
    expect(COLOR_CARD_TEXT.invalidSize(16, 4096)).toContain('4096')
  })

  it('四条「跳过建卡」的说明都点明「文件已经写好了」，且互不重复', () => {
    const skipCopy = [
      COLOR_CARD_TEXT.skipNoBridge,
      COLOR_CARD_TEXT.skipNoSpace,
      COLOR_CARD_TEXT.skipOutsideSpace,
      COLOR_CARD_TEXT.skipRejected,
    ]
    for (const copy of skipCopy) {
      expect(copy).toContain('生成了文件')
    }
    expect(new Set(skipCopy).size).toBe(skipCopy.length)
  })
})

describe('预设标签表', () => {
  it('没有空标签', () => {
    for (const table of [COLOR_PRESET_LABELS, SIZE_PRESET_LABELS, RATIO_PRESET_LABELS]) {
      for (const [id, label] of Object.entries(table)) {
        expect(label.trim().length, `标签 ${id} 为空`).toBeGreaterThan(0)
      }
    }
  })

  it('比例标签就是比值写法（按钮上直接显示它）', () => {
    for (const label of Object.values(RATIO_PRESET_LABELS)) {
      expect(label).toMatch(/^\d+:\d+$/)
    }
  })

  it('长边像素的悬停说明把像素值带进结果里', () => {
    expect(COLOR_CARD_TEXT.longEdgeTitle(1920)).toContain('1920')
  })
})
