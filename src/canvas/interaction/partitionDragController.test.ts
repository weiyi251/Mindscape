// ============================================================================
// 模块说明（中文）
// 拖框控制器（partitionDragController）与复合命令（movePartitions）的单元测试（T2.5）。
// ============================================================================

import { describe, expect, it, vi } from 'vitest'

import { PartitionDragController } from './partitionDragController'
import type { PartitionMoveResult } from './partitionDragController'
import {
  createMovePartitionsCommand,
  hasMeaningfulPartitionMove,
} from '@/core/commands/impl/movePartitions'
import { History } from '@/core/commands/history'

function makeElement(): HTMLElement {
  // node 测试环境没有 DOM：最小形状的假对象即可（与 cardDragController.test 同策略）
  return { setPointerCapture: () => {} } as unknown as HTMLElement
}

function makeEvent(x: number, y: number, pointerId = 1): PointerEvent {
  return { pointerId, clientX: x, clientY: y } as unknown as PointerEvent
}

function createController(overrides: Partial<{ zoom: number }> = {}) {
  const writes: { partition?: { id: string; x: number; y: number }; cards: { id: string; x: number; y: number }[] } = {
    cards: [],
  }
  const source = {
    setPartitionTransform: (id: string, x: number, y: number) => {
      writes.partition = { id, x, y }
    },
    setCardTransform: (id: string, x: number, y: number) => {
      writes.cards.push({ id, x, y })
    },
    getZoom: () => overrides.zoom ?? 1,
  }
  const onDragEnd = vi.fn<(result: PartitionMoveResult) => void>()
  const controller = new PartitionDragController(source, { onDragEnd })
  return { controller, writes, onDragEnd }
}

describe('PartitionDragController', () => {
  it('按下未跨 4px 阈值不拖动，松手不回调', () => {
    const { controller, writes, onDragEnd } = createController()
    const element = makeElement()

    controller.begin(makeEvent(100, 100), 'p_001', element, { x: 10, y: 20 }, [])
    controller.move(makeEvent(102, 101)) // 位移 ~2.2px
    controller.end(makeEvent(102, 101))

    expect(writes.partition).toBeUndefined()
    expect(onDragEnd).not.toHaveBeenCalled()
  })

  it('拖动中直写框与卡片 transform，位移按 zoom 换算', () => {
    const { controller, writes, onDragEnd } = createController({ zoom: 2 })
    const element = makeElement()
    const companions = [
      { id: 'c_001', from: { x: 100, y: 100 } },
      { id: 'c_002', from: { x: 300, y: 100 } },
    ]

    controller.begin(makeEvent(0, 0), 'p_001', element, { x: 50, y: 60 }, companions)
    controller.move(makeEvent(20, 10)) // 屏幕位移 (20,10) → 画布位移 (10,5)
    controller.end(makeEvent(20, 10))

    expect(writes.partition).toEqual({ id: 'p_001', x: 60, y: 65 })
    expect(writes.cards).toEqual([
      { id: 'c_001', x: 110, y: 105 },
      { id: 'c_002', x: 310, y: 105 },
    ])

    expect(onDragEnd).toHaveBeenCalledTimes(1)
    const result = onDragEnd.mock.calls[0][0]
    expect(result.partitionId).toBe('p_001')
    expect(result.from).toEqual({ x: 50, y: 60 })
    expect(result.to).toEqual({ x: 60, y: 65 })
    expect(result.cardMoves[0].to).toEqual({ x: 110, y: 105 })
  })

  it('cancel 时还原框与卡片到起点', () => {
    const { controller, writes } = createController()
    const element = makeElement()

    controller.begin(makeEvent(0, 0), 'p_001', element, { x: 50, y: 60 }, [
      { id: 'c_001', from: { x: 100, y: 100 } },
    ])
    controller.move(makeEvent(30, 30))
    controller.cancel()

    expect(writes.partition).toEqual({ id: 'p_001', x: 50, y: 60 })
    expect(writes.cards.at(-1)).toEqual({ id: 'c_001', x: 100, y: 100 })
  })

  it('折叠场景：卡片 transform 无 DOM 也安全（writes 不报错），数据位移照常回调', () => {
    const { controller, onDragEnd } = createController()
    const element = makeElement()

    controller.begin(makeEvent(0, 0), 'p_001', element, { x: 0, y: 0 }, [
      { id: 'c_hidden', from: { x: 5, y: 5 } },
    ])
    controller.move(makeEvent(10, 0))
    controller.end(makeEvent(10, 0))

    expect(onDragEnd).toHaveBeenCalledTimes(1)
    expect(onDragEnd.mock.calls[0][0].cardMoves[0].to).toEqual({ x: 15, y: 5 })
  })

  it('反例守卫：指针捕获必须推迟到跨过 4px 阈值（按下即捕获会让标题条的 dblclick 被重定向拦截，双击改名失效）', () => {
    const captures: number[] = []
    const element = {
      setPointerCapture: (id: number) => captures.push(id),
    } as unknown as HTMLElement
    const { controller } = createController()

    controller.begin(makeEvent(0, 0), 'p_001', element, { x: 0, y: 0 }, [])
    controller.move(makeEvent(2, 0)) // 未跨阈值：不捕获，保持原生事件流让 dblclick 正常派发
    expect(captures).toEqual([])

    controller.move(makeEvent(6, 0)) // 跨过阈值开始拖动：此刻才捕获
    expect(captures).toEqual([1])
  })
})

describe('createMovePartitionsCommand', () => {
  it('do 应用框 + 卡片的 to，undo 整组还原 from', async () => {
    const writes: { partitions: { id: string; x: number; y: number }[]; cards: { id: string; x: number; y: number }[] }[] = []
    const apply = (payload: {
      partitions: { id: string; x: number; y: number }[]
      cards: { id: string; x: number; y: number }[]
    }) => {
      writes.push(JSON.parse(JSON.stringify(payload)))
    }
    const history = new History()

    await history.execute(
      createMovePartitionsCommand(
        {
          partitionId: 'p_001',
          from: { x: 0, y: 0 },
          to: { x: 30, y: 40 },
          cardMoves: [{ id: 'c_001', from: { x: 10, y: 10 }, to: { x: 40, y: 50 } }],
        },
        apply,
      ),
    )
    expect(writes.at(-1)).toEqual({
      partitions: [{ id: 'p_001', x: 30, y: 40 }],
      cards: [{ id: 'c_001', x: 40, y: 50 }],
    })

    await history.undo()
    expect(writes.at(-1)).toEqual({
      partitions: [{ id: 'p_001', x: 0, y: 0 }],
      cards: [{ id: 'c_001', x: 10, y: 10 }],
    })

    await history.redo()
    expect(writes.at(-1)).toEqual({
      partitions: [{ id: 'p_001', x: 30, y: 40 }],
      cards: [{ id: 'c_001', x: 40, y: 50 }],
    })
  })

  it('hasMeaningfulPartitionMove：框没动但卡片动了也算有意义', () => {
    expect(
      hasMeaningfulPartitionMove({
        partitionId: 'p_001',
        from: { x: 0, y: 0 },
        to: { x: 0, y: 0 },
        cardMoves: [{ id: 'c_001', from: { x: 0, y: 0 }, to: { x: 5, y: 0 } }],
      }),
    ).toBe(true)

    expect(
      hasMeaningfulPartitionMove({
        partitionId: 'p_001',
        from: { x: 0, y: 0 },
        to: { x: 0, y: 0 },
        cardMoves: [],
      }),
    ).toBe(false)
  })
})
