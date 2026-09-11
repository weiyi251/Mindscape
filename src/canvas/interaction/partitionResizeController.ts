// ============================================================================
// 模块说明（中文）
// 分区框大小调整控制器（2026-09-11 用户裁决「分区框大小自定义」）。
// 对应交互：拖拽分区框右缘（改宽）/ 下缘（改高）/ 右下角（同时改）。
//
// 与卡片缩放（cardResizeController）同一套铁律（17.3）：
//   · Pointer Events + setPointerCapture，拖动中只直写 DOM 的 width / height，
//     绝不 setState；松手才交出最终尺寸（命令入撤销栈）。
//   · 手柄拖动没有「单击选中」语义，不做 4px 判定，按下即开始。
//   · 屏幕位移 ÷ zoom = 尺寸增量（17.4 同一坐标系约定）。
//
// 约束（min / max）由调用方在 begin 时一次性算好（core/board/partitions.ts
// 的 computePartitionResizeLimits：内容包围盒下限 + 相邻分区防重叠上限），
// 本控制器只做纯钳制数学 —— 保持可单测。
// ============================================================================

/** 手柄方向：e = 右缘（宽）、s = 下缘（高）、se = 右下角（宽高） */
export type PartitionResizeEdge = 'e' | 's' | 'se'

/** 写回层签名：直写 DOM 的 width / height（不进 React state） */
export interface PartitionResizeSource {
  getZoom(): number
  setSize(element: HTMLElement, w: number, h: number): void
}

export interface PartitionResizeDelegate {
  /** 松手：from / to 为画布坐标下的尺寸；尺寸没变时不会回调 */
  onResizeEnd(partitionId: string, from: { w: number; h: number }, to: { w: number; h: number }): void
}

function clamp(value: number, min: number, max: number): number {
  return Math.round(Math.min(Math.max(value, min), max))
}

export class PartitionResizeController {
  private pointerId: number | null = null
  private partitionId: string | null = null
  private element: HTMLElement | null = null
  private edge: PartitionResizeEdge = 'se'
  private startScreen = { x: 0, y: 0 }
  private startSize = { w: 0, h: 0 }
  private limits = { minW: 0, minH: 0, maxW: 0, maxH: 0 }
  private currentSize = { w: 0, h: 0 }
  private resizing = false

  constructor(
    private readonly source: PartitionResizeSource,
    private readonly delegate: PartitionResizeDelegate,
  ) {}

  get isResizing(): boolean {
    return this.resizing
  }

  get activePartitionId(): string | null {
    return this.partitionId
  }

  begin(
    event: PointerEvent,
    info: {
      partitionId: string
      element: HTMLElement
      edge: PartitionResizeEdge
      size: { w: number; h: number }
      limits: { minW: number; minH: number; maxW: number; maxH: number }
    },
  ): boolean {
    if (this.pointerId !== null) return false
    if (event.button !== 0) return false

    this.pointerId = event.pointerId
    this.partitionId = info.partitionId
    this.element = info.element
    this.edge = info.edge
    this.startScreen = { x: event.clientX, y: event.clientY }
    this.startSize = { ...info.size }
    this.limits = { ...info.limits }
    this.currentSize = { ...info.size }
    this.resizing = true

    try {
      info.element.setPointerCapture(event.pointerId)
    } catch {
      // 忽略：元素已移除等场景
    }
    return true
  }

  move(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId || this.partitionId === null || !this.element) return

    const zoom = this.source.getZoom()
    const safeZoom = zoom > 0 ? zoom : 1
    const dx = (event.clientX - this.startScreen.x) / safeZoom
    const dy = (event.clientY - this.startScreen.y) / safeZoom

    const width =
      this.edge === 'e' || this.edge === 'se'
        ? clamp(this.startSize.w + dx, this.limits.minW, this.limits.maxW)
        : this.startSize.w
    const height =
      this.edge === 's' || this.edge === 'se'
        ? clamp(this.startSize.h + dy, this.limits.minH, this.limits.maxH)
        : this.startSize.h

    this.currentSize = { w: width, h: height }
    this.source.setSize(this.element, width, height)
  }

  end(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId || this.partitionId === null) return

    const partitionId = this.partitionId
    const element = this.element
    const from = { ...this.startSize }
    const to = { ...this.currentSize }

    this.release(event.pointerId, element)
    this.resetState()

    if (from.w !== to.w || from.h !== to.h) {
      this.delegate.onResizeEnd(partitionId, from, to)
    } else {
      // 尺寸没变（原地单击手柄）：把 DOM 恢复成 store 值，不产生命令
      if (element) this.source.setSize(element, from.w, from.h)
    }
  }

  cancel(): void {
    if (this.partitionId === null) return

    const element = this.element
    const size = { ...this.startSize }
    this.release(this.pointerId, element)
    this.resetState()
    if (element) this.source.setSize(element, size.w, size.h)
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
    this.partitionId = null
    this.element = null
    this.resizing = false
  }
}
