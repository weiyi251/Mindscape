import { describe, expect, it, vi } from 'vitest'

import {
  LONG_PRESS_MOVE_TOLERANCE_PX,
  LONG_PRESS_MS,
  LongPressDetector,
} from './longPress'
import type { Point } from './coordinates'

/** 手动的假计时器：把「时间」变成测试里可拨动的东西，不依赖 vitest 的定时器模拟 */
function createFakeTimer() {
  const queue: { id: number; fn: () => void; at: number }[] = []
  let nextId = 1
  let now = 0

  return {
    setTimer(fn: () => void, ms: number): number {
      const id = nextId++
      queue.push({ id, fn, at: now + ms })
      return id
    },
    clearTimer(id: number): void {
      const index = queue.findIndex((item) => item.id === id)
      if (index >= 0) queue.splice(index, 1)
    },
    advance(ms: number): void {
      now += ms
      // 到期的按登记顺序执行（同一批内不清空，避免回调里再登记时被漏掉）
      for (const due of queue.filter((item) => item.at <= now)) {
        queue.splice(queue.indexOf(due), 1)
        due.fn()
      }
    },
    pendingCount(): number {
      return queue.length
    },
  }
}

function point(x: number, y: number): Point {
  return { x, y }
}

describe('LongPressDetector：计时', () => {
  it('默认 500ms 后触发一次，并把按下的位置交出去', () => {
    const timer = createFakeTimer()
    const onLongPress = vi.fn()
    const detector = new LongPressDetector({ setTimer: timer.setTimer, clearTimer: timer.clearTimer, onLongPress })

    detector.begin(1, point(200, 300))
    expect(detector.isArmed).toBe(true)

    timer.advance(LONG_PRESS_MS - 1)
    expect(onLongPress).not.toHaveBeenCalled()

    timer.advance(1)
    expect(onLongPress).toHaveBeenCalledTimes(1)
    expect(onLongPress).toHaveBeenCalledWith(point(200, 300))
    // 计时器已消耗，不再是 armed
    expect(detector.isArmed).toBe(false)
  })

  it('继续按住不重复触发', () => {
    const timer = createFakeTimer()
    const onLongPress = vi.fn()
    const detector = new LongPressDetector({ setTimer: timer.setTimer, clearTimer: timer.clearTimer, onLongPress })

    detector.begin(1, point(5, 5))
    timer.advance(LONG_PRESS_MS * 4)
    expect(onLongPress).toHaveBeenCalledTimes(1)
  })

  it('触发前松手 → 不触发，计时器被清理', () => {
    const timer = createFakeTimer()
    const onLongPress = vi.fn()
    const detector = new LongPressDetector({ setTimer: timer.setTimer, clearTimer: timer.clearTimer, onLongPress })

    detector.begin(1, point(5, 5))
    timer.advance(200)
    expect(detector.end(1)).toBe(false)
    expect(timer.pendingCount()).toBe(0)
    timer.advance(LONG_PRESS_MS)
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('触发后松手 → end() 返回 true，供调用方吞掉紧随其后的 click', () => {
    const timer = createFakeTimer()
    const detector = new LongPressDetector({ setTimer: timer.setTimer, clearTimer: timer.clearTimer })

    detector.begin(7, point(1, 1))
    timer.advance(LONG_PRESS_MS)
    expect(detector.hasFired).toBe(true)
    expect(detector.end(7)).toBe(true)
    // end 之后状态复位，下一次按压是全新判定
    expect(detector.hasFired).toBe(false)
  })
})

describe('LongPressDetector：位移容差', () => {
  it('移动超过容差（默认 10px）→ 本次长按作废', () => {
    const timer = createFakeTimer()
    const onLongPress = vi.fn()
    const detector = new LongPressDetector({ setTimer: timer.setTimer, clearTimer: timer.clearTimer, onLongPress })

    detector.begin(1, point(0, 0))
    expect(detector.move(1, point(0, LONG_PRESS_MOVE_TOLERANCE_PX + 1))).toBe(false)
    timer.advance(LONG_PRESS_MS * 2)
    expect(onLongPress).not.toHaveBeenCalled()
    expect(timer.pendingCount()).toBe(0)
  })

  it('容差内抖动 → 不影响触发，且触发位置仍是按下点', () => {
    const timer = createFakeTimer()
    const onLongPress = vi.fn()
    const detector = new LongPressDetector({ setTimer: timer.setTimer, clearTimer: timer.clearTimer, onLongPress })

    detector.begin(1, point(100, 100))
    expect(detector.move(1, point(103, 98))).toBe(true)
    timer.advance(LONG_PRESS_MS)
    expect(onLongPress).toHaveBeenCalledWith(point(100, 100))
  })

  it('触发之后再大幅移动也不会撤销长按', () => {
    const timer = createFakeTimer()
    const onLongPress = vi.fn()
    const detector = new LongPressDetector({ setTimer: timer.setTimer, clearTimer: timer.clearTimer, onLongPress })

    detector.begin(1, point(0, 0))
    timer.advance(LONG_PRESS_MS)
    expect(detector.move(1, point(500, 500))).toBe(true)
    expect(detector.hasFired).toBe(true)
    expect(onLongPress).toHaveBeenCalledTimes(1)
  })

  it('容差可覆盖（触屏抖动大的设备可以放宽）', () => {
    const timer = createFakeTimer()
    const onLongPress = vi.fn()
    const detector = new LongPressDetector({
      tolerancePx: 24,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
      onLongPress,
    })

    detector.begin(1, point(0, 0))
    expect(detector.move(1, point(20, 0))).toBe(true)
    timer.advance(LONG_PRESS_MS)
    expect(onLongPress).toHaveBeenCalledTimes(1)
  })
})

describe('LongPressDetector：多指与其它指针', () => {
  it('第二根手指按下不重置计时（捏合起手时第一根手指已经在计时）', () => {
    const timer = createFakeTimer()
    const detector = new LongPressDetector({ setTimer: timer.setTimer, clearTimer: timer.clearTimer })

    detector.begin(1, point(0, 0))
    detector.begin(2, point(300, 300))
    expect(detector.activePointerId).toBe(1)
    expect(timer.pendingCount()).toBe(1)
  })

  it('move/end 传别人的 pointerId 不改变状态', () => {
    const timer = createFakeTimer()
    const detector = new LongPressDetector({ setTimer: timer.setTimer, clearTimer: timer.clearTimer })

    detector.begin(1, point(0, 0))
    expect(detector.move(2, point(999, 999))).toBe(false)
    expect(detector.end(2)).toBe(false)
    // 第一根手指的计时仍在
    expect(detector.isArmed).toBe(true)
    timer.advance(LONG_PRESS_MS)
    expect(detector.hasFired).toBe(true)
  })

  it('cancel() 立即作废（用于第二根手指落下切入捏合）', () => {
    const timer = createFakeTimer()
    const onLongPress = vi.fn()
    const detector = new LongPressDetector({ setTimer: timer.setTimer, clearTimer: timer.clearTimer, onLongPress })

    detector.begin(1, point(0, 0))
    detector.cancel()
    expect(detector.isArmed).toBe(false)
    expect(detector.activePointerId).toBe(null)
    timer.advance(LONG_PRESS_MS)
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('作废后可以重新按下开始新的判定', () => {
    const timer = createFakeTimer()
    const onLongPress = vi.fn()
    const detector = new LongPressDetector({ setTimer: timer.setTimer, clearTimer: timer.clearTimer, onLongPress })

    detector.begin(1, point(0, 0))
    detector.move(1, point(50, 0))
    detector.begin(1, point(60, 0))
    timer.advance(LONG_PRESS_MS)
    expect(onLongPress).toHaveBeenCalledWith(point(60, 0))
  })
})
