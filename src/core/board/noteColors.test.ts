// ============================================================================
// 模块说明（中文）
// noteColors.ts 的单元测试：色板形状、meta 读写的脏数据兜底与不可变性。
// ============================================================================

import { describe, expect, it } from 'vitest'

import type { Meta } from '@/core/types'

import {
  NOTE_BG_ALPHA,
  NOTE_BORDER_ALPHA,
  NOTE_COLOR_META_KEY,
  NOTE_PALETTE,
  metaWithNoteColor,
  noteColorOfMeta,
} from './noteColors'

describe('NOTE_PALETTE', () => {
  it('全部是合法的 #RRGGBB 色值', () => {
    for (const color of NOTE_PALETTE) {
      expect(color).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })

  it('色值互不重复', () => {
    expect(new Set(NOTE_PALETTE).size).toBe(NOTE_PALETTE.length)
  })

  it('透明度后缀是合法的两位 hex（与色值拼接后仍是 8 位 hex）', () => {
    expect(NOTE_BG_ALPHA).toMatch(/^[0-9a-fA-F]{2}$/)
    expect(NOTE_BORDER_ALPHA).toMatch(/^[0-9a-fA-F]{2}$/)
    const stacked = `${NOTE_PALETTE[0]}${NOTE_BG_ALPHA}`
    expect(stacked).toMatch(/^#[0-9a-fA-F]{8}$/)
  })
})

describe('noteColorOfMeta', () => {
  it('合法 #RRGGBB 原样返回', () => {
    expect(noteColorOfMeta({ noteColor: '#E7C873' })).toBe('#E7C873')
    expect(noteColorOfMeta({ noteColor: '#e7c873' })).toBe('#e7c873')
  })

  it('色板之外的合法色值也接受（色板将来调整时旧数据仍可渲染）', () => {
    expect(noteColorOfMeta({ noteColor: '#123456' })).toBe('#123456')
  })

  it('脏数据返回 null：非字符串 / 空串 / 缺键 / 非 6 位 hex', () => {
    expect(noteColorOfMeta({})).toBeNull()
    expect(noteColorOfMeta({ noteColor: 42 as unknown as string })).toBeNull()
    expect(noteColorOfMeta({ noteColor: '' })).toBeNull()
    expect(noteColorOfMeta({ noteColor: 'E7C873' })).toBeNull() // 缺 #
    expect(noteColorOfMeta({ noteColor: '#E7C87' })).toBeNull() // 5 位
    expect(noteColorOfMeta({ noteColor: '#E7C8733' })).toBeNull() // 7 位
    expect(noteColorOfMeta({ noteColor: '#GGGGGG' })).toBeNull() // 非 hex
    expect(noteColorOfMeta({ noteColor: '  #E7C873' })).toBeNull() // 带空白
  })
})

describe('metaWithNoteColor', () => {
  it('写入颜色：生成带新键的 meta 快照', () => {
    const next = metaWithNoteColor({ tags: ['参考'] }, '#E7C873')
    expect(next[NOTE_COLOR_META_KEY]).toBe('#E7C873')
    expect(next.tags).toEqual(['参考'])
  })

  it('传 null 回到默认便签纸：删键而不是留 null 脏值', () => {
    const next = metaWithNoteColor({ noteColor: '#E7C873', tags: [] }, null)
    expect(next).not.toHaveProperty(NOTE_COLOR_META_KEY)
    expect(next.tags).toEqual([])
  })

  it('覆盖旧颜色', () => {
    const next = metaWithNoteColor({ noteColor: '#E7C873' }, '#8FB8D8')
    expect(next[NOTE_COLOR_META_KEY]).toBe('#8FB8D8')
  })

  it('不改动原 meta 对象（不可变约定）', () => {
    const original: Meta = { noteColor: '#E7C873' }
    metaWithNoteColor(original, null)
    metaWithNoteColor(original, '#8FB8D8')
    expect(original[NOTE_COLOR_META_KEY]).toBe('#E7C873')
  })
})
