// ============================================================================
// 模块说明（中文）
// 分区框拖动控制器：拖框 = 整组移动框内卡片（第六章「可拖动」）。
//
// 【手感约束（17.3 / 17.4，与 cardDragController 同一套铁律）】
//   · 原生 Pointer Events + setPointerCapture（捕获推迟到真正开始拖动时，
//     否则双击改名会被指针捕获重定向拦截——见 move() 内注释），不用任何拖拽库
//   · 4px 单击 / 拖拽判定（5.1）
//   · 拖动中只直写 DOM transform（框 + 框内每张卡片），不触发 React 重渲染；
//     松手才回调 onDragEnd，由上层一次 setState 固化 + 命令入撤销栈
//   · 位移换算：画布位移 = 屏幕位移 / zoom（拖动期间 zoom 不变）
//
// 【折叠态】框内卡片隐藏（DOM 不存在）时 setCardTransform 自然 no-op，
//   数据层的卡片位移照常回调 —— 展开后相对位置仍正确。
//
// 实现任务：T2.5。
// ============================================================================

import type { Point } from './coordinates'
import { DRAG_THRESHOLD_PX } from './cardDragController'

/** 拖框结果：框位移 + 框内每张卡片的位移（折叠时卡片照常带位移） */
export interface PartitionMoveResult {
  partitionId: string
  from: Point
  to: Point
  /** 框内卡片位移（from/to 均为画布坐标） */
  cardMoves: { id: string; from: Point; to: Point }[]
}

export interface PartitionDragSource {
  /** 直写分区框的 transform */
  setPartitionTransform(id: string, x: number, y: number): void
  /** 直写卡片的 transform（卡片未渲染时实现应安全 no-op） */
  setCardTransform(id: string, x: number, y: number): void
  getZoom(): number
}

export interface PartitionDragDelegate {
  /** 松手且位移有意义时回调；单击（未跨阈值）不回调 */
  onDragEnd(result: PartitionMoveResult): void
}

/** 拖动开始时随动的框内卡片快照 */
export interface PartitionCompanion {
  id: string
  from: Point
}

interface DragState {
  pointerId: number
  partitionId: string
  startScreen: Point
  from: Point
  dragging: boolean
  companions: PartitionCompanion[]
  /** 拖框目标元素（跨过阈值真正开始拖动时才用它捕获指针） */
  element: HTMLElement
}

export class PartitionDragController {
  private state: DragState | null = null

  constructor(
    private readonly source: PartitionDragSource,
    private readonly delegate: PartitionDragDelegate,
  ) {}

  get isDragging(): boolean {
    return this.state?.dragging ?? false
  }

  begin(
    event: PointerEvent,
    partitionId: string,
    element: HTMLElement,
    from: Point,
    companions: PartitionCompanion[],
  ): void {
    this.state = {
      pointerId: event.pointerId,
      partitionId,
      startScreen: { x: event.clientX, y: event.clientY },
      from,
      dragging: false,
      companions: companions.map((item) => ({ ...item })),
      element,
    }
    // ⚠️ 此处【不】setPointerCapture：按下即捕获会把后续 click/dblclick
    //    重定向到框外层元素（捕获目标），标题条子元素上的 onDoubleClick
    //    永远收不到 —— 双击改名就失效了。捕获推迟到 move() 跨过阈值时。
  }

  move(event: PointerEvent): void {
    const state = this.state
    if (!state || event.pointerId !== state.pointerId) return

    if (!state.dragging) {
      const distance = Math.hypot(
        event.clientX - state.startScreen.x,
        event.clientY - state.startScreen.y,
      )
      if (distance <= DRAG_THRESHOLD_PX) return
      state.dragging = true

      // 真正开始拖动才捕获指针：此时双击已不可能发生（位移 > 4px），
      // 捕获既保住「拖出窗口不丢事件」，又不干扰未拖动时的原生事件流
      try {
        state.element.setPointerCapture(event.pointerId)
      } catch {
        // 元素可能已脱离 DOM，拖动仍可通过 window 事件继续
      }
    }

    const zoom = this.source.getZoom()
    const dx = (event.clientX - state.startScreen.x) / zoom
    const dy = (event.clientY - state.startScreen.y) / zoom

    this.source.setPartitionTransform(state.partitionId, state.from.x + dx, state.from.y + dy)
    for (const companion of state.companions) {
      this.source.setCardTransform(companion.id, companion.from.x + dx, companion.from.y + dy)
    }
  }

  end(event: PointerEvent): void {
    const state = this.state
    if (!state || event.pointerId !== state.pointerId) return

    if (state.dragging) {
      const zoom = this.source.getZoom()
      const dx = (event.clientX - state.startScreen.x) / zoom
      const dy = (event.clientY - state.startScreen.y) / zoom
      const to = { x: state.from.x + dx, y: state.from.y + dy }

      this.delegate.onDragEnd({
        partitionId: state.partitionId,
        from: state.from,
        to,
        cardMoves: state.companions.map((companion) => ({
          id: companion.id,
          from: companion.from,
          to: { x: companion.from.x + dx, y: companion.from.y + dy },
        })),
      })
    }

    this.state = null
  }

  cancel(): void {
    // 拖动中被打断：把框与卡片还原到起点（卡片未渲染时 no-op）
    const state = this.state
    if (!state) return

    if (state.dragging) {
      this.source.setPartitionTransform(state.partitionId, state.from.x, state.from.y)
      for (const companion of state.companions) {
        this.source.setCardTransform(companion.id, companion.from.x, companion.from.y)
      }
    }

    this.state = null
  }
}
