// ============================================================================
// 模块说明（中文）
// 触摸手势状态机（2026-09-21 移动端适配 M2，决策 D4「手势优先 + 兜底按钮」）。
//
// 桌面版的指针链路是「一根指针一套判定」：Viewport.tsx 用 PointerGesture 拖空白平移，
// Card 上的按下交给 cardDragController。这套逻辑在触屏上有三个先天缺陷：
//   ① 它只认一个 pointerId（PointerGesture.begin 已有手势时直接返回 false），
//      所以第二根手指永远进不来 → 没有捏合；
//   ② 单指按在卡片上时，Viewport 早退（不平移也不记手势），长按无人判定；
//   ③ 触屏手指的抖动比鼠标大，直接沿用「≤4px 视为单击」会在抬起时误判成点击。
//
// 因此本模块**只服务 pointerType === 'touch'**：鼠标 / 触控笔继续走原链路，
// 桌面行为零改动（风险红线 R2）。Viewport.tsx 只做两件事 —— 把触摸事件喂进来、
// 把下面这些指令执行出去。
//
// 四种模式与它们的转换（全部有单测锁定）：
//   idle ──第 1 指按下──▶ single ──第 2 指按下──▶ pinch ──抬起至 1 指──▶ lift
//     ▲                      │  └──── 位移超阈值 ───▶ pan（仅空白按下）  │
//     └────── 全部抬起 ──────┴───────────────────────────────────────────┘
//   · `lift` 是一个刻意的「晾手指」状态：捏合结束后往往还剩一根手指在屏上，
//     若让它立刻变成平移，画面会因为最后一帧的捏合位移而猛跳一下；
//   · 长按在 `single` 期间计时（空白和卡片上都计），一旦触发就进入 `consumed`
//     —— 菜单已经弹出，此后既不平移也不发 click，避免「长按弹菜单、松手又取消选中」。
//
// 本模块不碰 DOM、不 import React，计时器与阈值都可注入 → node 环境直接单测。
// ============================================================================

import type { Point } from './coordinates'
import { distanceBetween } from './coordinates'
import { CLICK_DRAG_THRESHOLD_PX } from './pointerGesture'
import { LongPressDetector } from './longPress'
import { pinchMidpoint, pinchSpan } from './pinchZoom'
import type { PinchFrame } from './pinchZoom'

/** 状态机当前模式（暴露出去只为断言与调试，业务不看它） */
export type TouchMode = 'idle' | 'single' | 'pan' | 'pinch' | 'lift' | 'consumed'

/** 按下时的上下文：按在卡片上、还是按在框选模式里 —— 决定要不要平移 / 长按 */
export interface TouchPointerDown {
  pointerId: number
  point: Point
  /** 按下的位置命中了 `data-canvas-item`（卡片 / 分区框）：不平移，但长按照常 */
  onItem?: boolean
  /** 「选择模式」下拖框选：既不平移也不长按，整根手指交给框选控制器 */
  marquee?: boolean
}

export interface TouchGestureCommands {
  /** 单指平移画布（增量 CSS 像素）。跨过阈值那一帧会补上「按下→当前」的完整位移 */
  onPanBy?: (dx: number, dy: number) => void
  /** 进入捏合：调用方要立刻取消一切在途的单指手势（拖卡 / 缩放 / 框选 / 连线） */
  onPinchStart?: () => void
  /** 捏合的逐帧输入（两指中点与间距的前后值），调用方据此改视口 */
  onPinchFrame?: (frame: PinchFrame) => void
  /** 捏合结束（还剩手指在屏上时也会触发一次） */
  onPinchEnd?: () => void
  /** 长按成立，参数是按下位置 */
  onLongPress?: (point: Point) => void
  /** 空白处「点一下」：位移未超阈值且没长按 —— 取消选中 */
  onTap?: (point: Point) => void
}

export interface TouchGestureRecognizerOptions extends TouchGestureCommands {
  /** 平移 / 点击阈值，默认沿用 5.1 的 4px（真机手感需要调时只改这一处） */
  threshold?: number
  /** 长按时长与计时器注入，见 longPress.ts */
  longPressMs?: number
  setTimer?: (fn: () => void, ms: number) => number
  clearTimer?: (id: number) => void
}

/** 一根在屏手指 */
interface TrackedPointer {
  point: Point
  /** 这根手指是否被允许驱动单指平移（空白按下才允许） */
  canPan: boolean
}

export class TouchGestureRecognizer {
  private readonly threshold: number
  private readonly onPanBy?: (dx: number, dy: number) => void
  private readonly onPinchStart?: () => void
  private readonly onPinchFrame?: (frame: PinchFrame) => void
  private readonly onPinchEnd?: () => void
  private readonly onLongPress?: (point: Point) => void
  private readonly onTap?: (point: Point) => void
  private readonly longPress: LongPressDetector

  private readonly pointers = new Map<number, TrackedPointer>()
  private currentMode: TouchMode = 'idle'
  /** 主指针（第一根落下的手指）：单指平移与点击都以它为基准 */
  private primaryId: number | null = null
  private start: Point = { x: 0, y: 0 }
  private last: Point = { x: 0, y: 0 }
  /** 上一帧的两指几何，用于算逐帧增量 */
  private prevMid: Point | null = null
  private prevSpan = 0

  constructor(options: TouchGestureRecognizerOptions = {}) {
    this.threshold = options.threshold ?? CLICK_DRAG_THRESHOLD_PX
    this.onPanBy = options.onPanBy
    this.onPinchStart = options.onPinchStart
    this.onPinchFrame = options.onPinchFrame
    this.onPinchEnd = options.onPinchEnd
    this.onLongPress = options.onLongPress
    this.onTap = options.onTap
    this.longPress = new LongPressDetector({
      delayMs: options.longPressMs,
      setTimer: options.setTimer,
      clearTimer: options.clearTimer,
      onLongPress: (point) => {
        this.currentMode = 'consumed'
        this.onLongPress?.(point)
      },
    })
  }

  get mode(): TouchMode {
    return this.currentMode
  }

  get isPinching(): boolean {
    return this.currentMode === 'pinch'
  }

  /** 当前在屏触摸点数量（调试与测试用） */
  get trackedPointerCount(): number {
    return this.pointers.size
  }

  // -------------------------------------------------------------------------
  // 事件入口（Viewport 直接把原生 PointerEvent 的关键字段喂进来）
  // -------------------------------------------------------------------------

  pointerDown({ pointerId, point, onItem = false, marquee = false }: TouchPointerDown): void {
    if (this.pointers.has(pointerId)) return

    this.pointers.set(pointerId, { point: { ...point }, canPan: !onItem && !marquee })

    if (this.pointers.size === 1) {
      this.primaryId = pointerId
      this.start = { ...point }
      this.last = { ...point }
      this.currentMode = 'single'
      // 框选模式不弹长按菜单：那根手指是留给拖框的
      if (!marquee) this.longPress.begin(pointerId, point)
      return
    }

    // 第 2 指落下 → 转捏合，先把手上的单指手势全部作废；
    // 第 3 指及以后只登记不重新入场 —— 捏合几何始终用**最早落下的两根**，
    // 否则多指乱按时基准会被反复重置，画面跟着抖。
    if (this.currentMode !== 'pinch') this.enterPinch()
  }

  pointerMove(pointerId: number, point: Point): void {
    const tracked = this.pointers.get(pointerId)
    if (!tracked) return

    if (this.currentMode === 'pinch') {
      const frame = this.advancePinch(tracked, point)
      if (frame) this.onPinchFrame?.(frame)
      return
    }

    // `lift` / `consumed`：剩在屏上的手指不再产生任何画布动作
    if (this.currentMode === 'lift' || this.currentMode === 'consumed') return

    tracked.point = { ...point }
    this.longPress.move(pointerId, point)
    if (this.longPress.hasFired) return

    if (pointerId !== this.primaryId) return

    if (!tracked.canPan) {
      // 按在卡片 / 框选上：位移由卡片拖拽控制器或框选自己处理，这里只维护 last
      this.last = { ...point }
      return
    }

    if (this.currentMode === 'single') {
      if (distanceBetween(this.start, point) <= this.threshold) {
        this.last = { ...point }
        return
      }
      this.currentMode = 'pan'
      // 刚跨阈值：补上「按下 → 当前」的整段位移，避免画面先僵 4px 再跳
      this.onPanBy?.(point.x - this.start.x, point.y - this.start.y)
      this.last = { ...point }
      return
    }

    this.onPanBy?.(point.x - this.last.x, point.y - this.last.y)
    this.last = { ...point }
  }

  pointerUp(pointerId: number, point: Point): void {
    const tracked = this.pointers.get(pointerId)
    if (!tracked) return

    if (this.currentMode === 'pinch') {
      this.longPress.cancel()
      // 抬手的那根手指先按当前坐标定稿，再决定是继续捏（还剩 ≥2）还是收尾
      tracked.point = { ...point }
      this.pointers.delete(pointerId)
      if (this.pointers.size >= 2) {
        this.rebasePinch()
        return
      }
      this.exitPinch()
      return
    }

    const fired = this.longPress.end(pointerId)
    const wasTap =
      this.currentMode === 'single' &&
      tracked.canPan &&
      pointerId === this.primaryId &&
      !fired &&
      distanceBetween(this.start, point) <= this.threshold

    this.pointers.delete(pointerId)
    if (this.pointers.size === 0) {
      this.reset()
    } else {
      // 还剩手指：一律进 lift 晾着（唯一可能是某个手指被系统吞了抬起，
      // 此时若让它接棒平移，画面会因为丢掉的位移而猛跳一下）
      this.primaryId = null
      this.currentMode = 'lift'
    }

    if (wasTap) this.onTap?.({ ...point })
  }

  pointerCancel(pointerId: number): void {
    if (!this.pointers.has(pointerId)) return
    this.pointers.delete(pointerId)
    if (this.pointers.size >= 2) {
      this.rebasePinch()
      return
    }
    if (this.currentMode === 'pinch') {
      this.exitPinch()
      return
    }
    this.longPress.cancel()
    this.reset()
  }

  /** 视口被外部改动（滚轮、快捷键、切换空间）时丢弃在途手势 */
  reset(): void {
    this.longPress.cancel()
    this.pointers.clear()
    this.currentMode = 'idle'
    this.primaryId = null
    this.prevMid = null
    this.prevSpan = 0
  }

  // -------------------------------------------------------------------------
  // 内部：捏合
  // -------------------------------------------------------------------------

  private enterPinch(): void {
    this.longPress.cancel()
    this.currentMode = 'pinch'
    this.onPinchStart?.()
    this.rebasePinch()
  }

  /** 以当前在屏手指重设「上一帧」基准 */
  private rebasePinch(): void {
    const [a, b] = [...this.pointers.values()].slice(0, 2)
    if (!a || !b) {
      this.prevMid = null
      this.prevSpan = 0
      return
    }
    this.prevMid = pinchMidpoint(a.point, b.point)
    this.prevSpan = pinchSpan(a.point, b.point)
  }

  /** 更新被移动的那根手指，并给出这一帧的捏合增量 */
  private advancePinch(tracked: TrackedPointer, point: Point): PinchFrame | null {
    const prevMid = this.prevMid
    if (!prevMid) {
      tracked.point = { ...point }
      this.rebasePinch()
      return null
    }
    const prevSpan = this.prevSpan

    tracked.point = { ...point }
    const [a, b] = [...this.pointers.values()].slice(0, 2)
    if (!a || !b) return null

    const nextMid = pinchMidpoint(a.point, b.point)
    const nextSpan = pinchSpan(a.point, b.point)
    this.prevMid = nextMid
    this.prevSpan = nextSpan
    return { prevMid, nextMid, prevSpan, nextSpan }
  }

  private exitPinch(): void {
    this.onPinchEnd?.()
    this.prevMid = null
    this.prevSpan = 0
    // 还有手指在屏上 → 进 lift 晾着，不让它接棒平移（否则画面会跳）
    if (this.pointers.size > 0) {
      this.currentMode = 'lift'
      return
    }
    this.reset()
  }
}
