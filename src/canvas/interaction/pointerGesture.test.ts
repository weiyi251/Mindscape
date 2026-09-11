// ============================================================================
// 模块说明（中文）
// 点击 / 拖拽 4px 判定单元测试。直接对应 T0.12 的验收标准：
//   「单元测试覆盖：位移 3px → click；位移 5px → drag」
//
// 同时覆盖边界值（正好 4px）、拖拽锁定、pointerId 隔离与取消路径。
//
// 实现任务：T0.12（准备层）。
// ============================================================================

import { describe, it, expect, vi } from 'vitest'

import {
  CLICK_DRAG_THRESHOLD_PX,
  PointerGesture,
  judgeGesture,
} from '@/canvas/interaction/pointerGesture'
import type { GestureResult } from '@/canvas/interaction/pointerGesture'

const POINTER = 1

/** 走一次完整手势：按下 → 移动若干点 → 松手 */
function runGesture(points: Array<{ x: number; y: number }>, gesture = new PointerGesture()) {
  gesture.begin(POINTER, 0, { x: 0, y: 0 })
  for (const point of points) gesture.move(POINTER, point)
  const last = points.at(-1) ?? { x: 0, y: 0 }
  return { gesture, result: gesture.end(POINTER, last) }
}

describe('阈值常量', () => {
  it('默认 4px（对应 5.1）', () => {
    expect(CLICK_DRAG_THRESHOLD_PX).toBe(4)
    expect(new PointerGesture().thresholdPx).toBe(4)
  })
})

describe('T0.12 验收：位移 3px → click，位移 5px → drag', () => {
  it('位移 3px 判定为单击', () => {
    const { result } = runGesture([{ x: 3, y: 0 }])
    expect(result?.kind).toBe('click')
    expect(result?.distance).toBe(3)
  })

  it('位移 5px 判定为拖拽', () => {
    const { result } = runGesture([{ x: 5, y: 0 }])
    expect(result?.kind).toBe('drag')
    expect(result?.distance).toBe(5)
  })

  it('位移正好 4px 仍算单击（阈值是「大于 4px 才拖拽」）', () => {
    expect(runGesture([{ x: 4, y: 0 }]).result?.kind).toBe('click')
  })

  it('完全没动也算单击', () => {
    const gesture = new PointerGesture()
    gesture.begin(POINTER, 0, { x: 100, y: 100 })
    expect(gesture.end(POINTER, { x: 100, y: 100 })?.kind).toBe('click')
  })

  it('距离按欧氏距离算：3px + 4px 的对角位移 = 5px → 拖拽', () => {
    expect(runGesture([{ x: 3, y: 4 }]).result?.kind).toBe('drag')
    // 而 2px + 3px 的对角位移 ≈ 3.6px → 单击
    expect(runGesture([{ x: 2, y: 3 }]).result?.kind).toBe('click')
  })
})

describe('拖拽锁定', () => {
  it('过程中超过阈值后，即使松手时拖回起点仍判为拖拽', () => {
    const { result } = runGesture([{ x: 50, y: 0 }, { x: 0, y: 0 }])
    expect(result?.kind).toBe('drag')
    expect(result?.maxDistance).toBe(50)
    expect(result?.distance).toBe(0)
  })

  it('isDragging 在首次超过阈值时变 true，且 onDragStart 只触发一次', () => {
    const onDragStart = vi.fn()
    const gesture = new PointerGesture({ onDragStart })

    gesture.begin(POINTER, 0, { x: 0, y: 0 })
    expect(gesture.isDragging).toBe(false)

    gesture.move(POINTER, { x: 3, y: 0 })
    expect(gesture.isDragging).toBe(false)

    gesture.move(POINTER, { x: 6, y: 0 })
    expect(gesture.isDragging).toBe(true)

    gesture.move(POINTER, { x: 20, y: 0 })
    gesture.move(POINTER, { x: 40, y: 0 })

    expect(onDragStart).toHaveBeenCalledTimes(1)
    expect(onDragStart).toHaveBeenCalledWith({ x: 0, y: 0 })
  })

  it('move 返回值表示当前是否处于拖拽', () => {
    const gesture = new PointerGesture()
    gesture.begin(POINTER, 0, { x: 0, y: 0 })

    expect(gesture.move(POINTER, { x: 2, y: 0 })).toBe(false)
    expect(gesture.move(POINTER, { x: 9, y: 0 })).toBe(true)
  })
})

describe('生命周期与结果字段', () => {
  it('end 返回完整的判定结果', () => {
    const gesture = new PointerGesture()
    gesture.begin(POINTER, 0, { x: 10, y: 20 })
    gesture.move(POINTER, { x: 30, y: 20 })
    const result = gesture.end(POINTER, { x: 40, y: 60 }) as GestureResult

    expect(result).toEqual({
      kind: 'drag',
      start: { x: 10, y: 20 },
      end: { x: 40, y: 60 },
      delta: { x: 30, y: 40 },
      distance: 50,
      maxDistance: 50,
      pointerId: POINTER,
      button: 0,
    })
  })

  it('结束或取消后回到空闲状态', () => {
    const gesture = new PointerGesture()
    gesture.begin(POINTER, 0, { x: 0, y: 0 })
    gesture.end(POINTER, { x: 0, y: 0 })

    expect(gesture.isActive).toBe(false)
    expect(gesture.isDragging).toBe(false)
    expect(gesture.end(POINTER, { x: 0, y: 0 })).toBeNull()
  })

  it('已有进行中的手势时 begin 返回 false（不覆盖起点）', () => {
    const gesture = new PointerGesture()
    expect(gesture.begin(POINTER, 0, { x: 0, y: 0 })).toBe(true)
    expect(gesture.begin(POINTER, 0, { x: 100, y: 100 })).toBe(false)

    expect(gesture.end(POINTER, { x: 3, y: 0 })?.start).toEqual({ x: 0, y: 0 })
  })

  it('未开始手势时 move / end / cancel 都安全空转', () => {
    const gesture = new PointerGesture()
    expect(gesture.move(POINTER, { x: 1, y: 1 })).toBe(false)
    expect(gesture.end(POINTER, { x: 1, y: 1 })).toBeNull()
    expect(() => gesture.cancel()).not.toThrow()
  })

  it('cancel 产生 onCancel 但不产生判定结果', () => {
    const onCancel = vi.fn()
    const onEnd = vi.fn()
    const gesture = new PointerGesture({ onCancel, onEnd })

    gesture.begin(POINTER, 0, { x: 0, y: 0 })
    gesture.move(POINTER, { x: 100, y: 0 })
    gesture.cancel()

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onEnd).not.toHaveBeenCalled()
    expect(gesture.isActive).toBe(false)
  })
})

describe('pointerId 隔离', () => {
  it('非当前手势的 pointerId 的 move / end 被忽略', () => {
    const gesture = new PointerGesture()
    gesture.begin(POINTER, 0, { x: 0, y: 0 })

    expect(gesture.isActivePointer(999)).toBe(false)
    expect(gesture.move(999, { x: 500, y: 500 })).toBe(false)
    expect(gesture.end(999, { x: 500, y: 500 })).toBeNull()
    // 原手势未被破坏
    expect(gesture.isActive).toBe(true)
    expect(gesture.end(POINTER, { x: 1, y: 0 })?.kind).toBe('click')
  })
})

describe('startPoint / onMove', () => {
  it('startPoint 返回副本，修改它不影响内部状态', () => {
    const gesture = new PointerGesture()
    gesture.begin(POINTER, 0, { x: 7, y: 8 })

    const start = gesture.startPoint
    start.x = 999

    expect(gesture.startPoint).toEqual({ x: 7, y: 8 })
  })

  it('onMove 收到相对起点的增量', () => {
    const onMove = vi.fn()
    const gesture = new PointerGesture({ onMove })
    gesture.begin(POINTER, 0, { x: 100, y: 50 })
    gesture.move(POINTER, { x: 103, y: 40 })

    expect(onMove).toHaveBeenCalledWith({ x: 3, y: -10 }, { x: 103, y: 40 })
  })
})

describe('PointerEvent 便捷封装', () => {
  it('从原生事件读取 pointerId / button / 坐标', () => {
    const gesture = new PointerGesture()
    const down = { pointerId: 7, button: 0, clientX: 10, clientY: 20 } as PointerEvent
    const move = { pointerId: 7, button: 0, clientX: 50, clientY: 20 } as PointerEvent
    const up = { pointerId: 7, button: 0, clientX: 50, clientY: 20 } as PointerEvent

    expect(gesture.beginFromEvent(down)).toBe(true)
    expect(gesture.moveFromEvent(move)).toBe(true)
    const result = gesture.endFromEvent(up)

    expect(result?.kind).toBe('drag')
    expect(result?.start).toEqual({ x: 10, y: 20 })
    expect(result?.delta).toEqual({ x: 40, y: 0 })
  })
})

describe('自定义阈值', () => {
  it('阈值可调（5.1：阈值是经验值，可调）', () => {
    const strict = new PointerGesture({ threshold: 1 })
    strict.begin(POINTER, 0, { x: 0, y: 0 })
    strict.move(POINTER, { x: 3, y: 0 })
    expect(strict.end(POINTER, { x: 3, y: 0 })?.kind).toBe('drag')

    const loose = new PointerGesture({ threshold: 20 })
    loose.begin(POINTER, 0, { x: 0, y: 0 })
    loose.move(POINTER, { x: 15, y: 0 })
    expect(loose.end(POINTER, { x: 15, y: 0 })?.kind).toBe('click')
  })
})

describe('judgeGesture 一次性判定', () => {
  it('3px → click，5px → drag', () => {
    expect(judgeGesture({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe('click')
    expect(judgeGesture({ x: 0, y: 0 }, { x: 5, y: 0 })).toBe('drag')
  })

  it('支持自定义阈值', () => {
    expect(judgeGesture({ x: 0, y: 0 }, { x: 30, y: 0 }, 50)).toBe('click')
  })
})
