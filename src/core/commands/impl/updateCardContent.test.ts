// ============================================================================
// 模块说明（中文）
// core/commands/impl/updateCardContent.ts 的单元测试。
//
// 固化的规则：
//   · meta 整体替换 + 高度自适应是**一条**命令（撤销一次完整还原，不撕裂）；
//   · 高度没变时只换 meta，不写尺寸（省 store 写入与落盘调度）；
//   · width 原样透传（本命令不改宽度，但不能把宽度写丢）。
// ============================================================================

import { describe, expect, it, vi } from 'vitest'

import { createUpdateCardContentCommand } from './updateCardContent'

const BASE = {
  id: 'c_1',
  width: 220,
  fromMeta: { items: ['甲'] },
  toMeta: { items: ['甲', '乙'] },
  fromH: 120,
  toH: 160,
}

describe('createUpdateCardContentCommand：meta + 高度原子提交', () => {
  it('do：整体替换 meta 并把高度写到 toH（宽度原样透传）', () => {
    const meta = vi.fn()
    const sizes = vi.fn()
    createUpdateCardContentCommand(BASE, { meta, sizes }).do()

    expect(meta).toHaveBeenCalledWith('c_1', { items: ['甲', '乙'] })
    expect(sizes).toHaveBeenCalledWith([{ id: 'c_1', w: 220, h: 160 }])
  })

  it('undo：还原旧 meta 与旧高度', () => {
    const meta = vi.fn()
    const sizes = vi.fn()
    const command = createUpdateCardContentCommand(BASE, { meta, sizes })
    command.do()
    command.undo()

    expect(meta).toHaveBeenLastCalledWith('c_1', { items: ['甲'] })
    expect(sizes).toHaveBeenLastCalledWith([{ id: 'c_1', w: 220, h: 120 }])
  })

  it('高度相同：只换 meta，不写尺寸（不产生多余落盘）', () => {
    const meta = vi.fn()
    const sizes = vi.fn()
    createUpdateCardContentCommand({ ...BASE, toH: 120 }, { meta, sizes }).do()

    expect(meta).toHaveBeenCalledTimes(1)
    expect(sizes).not.toHaveBeenCalled()
  })

  it('不改动入参快照（meta 是引用透传，写回层整体替换不修改原对象）', () => {
    const fromMeta = { items: ['甲'] }
    const toMeta = { items: ['甲', '乙'] }
    createUpdateCardContentCommand({ ...BASE, fromMeta, toMeta }, { meta: vi.fn(), sizes: vi.fn() }).do()

    expect(fromMeta).toEqual({ items: ['甲'] })
    expect(toMeta).toEqual({ items: ['甲', '乙'] })
  })
})
