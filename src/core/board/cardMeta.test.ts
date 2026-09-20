// ============================================================================
// 模块说明（中文）
// core/board/cardMeta.ts 的单元测试。
//
// 覆盖点：标签读写往返、悬浮标记读写往返、不改动入参（纯函数）、脏数据兜底。
// 这两条用例原在 core/commands/impl/t3Commands.test.ts 里（当时函数住在命令文件），
// 2026-09-14 随函数迁到本文件 —— 测试跟着被测主体走。
// ============================================================================

import { describe, expect, it } from 'vitest'

import {
  HOVER_LABEL_META_KEY,
  ITEM_ANCHORS_META_KEY,
  hoverLabelOfMeta,
  itemAnchorsOfMeta,
  metaWithHoverLabel,
  metaWithItemAnchors,
  metaWithTags,
  tagsOfMeta,
  LOCKED_META_KEY,
  lockedOfMeta,
  metaWithLocked,
} from './cardMeta'

describe('cardMeta：标签读写', () => {
  it('metaWithTags → tagsOfMeta 往返一致，且其余 meta 字段保留', () => {
    const meta = metaWithTags({ a: 1 }, ['参考', '待定'])
    expect(tagsOfMeta(meta)).toEqual(['参考', '待定'])
    expect(meta.a).toBe(1)
  })

  it('metaWithTags 不改动入参（返回新对象）', () => {
    const original = { a: 1 }
    const next = metaWithTags(original, ['标签'])
    expect(original).toEqual({ a: 1 })
    expect(next).not.toBe(original)
  })

  it('tagsOfMeta 对脏数据兜底返回空数组', () => {
    expect(tagsOfMeta({ tags: 'not-array' })).toEqual([])
    expect(tagsOfMeta({})).toEqual([])
    expect(tagsOfMeta({ tags: null })).toEqual([])
  })

  it('tagsOfMeta 把非字符串元素强制转成字符串（与落盘后的宽松数据对齐）', () => {
    expect(tagsOfMeta({ tags: [1, true, '甲'] })).toEqual(['1', 'true', '甲'])
  })
})

// ---------------------------------------------------------------------------
// 悬浮标记（2026-09-14）：色卡插件把色号写在这里，画布悬停时显示
// ---------------------------------------------------------------------------

describe('cardMeta：悬浮标记', () => {
  it('metaWithHoverLabel → hoverLabelOfMeta 往返一致，且其余 meta 字段保留', () => {
    const meta = metaWithHoverLabel({ tags: ['参考'] }, '#5A7D6A')
    expect(hoverLabelOfMeta(meta)).toBe('#5A7D6A')
    expect(tagsOfMeta(meta)).toEqual(['参考'])
  })

  it('metaWithHoverLabel 不改动入参（返回新对象）', () => {
    const original = { tags: ['a'] }
    const next = metaWithHoverLabel(original, '#000000')
    expect(original).toEqual({ tags: ['a'] })
    expect(next).not.toBe(original)
  })

  it('键名就是 hoverLabel（落盘后的 JSON 结构，改动即破坏已生成的色卡）', () => {
    expect(HOVER_LABEL_META_KEY).toBe('hoverLabel')
    expect(metaWithHoverLabel({}, '#ABCDEF')).toEqual({ hoverLabel: '#ABCDEF' })
  })

  it('脏数据兜底返回 null：非字符串 / 空串 / 纯空白 / 缺字段', () => {
    expect(hoverLabelOfMeta({})).toBeNull()
    expect(hoverLabelOfMeta({ hoverLabel: 42 })).toBeNull()
    expect(hoverLabelOfMeta({ hoverLabel: null })).toBeNull()
    expect(hoverLabelOfMeta({ hoverLabel: ['#000000'] })).toBeNull()
    expect(hoverLabelOfMeta({ hoverLabel: '' })).toBeNull()
    expect(hoverLabelOfMeta({ hoverLabel: '   ' })).toBeNull()
  })

  it('返回 trim 之后的文本（它要作为单行标记渲染）', () => {
    expect(hoverLabelOfMeta({ hoverLabel: '  #5A7D6A  ' })).toBe('#5A7D6A')
  })
})

// ---------------------------------------------------------------------------
// 条目锚点表（2026-09-17）：条目级连线的通用协议（插件自算偏移写入）
// ---------------------------------------------------------------------------

describe('cardMeta：条目锚点表', () => {
  it('metaWithItemAnchors → itemAnchorsOfMeta 往返一致，且其余 meta 字段保留', () => {
    const meta = metaWithItemAnchors({ hoverLabel: 'x' }, { item1: 24, item2: 48 })
    expect(itemAnchorsOfMeta(meta)).toEqual({ item1: 24, item2: 48 })
    expect(hoverLabelOfMeta(meta)).toBe('x')
  })

  it('metaWithItemAnchors 不改动入参（返回新对象）', () => {
    const original = { a: 1 }
    const next = metaWithItemAnchors(original, { item1: 10 })
    expect(original).toEqual({ a: 1 })
    expect(next).not.toBe(original)
  })

  it('键名就是 itemAnchors（落盘后的 JSON 结构，改动即破坏已有连线锚点）', () => {
    expect(ITEM_ANCHORS_META_KEY).toBe('itemAnchors')
    expect(metaWithItemAnchors({}, { i: 5 })).toEqual({ itemAnchors: { i: 5 } })
  })

  it('脏数据兜底：非对象 / 数组 / null / 缺字段都返回空表', () => {
    expect(itemAnchorsOfMeta({})).toEqual({})
    expect(itemAnchorsOfMeta({ itemAnchors: 'not-object' })).toEqual({})
    expect(itemAnchorsOfMeta({ itemAnchors: [1, 2] })).toEqual({})
    expect(itemAnchorsOfMeta({ itemAnchors: null })).toEqual({})
  })

  it('表内非有限数的值被剔除，其余条目保留（绝不抛错——渲染循环里调用）', () => {
    expect(itemAnchorsOfMeta({ itemAnchors: { good: 24, bad: 'x', nan: Number.NaN, inf: Infinity } })).toEqual({
      good: 24,
    })
  })
})

// ---------------------------------------------------------------------------
// 卡片锁定（2026-09-20）
// ---------------------------------------------------------------------------

describe('cardMeta：锁定标记', () => {
  it('只有布尔真值算锁定（脏数据一律当未锁定）', () => {
    expect(lockedOfMeta({})).toBe(false)
    expect(lockedOfMeta({ [LOCKED_META_KEY]: true })).toBe(true)
    for (const dirty of [false, 'true', 1, null, undefined, {}]) {
      expect(lockedOfMeta({ [LOCKED_META_KEY]: dirty })).toBe(false)
    }
  })

  it('metaWithLocked 往返一致，且其余字段保留', () => {
    const meta = metaWithLocked({ tags: ['参考'], noteColor: '#E7C873' }, true)
    expect(meta).toEqual({ tags: ['参考'], noteColor: '#E7C873', locked: true })
    expect(lockedOfMeta(meta)).toBe(true)
  })

  it('解锁时删键（不留 false 脏字段）', () => {
    const locked = metaWithLocked({ tags: ['x'] }, true)
    const unlocked = metaWithLocked(locked, false)
    expect(LOCKED_META_KEY in unlocked).toBe(false)
    expect(unlocked).toEqual({ tags: ['x'] })
    expect(lockedOfMeta(unlocked)).toBe(false)
  })

  it('不改动入参（返回新对象）', () => {
    const original = { tags: ['a'] }
    const next = metaWithLocked(original, true)
    expect(next).not.toBe(original)
    expect(original).toEqual({ tags: ['a'] })
  })
})
