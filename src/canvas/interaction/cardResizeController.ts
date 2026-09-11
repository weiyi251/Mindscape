// ============================================================================
// 模块说明（中文）
// 卡片缩放控制器（右下角手柄）。对应开发计划书 T2.3 与 5.2「缩放卡片」。
//
// 与卡片拖拽（cardDragController）同一套铁律：
//   · Pointer Events + setPointerCapture，拖动中只直写 DOM（width / height），
//     绝不 setState；松手才交出最终尺寸（17.3）。
//   · 手柄拖动没有「单击选中」语义，因此不做 4px 判定，按下即开始。
//   · 屏幕位移 ÷ zoom = 尺寸增量（17.4 同一坐标系约定）。
//
// 只改右下角：卡片左上角（x / y）保持不变，宽高随手柄增长/收缩。
// 最小尺寸 MIN_CARD_SIZE 是手感可调参数（17 章「⚠️ 可调」精神），文档未规定。
// 实现任务：T2.3。
// ============================================================================

/** 卡片允许的最小宽 / 高（px，画布坐标） */
export const MIN_CARD_SIZE = 40

/** 缩放通道：读按下时的尺寸、直写 DOM、读缩放比 */
export interface CardResizeSource {
  getCardSize(cardId: string): { w: number; h: number }
  /** 直写 DOM 的 width / height（不进 React state） */
  setCardSize(cardId: string, w: number, h: number): void
  getZoom(): number
}

export interface CardResizeDelegate {
  onResizeStart(cardId: string): void
  /** 松手：from / to 为画布坐标下的尺寸 */
  onResizeEnd(cardId: string, from: { w: number; h: number }, to: { w: number; h: number }): void
}

/** 一次缩放的快照（测试用） */
export interface ResizeSnapshot {
  cardId: string
  from: { w: number; h: number }
  to: { w: number; h: number }
}

function clampSize(value: number): number {
  if (!Number.isFinite(value)) return MIN_CARD_SIZE
  return Math.max(MIN_CARD_SIZE, Math.round(value))
}

export class CardResizeController {
  private pointerId: number | null = null
  private cardId: string | null = null
  private element: HTMLElement | null = null
  private startScreen = { x: 0, y: 0 }
  private startSize = { w: 0, h: 0 }
  private currentSize = { w: 0, h: 0 }
  private resizing = false

  constructor(
    private readonly source: CardResizeSource,
    private readonly delegate: CardResizeDelegate,
  ) {}

  get isResizing(): boolean {
    return this.resizing
  }

  get activeCardId(): string | null {
    return this.cardId
  }

  begin(event: PointerEvent, cardId: string, element: HTMLElement): boolean {
    if (this.pointerId !== null) return false
    if (event.button !== 0) return false

    this.pointerId = event.pointerId
    this.cardId = cardId
    this.element = element
    this.startScreen = { x: event.clientX, y: event.clientY }
    this.startSize = { ...this.source.getCardSize(cardId) }
    this.currentSize = { ...this.startSize }
    this.resizing = true

    try {
      element.setPointerCapture(event.pointerId)
    } catch {
      // 忽略：元素已移除等场景
    }

    this.delegate.onResizeStart(cardId)
    return true
  }

  move(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId || this.cardId === null) return

    const zoom = this.source.getZoom()
    const safeZoom = zoom > 0 ? zoom : 1
    this.currentSize = {
      w: clampSize(this.startSize.w + (event.clientX - this.startScreen.x) / safeZoom),
      h: clampSize(this.startSize.h + (event.clientY - this.startScreen.y) / safeZoom),
    }
    this.source.setCardSize(this.cardId, this.currentSize.w, this.currentSize.h)
  }

  end(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId || this.cardId === null) return

    const cardId = this.cardId
    const from = { ...this.startSize }
    const to = { ...this.currentSize }

    this.release(event.pointerId, this.element)
    this.resetState()

    if (from.w !== to.w || from.h !== to.h) {
      this.delegate.onResizeEnd(cardId, from, to)
    } else {
      // 尺寸没变（原地点了一下手柄）：把 DOM 恢复成 store 值，不产生命令
      this.source.setCardSize(cardId, from.w, from.h)
    }
  }

  cancel(): void {
    if (this.cardId === null) return

    const cardId = this.cardId
    const size = { ...this.startSize }
    this.release(this.pointerId, this.element)
    this.resetState()
    this.source.setCardSize(cardId, size.w, size.h)
  }

  private release(pointerId: number | null, element: HTMLElement | null): void {
    if (pointerId === null || !element) return
    try {
      if (element.hasPointerCapture(pointerId)) {
        element.releasePointerCapture(pointerId)
      }
    } catch {
      // 忽略
    }
  }

  private resetState(): void {
    this.pointerId = null
    this.cardId = null
    this.element = null
    this.resizing = false
  }
}
