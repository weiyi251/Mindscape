// ============================================================================
// 模块说明（中文）
// 「调整分区框矩形」命令的单元测试（2026-09-11 用户裁决「分区框大小自定义」）。
// 固化：do 应用新矩形 / undo 精确还原（含 x / y）/ 无尺寸变化判定。
// ============================================================================

import { describe, expect, it, vi } from 'vitest'

import {
  createSetPartitionRectsCommand,
  hasMeaningfulRectChange,
} from './setPartitionRects'

const DELTA = {
  id: 'p1',
  from: { x: 10, y: 20, w: 300, h: 200 },
  to: { x: 10, y: 20, w: 420, h: 260 },
}

describe('createSetPartitionRectsCommand', () => {
  it('do 应用新矩形（x / y 不变）', () => {
    const apply = vi.fn()
    createSetPartitionRectsCommand([DELTA], apply).do()
    expect(apply).toHaveBeenCalledWith([{ id: 'p1', x: 10, y: 20, w: 420, h: 260 }])
  })

  it('undo 精确还原原矩形', () => {
    const apply = vi.fn()
    const command = createSetPartitionRectsCommand([DELTA], apply)
    command.do()
    command.undo()
    expect(apply).toHaveBeenLastCalledWith([{ id: 'p1', x: 10, y: 20, w: 300, h: 200 }])
  })

  it('多条 delta 一起提交（未来多选调整预留）', () => {
    const apply = vi.fn()
    createSetPartitionRectsCommand(
      [DELTA, { ...DELTA, id: 'p2' }],
      apply,
    ).do()
    expect(apply).toHaveBeenCalledWith([
      { id: 'p1', x: 10, y: 20, w: 420, h: 260 },
      { id: 'p2', x: 10, y: 20, w: 420, h: 260 },
    ])
  })
})

describe('hasMeaningfulRectChange', () => {
  it('尺寸有变化 → 有意义', () => {
    expect(hasMeaningfulRectChange(DELTA)).toBe(true)
  })

  it('尺寸没变（原地单击手柄）→ 无意义', () => {
    expect(
      hasMeaningfulRectChange({ ...DELTA, to: { ...DELTA.from } }),
    ).toBe(false)
  })
})
