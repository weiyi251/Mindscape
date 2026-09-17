// ============================================================================
// 模块说明（中文）
// 连线拖拽控制器（2026-09-17 自 Canvas.tsx 外抽 —— Canvas 行数棘轮只剩 4 行）。
// 对应开发计划书 T3.1「拖拽创建连线」：
//   · 按下连接手柄 → 显示临时线（起点 = 源端右缘，用户裁决 2026-09-11）
//   · 拖动 → 临时线终点跟随指针（画布坐标）
//   · 松手 → 命中目标卡创建连线，命中空白取消
//
// 2026-09-17 扩展：条目级连线（待办卡片插件）——连接手柄 / 落点元素带
// data-connect-item 时，连线精确到卡片内的某个条目；条目 y 偏移由插件写进
// meta.itemAnchors 协议（core 不认识具体插件），这里只查偏移算端点。
//
// 与拖拽 / 缩放控制器同一套模式：纯逻辑 + 依赖注入，Canvas 只做接线。
// ============================================================================

import { connectionPathD, rightAnchorAtOffset } from './connectionAnchor'
import type { Point, Rect } from './connectionAnchor'

/** 连线的一端：卡片（条目级连线时带 itemId） */
export interface ConnectionEndpoint {
  cardId: string
  /** 卡片内条目 id；缺省 = 整卡连线（旧数据兼容） */
  itemId?: string
}

export interface ConnectionDragDeps {
  /** 卡片当前画布矩形（拖动中直读 DOM 位置，拖完后读数据） */
  getCardRect: (cardId: string) => Rect | null
  /** 条目相对卡片顶边的 y 偏移（meta.itemAnchors 协议；查不到返回 undefined → 退回整卡中点） */
  getItemOffset: (cardId: string, itemId: string) => number | undefined
  /** 当前指针的画布坐标 */
  getCanvasPoint: (event: PointerEvent) => Point
  /** 临时连线的 path 元素（Canvas 的 ref 直读，避免 effect 同步） */
  getTempPath: () => SVGPathElement | null
  /** 创建连线（松手命中目标后回调；两端各带可选条目） */
  onCreateConnection: (from: ConnectionEndpoint, to: ConnectionEndpoint) => void
}

/** 手柄 / 落点元素上的条目标记属性（插件条目连线点要带：值 = 条目 id） */
export const CONNECT_ITEM_ATTR = 'data-connect-item'

/** 卡片 id 属性（与 Card.tsx 导出的 CARD_ID_ATTR 同值；纯逻辑层不 import 组件文件） */
const CARD_ID_ATTR = 'data-card-id'

export class ConnectionDragController {
  /** 连线拖出进行中的源端；null 表示未在连线 */
  private from: ConnectionEndpoint | null = null

  constructor(private readonly deps: ConnectionDragDeps) {}

  /** 拖出进行中？（供 move / up / cancel 分流） */
  get isConnecting(): boolean {
    return this.from !== null
  }

  /** 开始从某端拖出连线：显示临时线（起点固定在源端右缘 / 条目行） */
  begin(event: PointerEvent, from: ConnectionEndpoint): void {
    this.from = from
    const path = this.deps.getTempPath()
    const rect = this.deps.getCardRect(from.cardId)
    if (!rect || !path) return
    const start = rightAnchorAtOffset(rect, this.offsetOf(from))
    path.setAttribute('d', connectionPathD(start, start))
    path.style.display = ''
    // 拖出箭头期间锁卡片拖动（记录的 pointerId 与卡片拖动互斥）
    event.preventDefault()
  }

  /** 拖动中：临时线终点跟随指针（画布坐标） */
  update(event: PointerEvent): void {
    const path = this.deps.getTempPath()
    if (!this.from || !path) return
    const rect = this.deps.getCardRect(this.from.cardId)
    if (!rect) return
    const to = this.deps.getCanvasPoint(event)
    const start = rightAnchorAtOffset(rect, this.offsetOf(this.from))
    path.setAttribute('d', connectionPathD(start, to))
  }

  /** 松手：命中条目 / 卡片则创建连线，命中空白取消 */
  end(event: PointerEvent): void {
    const from = this.from
    this.from = null
    const path = this.deps.getTempPath()
    if (!path) return
    path.style.display = 'none'
    if (!from) return

    const target = document.elementFromPoint(event.clientX, event.clientY)
    const cardElement = target?.closest(`[${CARD_ID_ATTR}]`) as HTMLElement | null
    const toCardId = cardElement?.getAttribute(CARD_ID_ATTR) ?? undefined
    if (!toCardId || toCardId === from.cardId) return

    // 条目级命中优先：落点元素（或其祖先）带 data-connect-item → toItem 连线；
    // 普通手柄没有该属性 → undefined = 整卡连线（旧行为兼容）
    const itemElement = target?.closest(`[${CONNECT_ITEM_ATTR}]`) as HTMLElement | null
    const toItemId = itemElement?.getAttribute(CONNECT_ITEM_ATTR) ?? undefined

    this.deps.onCreateConnection(from, { cardId: toCardId, itemId: toItemId })
  }

  /** 取消（pointercancel）：隐藏临时线并复位 */
  cancel(): void {
    this.from = null
    const path = this.deps.getTempPath()
    if (path) path.style.display = 'none'
  }

  /** 条目偏移查询：非条目端 / 查不到都返回 undefined（退回整卡中点） */
  private offsetOf(endpoint: ConnectionEndpoint): number | undefined {
    return endpoint.itemId ? this.deps.getItemOffset(endpoint.cardId, endpoint.itemId) : undefined
  }
}
