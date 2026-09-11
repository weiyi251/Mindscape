// ============================================================================
// 模块说明（中文）
// 卡片拖拽控制器。对应开发计划书 T2.2 / T2.3，约束来自 17.3 / 17.4 / 17.11：
//
//   · 原生 Pointer Events + setPointerCapture，不用任何拖拽库（17.4）
//   · 拖动过程**只直写 DOM transform**，绝不 setState（17.3 / 17.11）
//   · 位移 ≤ 4px 视为单击、不启动拖拽（5.1）
//   · 松手时才通过回调把最终坐标交出去（上层一次 setState + 命令入栈）
//   · 多选拖动：整组随动，组内相对位置保持不变（11.2）
//
// 坐标策略（17.4 差分形式）：拖动期间 zoom 不变（滚轮与拖拽不会同时发生），
// 因此「画布位移 = 屏幕位移 / zoom」，新坐标 = 按下时坐标 + 画布位移。
// 这条路只依赖缩放比，不需要容器矩形，天然避免把 offset 重复扣减。
//
// 本类只做状态机与坐标计算；DOM 写入经由 CardDragSource 注入，
// 因此可以在 node 测试环境（无真实 DOM）下完整验证行为。
// 实现任务：T2.2（拖动）/ T2.3（多选拖动）/ T2.4（吸附在 move 管线上追加）。
// ============================================================================

import type { Point } from './coordinates'
import type { CardMoveDelta } from '@/core/commands/impl/moveCards'

/** 单击 / 拖拽判定阈值（5.1：低于阈值视为手抖，不算拖拽） */
export const DRAG_THRESHOLD_PX = 4

/** 拖拽期间的视觉反馈：半透明影子（11.6）。用 opacity 而非重绘（10.3） */
export const DRAG_OPACITY = '0.7'

/**
 * 卡片数据与 DOM 的读写通道。由 Canvas 实现：
 * 读按下时的画布坐标（store 值）、直写 DOM transform、读当前缩放比。
 */
export interface CardDragSource {
  /** 按下时的画布坐标（拖动过程中 store 不会变，以此为基准做差分） */
  getCardPosition(cardId: string): Point
  /** 直写 DOM transform（17.3：拖动中唯一允许的更新路径） */
  setCardTransform(cardId: string, x: number, y: number): void
  /** 拖拽影子的开与关（直写 opacity，见 10.3） */
  setDragGhost(cardId: string, active: boolean): void
  /** 当前视口缩放比 */
  getZoom(): number
}

/** 拖拽结果回调（由 Canvas 提供，松手时才触发 React 状态更新） */
export interface CardDragDelegate {
  /** 跨过 4px 阈值、拖拽真正开始（cardIds 含主卡与全部随动卡） */
  onDragStart(cardIds: string[]): void
  /** 松手：整组位移（from / to 都是画布坐标） */
  onDragEnd(moves: CardMoveDelta[]): void
  /** 未跨过阈值的松手 → 单击（选中该卡片，5.1） */
  onClick(cardId: string): void
}

/** 可选的拖拽管线（T2.4 吸附在此注入） */
export interface CardDragOptions {
  /**
   * 位置修正管线：每次直写 DOM 前调用，返回吸附后的画布坐标。
   * 主卡吸附后，随动卡沿用主卡的**实际位移**，保证组内相对位置不变（11.2）。
   */
  adjustPosition?: (cardId: string, proposed: Point) => Point
}

/** 单张随动卡：按下时的位置快照 */
interface Companion {
  id: string
  origin: Point
}

/**
 * 卡片拖拽状态机。
 *
 * 用法（Canvas 接线）：
 *   pointerdown（卡片上） → begin(event, cardId, el, companionIds)
 *   window pointermove    → move()
 *   window pointerup      → end()
 *   window pointercancel  → cancel()
 */
export class CardDragController {
  private pointerId: number | null = null
  private cardId: string | null = null
  private element: HTMLElement | null = null
  private startScreen: Point = { x: 0, y: 0 }
  private startPosition: Point = { x: 0, y: 0 }
  private currentPosition: Point = { x: 0, y: 0 }
  /** 随动卡（多选拖动）：按下时各自的位置快照，整组共享同一个画布位移 */
  private companions: Companion[] = []
  private dragging = false

  constructor(
    private readonly source: CardDragSource,
    private readonly delegate: CardDragDelegate,
    private readonly options: CardDragOptions = {},
  ) {}

  /** 是否正处于拖拽中（已跨过阈值） */
  get isDragging(): boolean {
    return this.dragging
  }

  /** 当前接管的卡片（主卡）；空闲时为 null */
  get activeCardId(): string | null {
    return this.cardId
  }

  /**
   * 在卡片上按下时调用。接管成功返回 true（此时 Viewport 不应再启动画布平移）。
   *
   * @param companionIds 与主卡一起移动的其他卡片 id（多选拖动，T2.3）。
   *                     组内相对位置 = 各自按下时位置 + 同一个画布位移。
   */
  begin(
    event: PointerEvent,
    cardId: string,
    element: HTMLElement,
    companionIds: string[] = [],
  ): boolean {
    if (this.pointerId !== null) return false
    if (event.button !== 0) return false

    this.pointerId = event.pointerId
    this.cardId = cardId
    this.element = element
    this.startScreen = { x: event.clientX, y: event.clientY }
    this.startPosition = { ...this.source.getCardPosition(cardId) }
    this.currentPosition = { ...this.startPosition }
    this.companions = companionIds
      .filter((id) => id !== cardId)
      .map((id) => ({ id, origin: { ...this.source.getCardPosition(id) } }))
    this.dragging = false

    // capture 之后，后续 pointer 事件都会重定向到卡片元素（仍会冒泡到 window）
    try {
      element.setPointerCapture(event.pointerId)
    } catch {
      // 元素已从 DOM 移除等场景：不影响后续流程，松手时自然结束
    }

    return true
  }

  /** pointermove：先做 4px 判定，跨过阈值后每帧直写 transform */
  move(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId || this.cardId === null) return

    const dx = event.clientX - this.startScreen.x
    const dy = event.clientY - this.startScreen.y

    if (!this.dragging) {
      // 5.1：位移 ≤ 4px 视为手抖，不启动拖拽
      if (Math.hypot(dx, dy) <= DRAG_THRESHOLD_PX) return
      this.dragging = true
      this.applyGhost(true)
      this.delegate.onDragStart([this.cardId, ...this.companions.map((item) => item.id)])
    }

    const zoom = this.source.getZoom()
    // zoom 恒为正（clampZoom 保证），防御式兜底避免除零把卡片算飞
    const safeZoom = zoom > 0 ? zoom : 1
    const deltaX = dx / safeZoom
    const deltaY = dy / safeZoom

    const proposed: Point = {
      x: this.startPosition.x + deltaX,
      y: this.startPosition.y + deltaY,
    }
    // T2.4：吸附管线 —— 修正后的位置与「提议位置」之差就是实际位移
    const adjusted = this.options.adjustPosition
      ? this.options.adjustPosition(this.cardId, proposed)
      : proposed
    const actualDeltaX = adjusted.x - this.startPosition.x
    const actualDeltaY = adjusted.y - this.startPosition.y

    this.currentPosition = adjusted
    this.source.setCardTransform(this.cardId, adjusted.x, adjusted.y)
    // 随动卡：各自原位 + 实际位移 → 组内相对位置不变（11.2），且与主卡同吸同放
    for (const companion of this.companions) {
      this.source.setCardTransform(
        companion.id,
        companion.origin.x + actualDeltaX,
        companion.origin.y + actualDeltaY,
      )
    }
  }

  /** pointerup：未跨阈值 → 单击；已拖拽 → 交出整组最终坐标 */
  end(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId || this.cardId === null) return

    const cardId = this.cardId
    const element = this.element
    const wasDragging = this.dragging
    const from: Point = { ...this.startPosition }
    const to: Point = { ...this.currentPosition }
    const moves: CardMoveDelta[] = [
      { id: cardId, from, to },
      ...this.companions.map((companion) => ({
        id: companion.id,
        from: { ...companion.origin },
        to: {
          x: companion.origin.x + (to.x - from.x),
          y: companion.origin.y + (to.y - from.y),
        },
      })),
    ]

    this.release(event.pointerId, element)

    // ⚠️ 顺序：ghost 关闭要在 resetState 之前 —— 它依赖 this.cardId / this.companions
    if (wasDragging) this.applyGhost(false)
    this.resetState()

    if (wasDragging) {
      this.delegate.onDragEnd(moves)
    } else {
      this.delegate.onClick(cardId)
    }
  }

  /** pointercancel / 组件卸载：丢弃本次拖拽，把整组卡片 DOM 恢复到按下时的位置 */
  cancel(): void {
    if (this.cardId === null) return

    const cardId = this.cardId
    const wasDragging = this.dragging
    const companions = this.companions
    const originX = this.startPosition.x
    const originY = this.startPosition.y

    this.release(this.pointerId, this.element)

    // ⚠️ 顺序：ghost 关闭要在 resetState 之前（依赖 this.cardId / this.companions）
    if (wasDragging) this.applyGhost(false)
    this.resetState()

    if (!wasDragging) return
    // 恢复到按下时的位置（DOM 直写；store 本来就没动过）
    this.source.setCardTransform(cardId, originX, originY)
    for (const companion of companions) {
      this.source.setCardTransform(companion.id, companion.origin.x, companion.origin.y)
    }
  }

  private applyGhost(active: boolean): void {
    if (this.cardId !== null) this.source.setDragGhost(this.cardId, active)
    for (const companion of this.companions) {
      this.source.setDragGhost(companion.id, active)
    }
  }

  private release(pointerId: number | null, element: HTMLElement | null): void {
    if (pointerId === null || !element) return
    try {
      if (element.hasPointerCapture(pointerId)) {
        element.releasePointerCapture(pointerId)
      }
    } catch {
      // 元素已被移除时忽略
    }
  }

  private resetState(): void {
    this.pointerId = null
    this.cardId = null
    this.element = null
    this.companions = []
    this.dragging = false
  }
}
