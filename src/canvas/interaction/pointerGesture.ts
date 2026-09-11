// ============================================================================
// 模块说明（中文）
// 指针手势判定（点击 vs 拖拽）。对应开发计划书 5.1 与 17.4 的强制规则：
//
//   在空白处按下鼠标 → 记录起点
//      ├─ 移动距离 >  4px      → 判定为「拖拽」→ 平移画布
//      └─ 移动距离 ≤ 4px 且松手 → 判定为「单击」→ 取消选中
//
// 卡片上同理：≤ 4px 视为单击（选中），> 4px 视为拖拽（移动）。
// 没有这条判定，「单击空白取消选中」会被 1px 的手抖误判成平移。
//
// 本模块是纯逻辑（不碰 DOM、不碰 React），Viewport 等组件把原生 PointerEvent 喂进来即可。
//
// 实现任务：T0.12（准备层）。
// ============================================================================

import { distanceBetween } from './coordinates'
import type { Point } from './coordinates'

/**
 * 点击 / 拖拽的判定阈值（CSS 像素）。
 * 5.1 原文：「阈值取 4px（经验值，可调）。低于阈值视为手抖，不算拖拽。」
 */
export const CLICK_DRAG_THRESHOLD_PX = 4

/** 一次手势的最终判定结果 */
export type GestureKind = 'click' | 'drag'

export interface GestureResult {
  kind: GestureKind
  /** 按下点（屏幕坐标） */
  start: Point
  /** 松手点（屏幕坐标） */
  end: Point
  /** 松手点 - 按下点 */
  delta: Point
  /** 松手时的直线距离 */
  distance: number
  /** 手势过程中出现过的最大位移（拖拽锁定的依据） */
  maxDistance: number
  pointerId: number
  button: number
}

export interface PointerGestureOptions {
  /** 判定阈值，默认 4px（5.1） */
  threshold?: number
  /** 位移首次超过阈值、正式进入拖拽时触发一次 */
  onDragStart?: (start: Point) => void
  /** 每次移动都触发；调用方可用 isDragging 决定是否真的处理 */
  onMove?: (delta: Point, current: Point) => void
  /** 松手时触发（无论单击还是拖拽） */
  onEnd?: (result: GestureResult) => void
  /** 手势被取消（pointercancel / 手动 cancel）时触发 */
  onCancel?: () => void
}

/**
 * 手势判定器。一次手势 = begin → move* → end（或 cancel）。
 *
 * 拖拽锁定策略：**只要过程中最大位移超过阈值，整次手势就按拖拽处理** ——
 * 即使松手时又拖回了起点附近，也不会被误判成点击。
 */
export class PointerGesture {
  private readonly threshold: number
  private readonly onDragStart?: (start: Point) => void
  private readonly onMove?: (delta: Point, current: Point) => void
  private readonly onEnd?: (result: GestureResult) => void
  private readonly onCancel?: () => void

  private active = false
  private pointerId = -1
  private button = 0
  private start: Point = { x: 0, y: 0 }
  private maxDistance = 0
  private dragging = false

  constructor(options: PointerGestureOptions = {}) {
    this.threshold = options.threshold ?? CLICK_DRAG_THRESHOLD_PX
    this.onDragStart = options.onDragStart
    this.onMove = options.onMove
    this.onEnd = options.onEnd
    this.onCancel = options.onCancel
  }

  /** 手势是否进行中 */
  get isActive(): boolean {
    return this.active
  }

  /** 是否已锁定为拖拽（位移已超过阈值） */
  get isDragging(): boolean {
    return this.dragging
  }

  /** 当前阈值 */
  get thresholdPx(): number {
    return this.threshold
  }

  /** 按下点（屏幕坐标）。拖拽刚被触发时用它补上"按下 → 当前"的完整位移，避免跳 4px。 */
  get startPoint(): Point {
    return { ...this.start }
  }

  /** 某个 pointerId 是否是当前手势的发起者（避免多指/多设备干扰） */
  isActivePointer(pointerId: number): boolean {
    return this.active && pointerId === this.pointerId
  }

  /**
   * 开始手势。
   * @returns 是否成功开始；已有进行中的手势时返回 false（不覆盖）。
   */
  begin(pointerId: number, button: number, point: Point): boolean {
    if (this.active) return false

    this.active = true
    this.pointerId = pointerId
    this.button = button
    this.start = { ...point }
    this.maxDistance = 0
    this.dragging = false
    return true
  }

  /**
   * 移动。
   * @returns 本次移动后是否处于拖拽状态
   */
  move(pointerId: number, point: Point): boolean {
    if (!this.active || pointerId !== this.pointerId) return false

    const distance = distanceBetween(this.start, point)
    if (distance > this.maxDistance) this.maxDistance = distance

    if (!this.dragging && this.maxDistance > this.threshold) {
      this.dragging = true
      this.onDragStart?.(this.start)
    }

    this.onMove?.({ x: point.x - this.start.x, y: point.y - this.start.y }, { ...point })
    return this.dragging
  }

  /** 结束手势并给出判定结果；没有进行中的手势时返回 null。 */
  end(pointerId: number, point: Point): GestureResult | null {
    if (!this.active || pointerId !== this.pointerId) return null

    const distance = distanceBetween(this.start, point)
    if (distance > this.maxDistance) this.maxDistance = distance

    const result: GestureResult = {
      kind: this.maxDistance > this.threshold ? 'drag' : 'click',
      start: { ...this.start },
      end: { ...point },
      delta: { x: point.x - this.start.x, y: point.y - this.start.y },
      distance,
      maxDistance: this.maxDistance,
      pointerId: this.pointerId,
      button: this.button,
    }

    this.reset()
    this.onEnd?.(result)
    return result
  }

  /** 取消手势（pointercancel / Esc），不产生判定结果 */
  cancel(): void {
    if (!this.active) return
    this.reset()
    this.onCancel?.()
  }

  // -------------------------------------------------------------------------
  // PointerEvent 便捷封装（组件侧少写样板）
  // -------------------------------------------------------------------------

  /** 从原生指针按下事件开始手势 */
  beginFromEvent(event: PointerEvent): boolean {
    return this.begin(event.pointerId, event.button, { x: event.clientX, y: event.clientY })
  }

  /** 从原生指针移动事件推进手势 */
  moveFromEvent(event: PointerEvent): boolean {
    return this.move(event.pointerId, { x: event.clientX, y: event.clientY })
  }

  /** 从原生指针抬起事件结束手势 */
  endFromEvent(event: PointerEvent): GestureResult | null {
    return this.end(event.pointerId, { x: event.clientX, y: event.clientY })
  }

  private reset(): void {
    this.active = false
    this.pointerId = -1
    this.button = 0
    this.maxDistance = 0
    this.dragging = false
  }
}

/**
 * 一次性判定：只看起点与终点（不含过程）。
 * 用于不需要"拖拽锁定"的简单场景；交互主链路请用 PointerGesture。
 */
export function judgeGesture(
  start: Point,
  end: Point,
  threshold: number = CLICK_DRAG_THRESHOLD_PX,
): GestureKind {
  return distanceBetween(start, end) > threshold ? 'drag' : 'click'
}
