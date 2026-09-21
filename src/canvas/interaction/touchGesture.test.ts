import { describe, expect, it, vi } from 'vitest'

import { TouchGestureRecognizer } from './touchGesture'
import { CLICK_DRAG_THRESHOLD_PX } from './pointerGesture'
import { LONG_PRESS_MS } from './longPress'
import type { Point } from './coordinates'

function point(x: number, y: number): Point {
  return { x, y }
}

/** 手动假计时器：长按这条时间轴在测试里必须可拨动 */
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
      for (const due of queue.filter((item) => item.at <= now)) {
        queue.splice(queue.indexOf(due), 1)
        due.fn()
      }
    },
  }
}

interface Harness {
  recognizer: TouchGestureRecognizer
  timer: ReturnType<typeof createFakeTimer>
  panBy: ReturnType<typeof vi.fn>
  pinchStart: ReturnType<typeof vi.fn>
  pinchFrame: ReturnType<typeof vi.fn>
  pinchEnd: ReturnType<typeof vi.fn>
  longPress: ReturnType<typeof vi.fn>
  tap: ReturnType<typeof vi.fn>
}

function createHarness(): Harness {
  const timer = createFakeTimer()
  const panBy = vi.fn()
  const pinchStart = vi.fn()
  const pinchFrame = vi.fn()
  const pinchEnd = vi.fn()
  const longPress = vi.fn()
  const tap = vi.fn()
  const recognizer = new TouchGestureRecognizer({
    onPanBy: panBy,
    onPinchStart: pinchStart,
    onPinchFrame: pinchFrame,
    onPinchEnd: pinchEnd,
    onLongPress: longPress,
    onTap: tap,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
  })
  return { recognizer, timer, panBy, pinchStart, pinchFrame, pinchEnd, longPress, tap }
}

describe('TouchGestureRecognizer：单指平移与点击', () => {
  it('空白处按下再拖过阈值 → 先补上整段位移，之后走增量', () => {
    const { recognizer, panBy } = createHarness()

    recognizer.pointerDown({ pointerId: 1, point: point(100, 100) })
    expect(recognizer.mode).toBe('single')

    // 阈值内不动画面（5.1 的手抖判定）
    recognizer.pointerMove(1, point(100 + CLICK_DRAG_THRESHOLD_PX - 2, 100))
    expect(panBy).not.toHaveBeenCalled()
    expect(recognizer.mode).toBe('single')

    recognizer.pointerMove(1, point(150, 100))
    expect(recognizer.mode).toBe('pan')
    expect(panBy).toHaveBeenLastCalledWith(50, 0)

    recognizer.pointerMove(1, point(170, 110))
    expect(panBy).toHaveBeenLastCalledWith(20, 10)
  })

  it('空白处点一下（未过阈值）→ 抬手发 tap，且全程不平移', () => {
    const { recognizer, panBy, tap } = createHarness()

    recognizer.pointerDown({ pointerId: 1, point: point(60, 70) })
    recognizer.pointerMove(1, point(61, 71))
    recognizer.pointerUp(1, point(61, 71))

    expect(panBy).not.toHaveBeenCalled()
    expect(tap).toHaveBeenCalledTimes(1)
    expect(tap).toHaveBeenCalledWith(point(61, 71))
    expect(recognizer.mode).toBe('idle')
  })

  it('拖过阈值后抬手 → 不算 tap（拖完画面不该顺手取消选中）', () => {
    const { recognizer, tap } = createHarness()

    recognizer.pointerDown({ pointerId: 1, point: point(0, 0) })
    recognizer.pointerMove(1, point(200, 0))
    recognizer.pointerUp(1, point(200, 0))
    expect(tap).not.toHaveBeenCalled()
  })

  it('按在卡片上 → 状态机不平移、抬手也不 tap（拖卡与选中由卡片控制器负责）', () => {
    const { recognizer, panBy, tap } = createHarness()

    recognizer.pointerDown({ pointerId: 1, point: point(0, 0), onItem: true })
    recognizer.pointerMove(1, point(300, 300))
    recognizer.pointerUp(1, point(300, 300))

    expect(panBy).not.toHaveBeenCalled()
    expect(tap).not.toHaveBeenCalled()
  })

  it('不认识的 pointerId 一律忽略', () => {
    const { recognizer, panBy, tap } = createHarness()
    recognizer.pointerMove(9, point(500, 500))
    recognizer.pointerUp(9, point(500, 500))
    expect(panBy).not.toHaveBeenCalled()
    expect(tap).not.toHaveBeenCalled()
  })
})

describe('TouchGestureRecognizer：双指捏合', () => {
  it('第二指落下 → 先发一次 pinchStart（作废在途单指手势），此后走逐帧增量', () => {
    const { recognizer, pinchStart, pinchFrame } = createHarness()

    recognizer.pointerDown({ pointerId: 1, point: point(100, 200), onItem: true })
    recognizer.pointerMove(1, point(120, 200))
    recognizer.pointerDown({ pointerId: 2, point: point(300, 200) })

    expect(pinchStart).toHaveBeenCalledTimes(1)
    expect(recognizer.mode).toBe('pinch')
    expect(pinchFrame).not.toHaveBeenCalled()

    // 第一根手指先前已挪到 (120,200)：基准取那时两指的中点与间距
    recognizer.pointerMove(1, point(50, 200))
    expect(pinchFrame).toHaveBeenCalledTimes(1)
    expect(pinchFrame).toHaveBeenCalledWith({
      prevMid: point(210, 200),
      nextMid: point(175, 200),
      prevSpan: 180,
      nextSpan: 250,
    })
  })

  it('抬起一根还剩一根 → pinchEnd 一次，进入 lift；剩余手指不再产生平移或捏合帧', () => {
    const { recognizer, pinchEnd, pinchFrame, panBy } = createHarness()

    recognizer.pointerDown({ pointerId: 1, point: point(100, 200) })
    recognizer.pointerDown({ pointerId: 2, point: point(300, 200) })
    recognizer.pointerMove(1, point(80, 200))
    pinchFrame.mockClear()

    recognizer.pointerUp(2, point(300, 200))
    expect(pinchEnd).toHaveBeenCalledTimes(1)
    expect(recognizer.mode).toBe('lift')

    // 剩那根手指继续乱动：既不能平移，也不能再发捏合帧
    recognizer.pointerMove(1, point(600, 600))
    recognizer.pointerUp(1, point(600, 600))
    expect(pinchFrame).not.toHaveBeenCalled()
    expect(panBy).not.toHaveBeenCalled()
    expect(recognizer.mode).toBe('idle')
  })

  it('lift 之后全部抬手，下一次单指按下可以正常平移', () => {
    const { recognizer, panBy } = createHarness()

    recognizer.pointerDown({ pointerId: 1, point: point(0, 0) })
    recognizer.pointerDown({ pointerId: 2, point: point(100, 0) })
    recognizer.pointerUp(2, point(100, 0))
    recognizer.pointerUp(1, point(0, 0))

    recognizer.pointerDown({ pointerId: 3, point: point(40, 40) })
    recognizer.pointerMove(3, point(140, 40))
    expect(recognizer.mode).toBe('pan')
    expect(panBy).toHaveBeenLastCalledWith(100, 0)
  })

  it('三指按下不会重复发 pinchStart，仍按最早的两指算几何', () => {
    const { recognizer, pinchStart, pinchFrame } = createHarness()

    recognizer.pointerDown({ pointerId: 1, point: point(0, 0) })
    recognizer.pointerDown({ pointerId: 2, point: point(200, 0) })
    recognizer.pointerDown({ pointerId: 3, point: point(400, 400) })
    expect(pinchStart).toHaveBeenCalledTimes(1)

    recognizer.pointerMove(1, point(-100, 0))
    const frame = pinchFrame.mock.calls[0][0]
    // 只取最早的两根（id 1 / id 2），第三根不参与
    expect(frame.prevSpan).toBe(200)
    expect(frame.nextSpan).toBe(300)
  })

  it('捏合中抬起一根但仍有两指 → 不结束，只重设上一帧基准', () => {
    const { recognizer, pinchEnd, pinchFrame } = createHarness()

    recognizer.pointerDown({ pointerId: 1, point: point(0, 0) })
    recognizer.pointerDown({ pointerId: 2, point: point(200, 0) })
    recognizer.pointerDown({ pointerId: 3, point: point(400, 0) })
    recognizer.pointerUp(1, point(0, 0))

    expect(pinchEnd).not.toHaveBeenCalled()
    expect(recognizer.mode).toBe('pinch')

    pinchFrame.mockClear()
    recognizer.pointerMove(2, point(100, 0))
    expect(pinchFrame).toHaveBeenCalledWith({
      prevMid: point(300, 0),
      nextMid: point(250, 0),
      prevSpan: 200,
      nextSpan: 300,
    })
  })
})

describe('TouchGestureRecognizer：长按', () => {
  it('按住不动到点 → 发 onLongPress 并进入 consumed，抬手不再发 tap', () => {
    const { recognizer, timer, longPress, tap } = createHarness()

    recognizer.pointerDown({ pointerId: 1, point: point(30, 40) })
    timer.advance(LONG_PRESS_MS)
    expect(longPress).toHaveBeenCalledWith(point(30, 40))
    expect(recognizer.mode).toBe('consumed')

    recognizer.pointerUp(1, point(30, 40))
    expect(tap).not.toHaveBeenCalled()
  })

  it('长按触发前就拖出容差 → 不再触发，且平移照常', () => {
    const { recognizer, timer, longPress, panBy } = createHarness()

    recognizer.pointerDown({ pointerId: 1, point: point(0, 0) })
    recognizer.pointerMove(1, point(60, 0))
    timer.advance(LONG_PRESS_MS)

    expect(longPress).not.toHaveBeenCalled()
    expect(panBy).toHaveBeenCalledWith(60, 0)
  })

  it('长按期间第二指落下 → 长按作废（要捏合，不要菜单）', () => {
    const { recognizer, timer, longPress, pinchStart } = createHarness()

    recognizer.pointerDown({ pointerId: 1, point: point(0, 0) })
    recognizer.pointerDown({ pointerId: 2, point: point(200, 0) })
    expect(pinchStart).toHaveBeenCalledTimes(1)

    timer.advance(LONG_PRESS_MS)
    expect(longPress).not.toHaveBeenCalled()
  })

  it('「选择模式」按下不弹长按、也不平移（整根手指交给框选）', () => {
    const { recognizer, timer, longPress, panBy, tap } = createHarness()

    recognizer.pointerDown({ pointerId: 1, point: point(0, 0), marquee: true })
    recognizer.pointerMove(1, point(200, 200))
    timer.advance(LONG_PRESS_MS)
    recognizer.pointerUp(1, point(200, 200))

    expect(longPress).not.toHaveBeenCalled()
    expect(panBy).not.toHaveBeenCalled()
    expect(tap).not.toHaveBeenCalled()
  })
})

describe('TouchGestureRecognizer：取消与复位', () => {
  it('捏合中某根手指 pointercancel → 视作提前抬手（pinchEnd 照发）', () => {
    const { recognizer, pinchEnd } = createHarness()

    recognizer.pointerDown({ pointerId: 1, point: point(0, 0) })
    recognizer.pointerDown({ pointerId: 2, point: point(100, 0) })
    recognizer.pointerCancel(2)

    expect(pinchEnd).toHaveBeenCalledTimes(1)
    expect(recognizer.mode).toBe('lift')
  })

  it('单指取消 → 不发 tap、状态回 idle', () => {
    const { recognizer, tap } = createHarness()

    recognizer.pointerDown({ pointerId: 1, point: point(0, 0) })
    recognizer.pointerCancel(1)
    expect(tap).not.toHaveBeenCalled()
    expect(recognizer.mode).toBe('idle')
    expect(recognizer.trackedPointerCount).toBe(0)
  })

  it('reset() 丢弃一切在途状态（视口被外部改动时用）', () => {
    const { recognizer, timer, longPress } = createHarness()

    recognizer.pointerDown({ pointerId: 1, point: point(0, 0) })
    recognizer.reset()
    timer.advance(LONG_PRESS_MS)
    expect(longPress).not.toHaveBeenCalled()
    expect(recognizer.mode).toBe('idle')
  })
})
