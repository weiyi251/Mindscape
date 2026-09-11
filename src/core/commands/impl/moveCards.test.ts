// ============================================================================
// 模块说明（中文）
// 「移动卡片」命令测试（T2.2 / T2.9 基础）。
// 覆盖：do / undo 的坐标应用、与 History 的集成（撤销 / 重做）、无意义位移过滤。
// ============================================================================

import { describe, expect, it } from 'vitest'

import { History } from '../history'
import { createMoveCardsCommand, hasMeaningfulMove } from './moveCards'
import type { CardMoveDelta } from './moveCards'

/** 记录 apply 收到的每一次写入，便于断言顺序 */
function createRecorder() {
  const writes: Array<{ id: string; x: number; y: number }[]> = []
  const apply = (positions: { id: string; x: number; y: number }[]) => {
    writes.push(positions.map((position) => ({ ...position })))
  }
  return { writes, apply }
}

const SINGLE: CardMoveDelta[] = [
  { id: 'c_001', from: { x: 10, y: 20 }, to: { x: 110, y: 220 } },
]

describe('createMoveCardsCommand', () => {
  it('do 应用 to，undo 应用 from', async () => {
    const { writes, apply } = createRecorder()
    const command = createMoveCardsCommand(SINGLE, apply)

    await command.do()
    expect(writes.at(-1)).toEqual([{ id: 'c_001', x: 110, y: 220 }])

    await command.undo()
    expect(writes.at(-1)).toEqual([{ id: 'c_001', x: 10, y: 20 }])
  })

  it('多张卡片一次拖拽产生一条命令，撤销一步整组还原（11.2）', async () => {
    const { writes, apply } = createRecorder()
    const group: CardMoveDelta[] = [
      { id: 'a', from: { x: 0, y: 0 }, to: { x: 50, y: 0 } },
      { id: 'b', from: { x: 200, y: 0 }, to: { x: 250, y: 0 } },
    ]
    const history = new History()
    await history.execute(createMoveCardsCommand(group, apply))

    expect(writes.at(-1)).toEqual([
      { id: 'a', x: 50, y: 0 },
      { id: 'b', x: 250, y: 0 },
    ])

    await history.undo()
    expect(writes.at(-1)).toEqual([
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 200, y: 0 },
    ])

    await history.redo()
    expect(writes.at(-1)).toEqual([
      { id: 'a', x: 50, y: 0 },
      { id: 'b', x: 250, y: 0 },
    ])
  })

  it('接入 History：拖动 → 撤销 → 重做 的完整链路', async () => {
    const { writes, apply } = createRecorder()
    const history = new History()

    // 模拟 Canvas 松手：DOM 已生效，这里只补「固化 + 入栈」
    await history.execute(createMoveCardsCommand(SINGLE, apply))

    expect(history.canUndo()).toBe(true)
    await history.undo()
    expect(writes.at(-1)).toEqual([{ id: 'c_001', x: 10, y: 20 }])
    expect(history.canRedo()).toBe(true)

    await history.redo()
    expect(writes.at(-1)).toEqual([{ id: 'c_001', x: 110, y: 220 }])
  })
})

describe('hasMeaningfulMove', () => {
  it('原地松手（位移为 0）不应产生命令', () => {
    expect(
      hasMeaningfulMove([{ id: 'a', from: { x: 5, y: 5 }, to: { x: 5, y: 5 } }]),
    ).toBe(false)
  })

  it('有实际位移时为 true', () => {
    expect(
      hasMeaningfulMove([{ id: 'a', from: { x: 5, y: 5 }, to: { x: 5, y: 6 } }]),
    ).toBe(true)
  })
})
