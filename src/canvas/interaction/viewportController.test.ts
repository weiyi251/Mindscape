// ============================================================================
// 模块说明（中文）
// 视口控制器单元测试。对应 17.3「viewport 直接改 DOM transform，不进 React state」：
//   · 变换只写入 el.style.transform（不触碰任何 React 状态）
//   · zoom / offset 是普通字段，可直接读取
//   · 外部通知按帧合并（同一帧内多次变化只回调一次）
//
// node 环境没有真实 DOM，因此用最小 mock 元素承载 style 与 getBoundingClientRect。
//
// 实现任务：T0.11（准备层）。
// ============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest'

import { ViewportController } from '@/canvas/interaction/viewportController'
import type { Scheduler } from '@/canvas/interaction/viewportController'
import { MAX_ZOOM, MIN_ZOOM, ZOOM_OVERSHOOT_LIMIT, screenToCanvas } from '@/canvas/interaction/coordinates'
import type { ViewportState } from '@/canvas/interaction/coordinates'

interface MockElement {
  style: Record<string, string>
  getBoundingClientRect: () => { left: number; top: number; width: number; height: number }
}

function makeElement(left = 0, top = 0, width = 1000, height = 800): MockElement {
  return {
    style: {},
    getBoundingClientRect: () => ({ left, top, width, height }),
  }
}

/**
 * 模拟真实 DOM：stage 被 translate 之后，它的 getBoundingClientRect 会跟着 offset 移动。
 * 这正是「origin 取错元素」会暴露出来的场景。
 */
function makeTranslatedStage(getOffset: () => { x: number; y: number }, baseLeft = 0, baseTop = 0) {
  return {
    style: {},
    getBoundingClientRect: () => ({
      left: baseLeft + getOffset().x,
      top: baseTop + getOffset().y,
    }),
  }
}

/** 同步调度器：立即执行（便于断言回调次数） */
const syncScheduler: Scheduler = (fn) => {
  fn()
  return 1
}

/** 手动调度器：把回调排队，由测试决定何时执行（用于验证帧合并） */
function makeManualScheduler() {
  const queue: Array<() => void> = []
  const scheduler: Scheduler = (fn) => {
    queue.push(fn)
    return queue.length
  }
  return { queue, scheduler, flush: () => queue.shift()?.() }
}

describe('attach / detach', () => {
  it('attach 后写入 transformOrigin 与初始 transform', () => {
    const controller = new ViewportController()
    const el = makeElement()

    controller.attach(el as unknown as HTMLElement)

    expect(controller.isAttached).toBe(true)
    expect(el.style.transformOrigin).toBe('0 0')
    expect(el.style.willChange).toBe('transform')
    expect(el.style.transform).toBe('translate3d(0px, 0px, 0) scale(1)')
  })

  it('detach 后不再写 DOM', () => {
    const controller = new ViewportController()
    const el = makeElement()
    controller.attach(el as unknown as HTMLElement)

    controller.detach()
    el.style.transform = 'untouched'
    controller.panBy(10, 10)

    expect(controller.isAttached).toBe(false)
    expect(el.style.transform).toBe('untouched')
  })

  it('未 attach 时操作不抛错（容错）', () => {
    const controller = new ViewportController()
    expect(() => {
      controller.panBy(5, 5)
      controller.zoomTo(2, { x: 0, y: 0 })
      controller.reset()
    }).not.toThrow()
  })
})

describe('panBy 平移', () => {
  it('累加 offset 并写入 transform', () => {
    const controller = new ViewportController()
    const el = makeElement()
    controller.attach(el as unknown as HTMLElement)

    controller.panBy(30, -20)
    controller.panBy(10, 5)

    expect(controller.offsetX).toBe(40)
    expect(controller.offsetY).toBe(-15)
    expect(el.style.transform).toBe('translate3d(40px, -15px, 0) scale(1)')
  })

  it('零位移不产生额外变换（11.4：零延迟、零漂移）', () => {
    const controller = new ViewportController()
    const el = makeElement()
    controller.attach(el as unknown as HTMLElement)
    el.style.transform = 'sentinel'

    controller.panBy(0, 0)

    expect(el.style.transform).toBe('sentinel')
  })

  it('缩放后平移量仍是 CSS 像素（11.4：任意比例下手感一致）', () => {
    const controller = new ViewportController()
    const el = makeElement()
    controller.attach(el as unknown as HTMLElement)

    controller.zoomTo(3, { x: 0, y: 0 })
    controller.panBy(100, 0)

    expect(controller.offsetX).toBe(100)
    expect(el.style.transform).toContain('scale(3)')
    expect(el.style.transform).toContain('translate3d(100px, 0px, 0)')
  })
})

describe('setState / reset', () => {
  it('setState 覆盖并钳制 zoom', () => {
    const controller = new ViewportController()
    const el = makeElement()
    controller.attach(el as unknown as HTMLElement)

    controller.setState({ zoom: 99, offsetX: 12 })
    expect(controller.zoom).toBe(4)
    expect(controller.offsetX).toBe(12)

    controller.setState({ zoom: 0.01 })
    expect(controller.zoom).toBe(0.1)
  })

  it('reset 回到 100% 与原点（对应 Ctrl+0）', () => {
    const controller = new ViewportController()
    const el = makeElement()
    controller.attach(el as unknown as HTMLElement)

    controller.panBy(200, 100)
    controller.zoomTo(2.5, { x: 0, y: 0 })
    controller.reset()

    expect(controller.getState()).toEqual({ zoom: 1, offsetX: 0, offsetY: 0 })
    expect(el.style.transform).toBe('translate3d(0px, 0px, 0) scale(1)')
  })
})

describe('zoomTo 以鼠标位置为中心', () => {
  it('锚点屏幕坐标对应的画布点保持不动', () => {
    const controller = new ViewportController()
    const el = makeElement()
    controller.attach(el as unknown as HTMLElement)

    const anchor = { x: 400, y: 300 }
    controller.zoomTo(2, anchor)

    // 缩放前锚点下的画布坐标（zoom=1, offset=0, origin=0）就是 (400, 300)
    // 缩放后它应仍在屏幕 (400, 300)：400*2 + offsetX = 400 → offsetX = -400
    expect(controller.offsetX).toBeCloseTo(-400, 6)
    expect(controller.offsetY).toBeCloseTo(-300, 6)
  })

  it('容器不在视口原点时使用 getBoundingClientRect 的结果', () => {
    const controller = new ViewportController()
    const el = makeElement(120, 60)
    controller.attach(el as unknown as HTMLElement)

    const anchor = { x: 520, y: 360 }
    controller.zoomTo(4, anchor)

    // 画布锚点 = (520-120)/1 = 400，同理 y=300
    // offsetX = 520 - 120 - 400*4 = -1200
    expect(controller.offsetX).toBeCloseTo(-1200, 6)
    expect(controller.offsetY).toBeCloseTo(-900, 6)
  })
})

describe('handleWheel', () => {
  it('滚轮上滚放大、下滚缩小', () => {
    const controller = new ViewportController()
    const el = makeElement()
    controller.attach(el as unknown as HTMLElement)

    controller.handleWheel({ deltaY: -100, deltaMode: 0, clientX: 0, clientY: 0 } as WheelEvent)
    const zoomedIn = controller.zoom
    expect(zoomedIn).toBeGreaterThan(1)

    controller.handleWheel({ deltaY: 100, deltaMode: 0, clientX: 0, clientY: 0 } as WheelEvent)
    expect(controller.zoom).toBeCloseTo(1, 6)
  })

  it('line 模式（deltaMode=1）的增量被折算为像素', () => {
    const controller = new ViewportController()
    const el = makeElement()
    controller.attach(el as unknown as HTMLElement)

    controller.handleWheel({ deltaY: -3, deltaMode: 1, clientX: 0, clientY: 0 } as WheelEvent)
    // 折算后等价于 deltaY = -48
    expect(controller.zoom).toBeGreaterThan(1)
    expect(controller.zoom).toBeLessThan(1.2)
  })
})

describe('缩放锚点：origin 必须取未被变换的容器', () => {
  const ANCHOR = { x: 400, y: 300 }
  const ROOT_ORIGIN = { left: 0, top: 0 }

  it('stage 位置随 offset 移动时，连续滚轮缩放锚点仍不漂移（11.3）', () => {
    const controller = new ViewportController({ schedule: syncScheduler })
    const root = makeElement(0, 0)
    const stage = makeTranslatedStage(() => ({ x: controller.offsetX, y: controller.offsetY }))

    controller.attach(stage as unknown as HTMLElement, root as unknown as HTMLElement)

    const before = screenToCanvas(ANCHOR, controller.getState(), ROOT_ORIGIN)

    for (let i = 0; i < 5; i += 1) {
      controller.handleWheel({
        deltaY: -100,
        deltaMode: 0,
        clientX: ANCHOR.x,
        clientY: ANCHOR.y,
      } as WheelEvent)

      const now = screenToCanvas(ANCHOR, controller.getState(), ROOT_ORIGIN)
      expect(now.x).toBeCloseTo(before.x, 6)
      expect(now.y).toBeCloseTo(before.y, 6)
    }

    // 五次上滚后确实放大了
    expect(controller.zoom).toBeGreaterThan(1)
  })

  it('放大后再缩小，锚点同样保持不动', () => {
    const controller = new ViewportController({ schedule: syncScheduler })
    const root = makeElement(0, 0)
    const stage = makeTranslatedStage(() => ({ x: controller.offsetX, y: controller.offsetY }))
    controller.attach(stage as unknown as HTMLElement, root as unknown as HTMLElement)

    const before = screenToCanvas(ANCHOR, controller.getState(), ROOT_ORIGIN)

    for (const deltaY of [-100, -100, 100, 100, 100, -50]) {
      controller.handleWheel({ deltaY, deltaMode: 0, clientX: ANCHOR.x, clientY: ANCHOR.y } as WheelEvent)
      const now = screenToCanvas(ANCHOR, controller.getState(), ROOT_ORIGIN)
      expect(now.x).toBeCloseTo(before.x, 6)
      expect(now.y).toBeCloseTo(before.y, 6)
    }
  })

  it('画布根容器不贴屏幕左上角时同样正确（含容器偏移）', () => {
    const controller = new ViewportController({ schedule: syncScheduler })
    const root = makeElement(120, 60)
    // stage 的实际屏幕位置 = 容器位置 + offset
    const stage = makeTranslatedStage(() => ({ x: controller.offsetX, y: controller.offsetY }), 120, 60)

    controller.attach(stage as unknown as HTMLElement, root as unknown as HTMLElement)

    const containerOrigin = { left: 120, top: 60 }
    const before = screenToCanvas(ANCHOR, controller.getState(), containerOrigin)

    for (let i = 0; i < 4; i += 1) {
      controller.handleWheel({
        deltaY: -100,
        deltaMode: 0,
        clientX: ANCHOR.x,
        clientY: ANCHOR.y,
      } as WheelEvent)

      const now = screenToCanvas(ANCHOR, controller.getState(), containerOrigin)
      expect(now.x).toBeCloseTo(before.x, 6)
      expect(now.y).toBeCloseTo(before.y, 6)
    }
  })

  it('反例守卫：若把 stage 当 origin（省略第二个参数），锚点会漂移', () => {
    // 这条用例固化「曾经出现的 bug」：提醒后人不要退回单参数 attach
    const controller = new ViewportController({ schedule: syncScheduler })
    const stage = makeTranslatedStage(() => ({ x: controller.offsetX, y: controller.offsetY }))
    controller.attach(stage as unknown as HTMLElement)

    const before = screenToCanvas(ANCHOR, controller.getState(), ROOT_ORIGIN)
    controller.handleWheel({ deltaY: -100, deltaMode: 0, clientX: ANCHOR.x, clientY: ANCHOR.y } as WheelEvent)
    controller.handleWheel({ deltaY: -100, deltaMode: 0, clientX: ANCHOR.x, clientY: ANCHOR.y } as WheelEvent)

    const after = screenToCanvas(ANCHOR, controller.getState(), ROOT_ORIGIN)
    expect(Math.abs(after.x - before.x)).toBeGreaterThan(1)
  })

  it('省略第二个参数时退化为以 stage 为参照（保持向后兼容）', () => {
    const controller = new ViewportController({ schedule: syncScheduler })
    const el = makeElement(50, 20)
    controller.attach(el as unknown as HTMLElement)

    expect(controller.getContainerOrigin()).toEqual({ left: 50, top: 20 })
  })
})

describe('onChange 按帧合并', () => {
  let manual: ReturnType<typeof makeManualScheduler>

  beforeEach(() => {
    manual = makeManualScheduler()
  })

  it('同一帧内多次变化只排队一次回调', () => {
    const onChange = vi.fn()
    const controller = new ViewportController({ onChange, schedule: manual.scheduler })
    const el = makeElement()
    controller.attach(el as unknown as HTMLElement)

    controller.panBy(1, 1)
    controller.panBy(1, 1)
    controller.panBy(1, 1)

    expect(onChange).not.toHaveBeenCalled()
    expect(manual.queue).toHaveLength(1)

    manual.flush()
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ zoom: 1, offsetX: 3, offsetY: 3 })
  })

  it('回调执行后可以再次排队（下一帧）', () => {
    const onChange = vi.fn()
    const controller = new ViewportController({ onChange, schedule: manual.scheduler })
    controller.attach(makeElement() as unknown as HTMLElement)

    controller.panBy(1, 1)
    manual.flush()
    controller.panBy(1, 1)

    expect(manual.queue).toHaveLength(1)
    manual.flush()
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('同步调度器下每次变化都会通知（回调拿到的始终是最新状态）', () => {
    const states: ViewportState[] = []
    const controller = new ViewportController({
      onChange: (state) => states.push(state),
      schedule: syncScheduler,
    })
    controller.attach(makeElement() as unknown as HTMLElement)

    // attach 时的一次初始通知不计入本用例
    states.length = 0

    controller.panBy(5, 0)
    controller.setState({ zoom: 2 })

    expect(states).toEqual([
      { zoom: 1, offsetX: 5, offsetY: 0 },
      { zoom: 2, offsetX: 5, offsetY: 0 },
    ])
  })

  it('未提供 onChange 时不会抛错', () => {
    const controller = new ViewportController({ schedule: syncScheduler })
    controller.attach(makeElement() as unknown as HTMLElement)
    expect(() => controller.panBy(1, 1)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// T1.5：缩放边界阻尼与回弹（11.3「到边界有阻尼感」）
// ---------------------------------------------------------------------------

/** 手动定时器：把回弹延时排队，由测试决定何时触发 */
function makeManualTimer() {
  const pending = new Map<number, () => void>()
  let nextId = 1

  return {
    setTimer: (fn: () => void) => {
      const id = nextId
      nextId += 1
      pending.set(id, fn)
      return id
    },
    clearTimer: (id: number) => {
      pending.delete(id)
    },
    pendingCount: () => pending.size,
    /** 执行所有排队中的定时器（回弹动画本身走同步 scheduler，会一次跑完） */
    runAll: () => {
      while (pending.size > 0) {
        const [id, fn] = [...pending.entries()][0]
        pending.delete(id)
        fn()
      }
    },
  }
}

function wheel(deltaY: number, clientX = 0, clientY = 0): WheelEvent {
  return { deltaY, deltaMode: 0, clientX, clientY } as WheelEvent
}

describe('缩放边界阻尼（T1.5）', () => {
  it('滚到上限后继续滚：还能推进一点点，但最多越界 8%', () => {
    const timer = makeManualTimer()
    const controller = new ViewportController({
      schedule: syncScheduler,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    })
    const el = makeElement()
    controller.attach(el as unknown as HTMLElement, el as unknown as HTMLElement)

    for (let i = 0; i < 30; i += 1) controller.handleWheel(wheel(-100))

    expect(controller.zoom).toBeGreaterThan(MAX_ZOOM)
    expect(controller.zoom).toBeLessThanOrEqual(MAX_ZOOM * (1 + ZOOM_OVERSHOOT_LIMIT) + 1e-9)
    // 越界时已安排回弹
    expect(timer.pendingCount()).toBe(1)
  })

  it('滚到下限后继续滚：同样有阻尼', () => {
    const timer = makeManualTimer()
    const controller = new ViewportController({
      schedule: syncScheduler,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    })
    const el = makeElement()
    controller.attach(el as unknown as HTMLElement, el as unknown as HTMLElement)

    for (let i = 0; i < 40; i += 1) controller.handleWheel(wheel(100))

    expect(controller.zoom).toBeLessThan(MIN_ZOOM)
    expect(controller.zoom).toBeGreaterThanOrEqual(MIN_ZOOM * (1 - ZOOM_OVERSHOOT_LIMIT) - 1e-9)
    expect(timer.pendingCount()).toBe(1)
  })

  it('停手后回弹到边界（11.3 的 10% ~ 400% 仍然是最终范围）', () => {
    const timer = makeManualTimer()
    const controller = new ViewportController({
      schedule: syncScheduler,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    })
    const el = makeElement()
    controller.attach(el as unknown as HTMLElement, el as unknown as HTMLElement)

    for (let i = 0; i < 30; i += 1) controller.handleWheel(wheel(-100))
    expect(controller.zoom).toBeGreaterThan(MAX_ZOOM)

    timer.runAll()

    expect(controller.zoom).toBeCloseTo(MAX_ZOOM, 6)
    expect(el.style.transform).toContain(`scale(${MAX_ZOOM})`)
  })

  it('回弹以视口中心为锚点，画面不漂移', () => {
    const timer = makeManualTimer()
    const controller = new ViewportController({
      schedule: syncScheduler,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    })
    const el = makeElement(0, 0, 1000, 800)
    controller.attach(el as unknown as HTMLElement, el as unknown as HTMLElement)

    // 先平移到画布中间某个位置，让"视口中心"对应的画布点不在原点
    controller.panBy(-300, -200)
    for (let i = 0; i < 30; i += 1) controller.handleWheel(wheel(-100, 500, 400))

    const origin = controller.getContainerOrigin()
    const size = controller.getViewportSize()
    const center = { x: origin.left + size.width / 2, y: origin.top + size.height / 2 }
    const before = screenToCanvas(center, controller.getState(), origin)

    timer.runAll()

    const after = screenToCanvas(center, controller.getState(), origin)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  it('未越界时不安排任何回弹', () => {
    const timer = makeManualTimer()
    const controller = new ViewportController({
      schedule: syncScheduler,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    })
    const el = makeElement()
    controller.attach(el as unknown as HTMLElement, el as unknown as HTMLElement)

    controller.handleWheel(wheel(-50))
    controller.handleWheel(wheel(20))

    expect(controller.zoom).toBeLessThan(MAX_ZOOM)
    expect(controller.zoom).toBeGreaterThan(MIN_ZOOM)
    expect(timer.pendingCount()).toBe(0)
  })

  it('新的滚轮操作取消前一次待回弹（不会把视图拽回旧目标）', () => {
    const timer = makeManualTimer()
    const controller = new ViewportController({
      schedule: syncScheduler,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    })
    const el = makeElement()
    controller.attach(el as unknown as HTMLElement, el as unknown as HTMLElement)

    for (let i = 0; i < 30; i += 1) controller.handleWheel(wheel(-100))
    expect(timer.pendingCount()).toBe(1)

    // 反向滚回合法范围
    controller.handleWheel(wheel(1000))

    expect(controller.zoom).toBeLessThan(MAX_ZOOM)
    expect(timer.pendingCount()).toBe(0)
  })

  it('reset / setState 会清掉待回弹（避免 Ctrl+0 之后又被拽回去）', () => {
    const timer = makeManualTimer()
    const controller = new ViewportController({
      schedule: syncScheduler,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    })
    const el = makeElement()
    controller.attach(el as unknown as HTMLElement, el as unknown as HTMLElement)

    for (let i = 0; i < 30; i += 1) controller.handleWheel(wheel(-100))
    expect(timer.pendingCount()).toBe(1)

    controller.reset()
    expect(timer.pendingCount()).toBe(0)
    expect(controller.getState()).toEqual({ zoom: 1, offsetX: 0, offsetY: 0 })

    // setState 同理
    for (let i = 0; i < 30; i += 1) controller.handleWheel(wheel(-100))
    controller.setState({ zoom: 2 })
    expect(timer.pendingCount()).toBe(0)
  })

  it('detach 后待回弹被清掉，不会对已卸载的视图做动画', () => {
    const timer = makeManualTimer()
    const controller = new ViewportController({
      schedule: syncScheduler,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    })
    const el = makeElement()
    controller.attach(el as unknown as HTMLElement, el as unknown as HTMLElement)

    for (let i = 0; i < 30; i += 1) controller.handleWheel(wheel(-100))
    controller.detach()

    expect(timer.pendingCount()).toBe(0)
  })
})
