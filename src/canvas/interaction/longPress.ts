// ============================================================================
// 模块说明（中文）
// 长按检测（2026-09-21 移动端适配 M2，决策 D4：长按 = 右键菜单）。
//
// 为什么不能直接用浏览器/WebView 的 `contextmenu` 事件：
//   · 画布根容器带 `touch-action: none`（Viewport.tsx），WebView 在禁用默认手势的
//     元素上**不保证**派发 contextmenu（安卓各版本行为不一致）；
//   · 即使派发，时机也是「松手之后」，菜单会弹在手指抬起的位置而不是按住的位置；
//   · 桌面版已有的 contextmenu 链路（Canvas.tsx）必须零改动 —— 它服务鼠标右键。
// 所以移动端自己按「按住不动 N 毫秒」判定，触发后由调用方复用同一套菜单命中逻辑。
//
// 三条判定规则（都写进单测）：
//   ① 按下即开始计时，到点触发一次（不会按住不放就一直重复触发）；
//   ② 计时期间手指移动超过容差 → 本次长按作废（那是在拖动，不是长按）；
//   ③ 触发后到松手前，`hasFired` 保持为真 —— 调用方要用它吞掉随后到达的
//      click / contextmenu，否则长按弹一次菜单、松手又弹一次（或直接取消选中）。
//
// 计时器从外部注入（与 viewportController 同一套路），因此本模块在 node 环境
// 可直接单测，不需要 jsdom。
// ============================================================================

import { distanceBetween } from './coordinates'
import type { Point } from './coordinates'

/** 按住多久算长按（毫秒）。500ms 是安卓原生长按的公认手感基准 */
export const LONG_PRESS_MS = 500

/**
 * 长按期间允许的手指位移（CSS 像素）。
 * 比点击/拖拽的 4px 阈值宽：手指按在屏上本就有 5~8px 的抖动，
 * 卡太紧会导致「想长按却总是变成拖拽」。
 */
export const LONG_PRESS_MOVE_TOLERANCE_PX = 10

export interface LongPressOptions {
  /** 触发延时，默认 500ms */
  delayMs?: number
  /** 位移容差，默认 10px */
  tolerancePx?: number
  /** 计时器（测试注入同步实现） */
  setTimer?: (fn: () => void, ms: number) => number
  /** 清理计时器（测试注入） */
  clearTimer?: (id: number) => void
  /** 长按成立时回调，参数是**按下时的位置**（菜单要弹在按住的地方，不是抬起的地方） */
  onLongPress?: (point: Point) => void
}

export class LongPressDetector {
  private readonly delayMs: number
  private readonly tolerancePx: number
  private readonly setTimer: (fn: () => void, ms: number) => number
  private readonly clearTimer: (id: number) => void
  private readonly onLongPress?: (point: Point) => void

  private pointerId: number | null = null
  private start: Point | null = null
  private timer: number | null = null
  private fired = false

  constructor(options: LongPressOptions = {}) {
    this.delayMs = options.delayMs ?? LONG_PRESS_MS
    this.tolerancePx = options.tolerancePx ?? LONG_PRESS_MOVE_TOLERANCE_PX
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number)
    this.clearTimer = options.clearTimer ?? ((id) => clearTimeout(id))
    this.onLongPress = options.onLongPress
  }

  /** 计时中（已触发或未开始都为 false） */
  get isArmed(): boolean {
    return this.timer !== null
  }

  /** 本次按压是否已经触发过长按 —— 松手前一直保持 true */
  get hasFired(): boolean {
    return this.fired
  }

  /** 当前跟踪的 pointerId（无按压时为 null） */
  get activePointerId(): number | null {
    return this.pointerId
  }

  /** 按下：开始计时。已有按压在进行时不覆盖（第二根手指不该重置计时） */
  begin(pointerId: number, point: Point): void {
    if (this.pointerId !== null) return

    this.pointerId = pointerId
    this.start = { ...point }
    this.fired = false
    this.timer = this.setTimer(() => {
      this.timer = null
      const start = this.start
      if (!start) return
      this.fired = true
      this.onLongPress?.({ ...start })
    }, this.delayMs)
  }

  /**
   * 移动。
   * @returns 本次移动后长按**是否仍然可能成立**（false = 已因移动过大作废）
   */
  move(pointerId: number, point: Point): boolean {
    if (this.pointerId !== pointerId || !this.start) return false
    // 已触发：不再重复触发，也不因移动而撤销（菜单已经弹出来了）
    if (this.fired) return true

    if (distanceBetween(this.start, point) > this.tolerancePx) {
      this.discard()
      return false
    }
    return true
  }

  /**
   * 松手：清理状态。
   * @returns 本次按压是否触发过长按（调用方据此决定要不要吞掉紧随其后的 click）
   */
  end(pointerId: number): boolean {
    if (this.pointerId !== pointerId) return this.fired
    const fired = this.fired
    this.reset()
    return fired
  }

  /** 强制作废（pointercancel / 手势被别的事件抢走，如第二根手指落下） */
  cancel(): void {
    this.reset()
  }

  /** 只清理计时器、保留 fired 状态：供「长按已触发但手指还没抬」的内部转换用 */
  private discard(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer)
      this.timer = null
    }
    this.start = null
    this.pointerId = null
  }

  private reset(): void {
    this.discard()
    this.fired = false
  }
}
