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
//
// 【图片卡片锁比例】（2026-09-12 用户实测反馈修复）
//   无约束的自由缩放会让卡片盒的比例脱离原图比例，渲染层只能用 object-contain
//   做留白（letterbox）；卡片比原图"更宽更扁"时，图片元素盒还会被撑得比卡片高，
//   被外壳的 overflow-hidden 裁掉 —— 用户看到的就是"图片显示不完整"。
//   因此：source.getAspectRatio 给出比例（w/h）时，缩放按该比例等比进行
//   （判据见 ratioLockedSize）；返回 null（非图片 / 未登记）时保持自由缩放。
//
// 实现任务：T2.3（比例锁定为 2026-09-12 增补）。
// ============================================================================

/** 卡片允许的最小宽 / 高（px，画布坐标）。锁比例时两轴都不得低于它 */
export const MIN_CARD_SIZE = 40

/** 缩放通道：读按下时的尺寸、直写 DOM、读缩放比、取宽高比 */
export interface CardResizeSource {
  getCardSize(cardId: string): { w: number; h: number }
  /** 直写 DOM 的 width / height（不进 React state） */
  setCardSize(cardId: string, w: number, h: number): void
  getZoom(): number
  /**
   * 该卡片的锁定宽高比（w / h）。返回 null 表示不锁比例（自由缩放）。
   * element 是卡片根元素，实现方可从中读取已加载原图的真实比例。
   */
  getAspectRatio(cardId: string, element: HTMLElement | null): number | null
}

export interface CardResizeDelegate {
  onResizeStart(cardId: string): void
  /** 松手：from / to 为画布坐标下的尺寸 */
  onResizeEnd(cardId: string, from: { w: number; h: number }, to: { w: number; h: number }): void
}

function clampSize(value: number): number {
  if (!Number.isFinite(value)) return MIN_CARD_SIZE
  return Math.max(MIN_CARD_SIZE, Math.round(value))
}

/**
 * 锁比例缩放：由「相对变化更大的那一轴」决定尺寸，另一轴按原图比例推出。
 *
 * 为什么用"相对变化更大的轴"而不是固定某一轴：
 *   用户拖右下角时可能水平拖得多、也可能垂直拖得多。取主导轴才符合
 *   "往哪个方向拖就往哪个方向变"的直觉；固定按宽度算会出现"竖直拖半天不动"。
 *
 * 纯函数，不碰 DOM，便于单测覆盖各种极端比例。
 *
 * @param start   按下时的卡片尺寸（画布坐标）
 * @param ratio   锁定的宽高比 w / h（须 > 0）
 * @param deltaW  水平位移换算到画布坐标的增量
 * @param deltaH  垂直位移换算到画布坐标的增量
 */
export function ratioLockedSize(
  start: { w: number; h: number },
  ratio: number,
  deltaW: number,
  deltaH: number,
): { w: number; h: number } {
  const baseW = start.w > 0 ? start.w : MIN_CARD_SIZE
  const baseH = start.h > 0 ? start.h : MIN_CARD_SIZE
  if (!(ratio > 0) || !Number.isFinite(ratio)) return { w: Math.round(baseW), h: Math.round(baseH) }

  const useWidth = Math.abs(deltaW) / baseW >= Math.abs(deltaH) / baseH
  let w = useWidth ? baseW + deltaW : (baseH + deltaH) * ratio
  // 只拦非有限值；负值（拖过头）交给下面的短边保底抬回来 —— 那才是用户预期的"缩到最小"
  if (!Number.isFinite(w)) w = baseW

  let h = w / ratio
  // 短边保底（顺序有讲究）：先把高抬到下限再反推宽；比例 < 1 时还要再抬一次宽。
  // 不这样做的话，长条形的图会被缩成一条看不见也点不中的细线。
  if (h < MIN_CARD_SIZE) {
    h = MIN_CARD_SIZE
    w = h * ratio
  }
  if (w < MIN_CARD_SIZE) {
    w = MIN_CARD_SIZE
    h = w / ratio
  }

  return { w: Math.round(w), h: Math.round(h) }
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
    const deltaW = (event.clientX - this.startScreen.x) / safeZoom
    const deltaH = (event.clientY - this.startScreen.y) / safeZoom

    // 图片卡片锁原图比例（见文件顶部【图片卡片锁比例】）；
    // 非图片卡片（比例为 null）保持自由缩放，行为与 T2.3 初版一致。
    const ratio = this.source.getAspectRatio(this.cardId, this.element)

    this.currentSize = ratio
      ? ratioLockedSize(this.startSize, ratio, deltaW, deltaH)
      : {
          w: clampSize(this.startSize.w + deltaW),
          h: clampSize(this.startSize.h + deltaH),
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
