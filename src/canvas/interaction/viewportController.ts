// ============================================================================
// 模块说明（中文）
// 视口控制器（非 React）。对应开发计划书 17.3 的核心决策：
//
//   「viewport 同理：缩放/平移直接改画布根容器的 transform，不进 React state。」
//
// 本类持有 zoom / offsetX / offsetY 三个**普通字段**（不是 React state），
// 每次变化只做两件事：
//   1. 直接写 `el.style.transform`（GPU 合成，不触发重排、不触发 React 重渲染）
//   2. 通过 onChange 回调**按帧合并**地通知外部（用于显示缩放百分比这类低频 UI）
//
// 之所以不用 React state：滚轮/平移每帧都在变，走 setState 会让整棵画布子树 diff，
// 必然掉帧（见 17.11 反模式清单第一条）。
//
// ⚠️ 两个元素要分清（否则「以鼠标位置为中心缩放」必然偏移）：
//   · stageEl   —— 被写 transform 的世界层。它自身的位置**会随 offset 变化**。
//   · originEl  —— 未变换的画布根容器，只用于取「画布容器左上角」。
//   17.4 的公式 `画布坐标 = (屏幕坐标 - 画布容器左上角 - offset) / zoom` 里，
//   「画布容器左上角」必须是**不随 offset 变化**的那个容器位置。
//   若误用 stageEl 取 rect，offset 会被重复扣减：首次缩放看起来正常，
//   第二次起锚点持续漂移 —— 这正是「缩放不以鼠标为中心」的根因。
//
// ⚠️ 缩放边界阻尼（11.3「到边界有阻尼感」，T1.5）：
//   滚轮把 zoom 推到 10% / 400% 边界后**还能再推一点点**（越界部分被 dampZoom 衰减，
//   最多越界 8%），停手 140ms 后自动回弹到边界。这样用户能感觉到"到头了"，
//   而不是"滚轮坏了"。回弹以视口中心为锚点，不会造成画面漂移。
//
// 本模块不 import React，可在 node 环境直接单测（注入同步 scheduler / timer）。
//
// 实现任务：T0.11（准备层）/ T1.5（边界阻尼与回弹）。
// ============================================================================

import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  dampZoom,
  wheelZoomTarget,
  zoomAroundScreenPoint,
} from './coordinates'
import type { ContainerOrigin, Point, ViewportState } from './coordinates'
import { fitViewportState } from './fitToContent'
import type { Rect } from '@/core/geometry/rect'

/** 判断「是否越界」时留的浮点余量，避免合法值被误判成越界而触发无谓回弹 */
const ZOOM_EPSILON = 1e-6
const MIN_ZOOM_SAFE = MIN_ZOOM + ZOOM_EPSILON
const MAX_ZOOM_SAFE = MAX_ZOOM - ZOOM_EPSILON

/** 调度器：默认 requestAnimationFrame，测试注入同步实现 */
export type Scheduler = (fn: () => void) => number
/** 定时器：默认 setTimeout（回弹延时用），测试注入同步实现 */
export type TimerScheduler = (fn: () => void, ms: number) => number
/** 定时器清理：默认 clearTimeout */
export type TimerClearer = (id: number) => void

/** 越界后等待多久开始回弹（毫秒）。太短会打断连续滚轮，太长会让人觉得卡住 */
const ZOOM_SETTLE_DELAY_MS = 140
/** 回弹补间步数（按帧调度，配合 rAF 约 10 帧 ≈ 160ms） */
const ZOOM_SETTLE_STEPS = 10
/** 每步推进剩余距离的比例（越大回弹越快） */
const ZOOM_SETTLE_RATIO = 0.28

const defaultScheduler: Scheduler = (fn) => {
  if (typeof requestAnimationFrame === 'function') {
    return requestAnimationFrame(() => fn())
  }
  return setTimeout(fn, 16) as unknown as number
}

const defaultSetTimer: TimerScheduler = (fn, ms) => setTimeout(fn, ms) as unknown as number

const defaultClearTimer: TimerClearer = (id) => clearTimeout(id)

export interface ViewportControllerOptions {
  /** 视口变化回调（一帧最多一次），用于更新缩放百分比等低频 UI */
  onChange?: (state: ViewportState) => void
  /** 调度器（测试用） */
  schedule?: Scheduler
  /** 延时调度（测试用） */
  setTimer?: TimerScheduler
  /** 定时器清理（测试用） */
  clearTimer?: TimerClearer
}

/** 滚轮事件归一化：把 line / page 模式的增量折算成像素 */
function normalizeWheelDelta(event: WheelEvent): number {
  if (event.deltaMode === 1) return event.deltaY * 16
  if (event.deltaMode === 2) return event.deltaY * 100
  return event.deltaY
}

export class ViewportController {
  private el: HTMLElement | null = null
  private originEl: HTMLElement | null = null
  private readonly onChange?: (state: ViewportState) => void
  private readonly schedule: Scheduler
  private readonly setTimer: TimerScheduler
  private readonly clearTimer: TimerClearer
  private pendingFrame = false

  /** 回弹批次号：任何新操作都会让它自增，从而让进行中的回弹动画自行退出 */
  private settleToken = 0
  private settleTimer: number | null = null

  /** 当前缩放（1 = 100%） */
  zoom = 1
  /** 画布原点在容器内的平移量（CSS 像素） */
  offsetX = 0
  offsetY = 0

  constructor(options: ViewportControllerOptions = {}) {
    this.onChange = options.onChange
    this.schedule = options.schedule ?? defaultScheduler
    this.setTimer = options.setTimer ?? defaultSetTimer
    this.clearTimer = options.clearTimer ?? defaultClearTimer
  }

  // -------------------------------------------------------------------------
  // 生命周期
  // -------------------------------------------------------------------------

  /**
   * 绑定画布元素。
   * @param stageEl  被写 transform 的世界层（transformOrigin 必须是 `0 0`，
   *                 否则坐标换算公式不成立）
   * @param originEl 取「画布容器左上角」的参照容器，**必须是不随 offset 移动的元素**
   *                 （通常就是画布根容器）。省略时退化为 stageEl —— 仅在 stageEl
   *                 从不平移的场景下才正确。
   */
  attach(stageEl: HTMLElement, originEl?: HTMLElement): void {
    this.el = stageEl
    this.originEl = originEl ?? stageEl
    stageEl.style.transformOrigin = '0 0'
    stageEl.style.willChange = 'transform'
    this.applyTransform()
  }

  detach(): void {
    this.cancelSettle()
    this.el = null
    this.originEl = null
  }

  get isAttached(): boolean {
    return this.el !== null
  }

  // -------------------------------------------------------------------------
  // 状态读写
  // -------------------------------------------------------------------------

  getState(): ViewportState {
    return { zoom: this.zoom, offsetX: this.offsetX, offsetY: this.offsetY }
  }

  /** 用外部状态覆盖（从 layout.json 恢复视图，或 Ctrl+0 复原） */
  setState(state: Partial<ViewportState>): void {
    this.cancelSettle()
    if (state.zoom !== undefined) this.zoom = clampZoom(state.zoom)
    if (state.offsetX !== undefined) this.offsetX = state.offsetX
    if (state.offsetY !== undefined) this.offsetY = state.offsetY
    this.applyTransform()
  }

  /**
   * 「画布容器左上角」在屏幕坐标中的位置。
   * ⚠️ 取的是参照容器（未被变换的那个），不是 stage —— 详见文件顶部的说明。
   * 前提：画布根容器自身没有 border / padding（stage 以 absolute left-0 top-0 贴合它）。
   */
  getContainerOrigin(): ContainerOrigin {
    const el = this.originEl
    if (!el) return { left: 0, top: 0 }
    const rect = el.getBoundingClientRect()
    return { left: rect.left, top: rect.top }
  }

  /** 可见容器尺寸（回弹时用来算视口中心）。拿不到尺寸时返回 0，交由调用方退化处理 */
  getViewportSize(): { width: number; height: number } {
    const el = this.originEl
    if (!el) return { width: 0, height: 0 }
    const rect = el.getBoundingClientRect()
    return {
      width: Number.isFinite(rect.width) ? rect.width : 0,
      height: Number.isFinite(rect.height) ? rect.height : 0,
    }
  }

  // -------------------------------------------------------------------------
  // 变换
  // -------------------------------------------------------------------------

  /** 把当前 zoom/offset 写入 DOM（唯一的高频 DOM 写入点） */
  applyTransform(): void {
    if (this.el) {
      this.el.style.transform = `translate3d(${this.offsetX}px, ${this.offsetY}px, 0) scale(${this.zoom})`
    }
    this.notify()
  }

  /** 平移（增量，CSS 像素）。11.4：平移速度与缩放无关，因为它作用在容器 transform 上。 */
  panBy(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return
    this.offsetX += dx
    this.offsetY += dy
    this.applyTransform()
  }

  /** 以屏幕点为锚点缩放到指定倍率（11.3：以鼠标位置为中心）。越界会触发阻尼回弹。 */
  zoomTo(nextZoom: number, anchorScreen: Point, origin?: ContainerOrigin): void {
    this.applyZoom(nextZoom, anchorScreen, origin ?? this.getContainerOrigin(), true)
    this.scheduleSettle()
  }

  /** 处理滚轮：以鼠标位置为中心缩放，并在边界处带阻尼。调用方负责 preventDefault（需 passive: false）。 */
  handleWheel(event: WheelEvent): void {
    // 注意：这里**不能**用 zoomFromWheelDelta —— 它会把越界信息 clamp 掉，
    // 阻尼就永远看不到效果。先取未钳制的目标，再交给 dampZoom 做边界衰减。
    const target = dampZoom(wheelZoomTarget(this.zoom, normalizeWheelDelta(event)))
    this.applyZoom(target, { x: event.clientX, y: event.clientY }, this.getContainerOrigin(), false)
    this.scheduleSettle()
  }

  /** 复原视图：缩放 100%、回到原点（对应 Ctrl+0） */
  reset(): void {
    this.cancelSettle()
    this.zoom = 1
    this.offsetX = 0
    this.offsetY = 0
    this.applyTransform()
  }

  /**
   * 缩放到全部内容（P1-4，主快捷键 Ctrl+Alt+0）：把给定矩形集合的包围盒适配进当前视口。
   * 与滚轮路径一样**直写 style.transform**，不经过 React state（守 17.3）。
   * 没有内容 / 视口尺寸非法时不动当前视图，返回 false 供调用方提示。
   */
  fitToContent(rects: readonly Rect[]): boolean {
    const size = this.getViewportSize()
    const next = fitViewportState(rects, { width: size.width, height: size.height })
    if (!next) return false
    this.cancelSettle()
    this.zoom = next.zoom
    this.offsetX = next.offsetX
    this.offsetY = next.offsetY
    this.applyTransform()
    return true
  }

  // -------------------------------------------------------------------------
  // 内部：缩放写入
  // -------------------------------------------------------------------------

  /**
   * 写入缩放。clamp 仅在"外部直接指定倍率"时为 true；
   * 阻尼路径必须传 false，否则 dampZoom 造出的越界量会被钳回去。
   */
  private applyZoom(
    targetZoom: number,
    anchorScreen: Point,
    origin: ContainerOrigin,
    clamp: boolean,
  ): void {
    const next = zoomAroundScreenPoint(this.getState(), targetZoom, anchorScreen, origin, {
      clamp,
    })
    this.zoom = next.zoom
    this.offsetX = next.offsetX
    this.offsetY = next.offsetY
    this.applyTransform()
  }

  // -------------------------------------------------------------------------
  // 内部：边界阻尼回弹
  // -------------------------------------------------------------------------

  /** 缩放落点越界时，安排一次延时回弹；在合法范围内则取消既有回弹 */
  private scheduleSettle(): void {
    this.cancelSettle()
    if (this.zoom >= MIN_ZOOM_SAFE && this.zoom <= MAX_ZOOM_SAFE) return

    const token = this.settleToken
    this.settleTimer = this.setTimer(() => {
      this.settleTimer = null
      if (token !== this.settleToken) return
      this.animateSettle(clampZoom(this.zoom), ZOOM_SETTLE_STEPS, token)
    }, ZOOM_SETTLE_DELAY_MS)
  }

  private cancelSettle(): void {
    this.settleToken += 1
    if (this.settleTimer !== null) {
      this.clearTimer(this.settleTimer)
      this.settleTimer = null
    }
  }

  /** 以视口中心为锚点，把越界的缩放平滑拉回合法范围 */
  private animateSettle(target: number, remaining: number, token: number): void {
    if (token !== this.settleToken) return

    const next = remaining <= 1 ? target : this.zoom + (target - this.zoom) * ZOOM_SETTLE_RATIO
    const origin = this.getContainerOrigin()
    const size = this.getViewportSize()
    const center: Point = { x: origin.left + size.width / 2, y: origin.top + size.height / 2 }

    this.applyZoom(next, center, origin, false)
    if (remaining <= 1) return

    // 用剩余步数兜底：即便调度器被同步执行也不会无限递归
    this.schedule(() => this.animateSettle(target, remaining - 1, token))
  }

  // -------------------------------------------------------------------------
  // 通知（按帧合并）
  // -------------------------------------------------------------------------

  private notify(): void {
    if (!this.onChange || this.pendingFrame) return
    this.pendingFrame = true
    this.schedule(() => {
      this.pendingFrame = false
      this.onChange?.(this.getState())
    })
  }
}
