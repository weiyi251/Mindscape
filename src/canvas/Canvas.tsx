// ============================================================================
// 模块说明（中文）
// 画布组件。对应 T1.3（渲染卡片）+ T1.4（缩略图 / 原图懒加载）+ T1.5（交互接入）
// + T2.2（卡片拖动）+ T2.3（缩放手柄 / 多选框选）。
//
// 结构（17.2 的 canvas/ 目录）：
//   Canvas ── 数据与状态条 + 拖拽 / 缩放 / 框选接线
//     └── Viewport ── zoom / offset 用 ref 管理，transform 直接写 DOM
//           ├── SelectionBox ── 框选矩形（DOM 直写）
//           └── CardView ── 每张卡片（画布坐标系，translate3d 定位 + 右下角手柄）
//
// ⚠️ 手感约束（17.3 / 17.11）：滚动缩放、平移、卡片拖动、手柄缩放、框选矩形
//    **全部不触发 React 重渲染**，一律 DOM 直写。两个例外都属「低频且必须」：
//    ① 拖拽 / 缩放松手时一次 setState 固化坐标（+命令入栈）；
//    ② 框选中「框内卡片集合」真正变化时才 setState（11.5 实时高亮）。
//
// ⚠️ 定位方式（17.7「GPU 图层」）：卡片用 `transform: translate3d()` 而不是 left/top，
//    并声明 will-change，让它单独进合成层；改坐标时不触发重排。
//
// 实现任务：T1.3 / T1.4 / T1.5 / T2.2 / T2.3。
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { CanvasState, Card, Connection, Partition } from '@/core/types'
import { Viewport, CANVAS_ITEM_ATTR, CANVAS_ROOT_ATTR } from './Viewport'
import { CardView, CARD_ID_ATTR } from './Card'
import { PartitionView, PARTITION_ID_ATTR } from './Partition'
import { ConnectionLayer } from './Connection'
import type { ConnectionLayerHandle } from './Connection'
import { CONNECTION_ID_ATTR, CONNECTION_SVG_MARGIN, CONNECTION_SVG_TOTAL } from './Connection'
import { SelectionBox } from './Selection'
import type { SelectionBoxHandle } from './Selection'
import { FpsMeter } from './FpsMeter'
import { upgradeVisibleImages } from './lazyOriginal'
import { CardDragController, DRAG_OPACITY, DRAG_THRESHOLD_PX } from './interaction/cardDragController'
import type { CardDragDelegate, CardDragSource } from './interaction/cardDragController'
import { CardResizeController, MIN_CARD_SIZE } from './interaction/cardResizeController'
import type {
  CardResizeDelegate,
  CardResizeEdge,
  CardResizeSource,
} from './interaction/cardResizeController'
import { PartitionDragController } from './interaction/partitionDragController'
import type { PartitionMoveResult } from './interaction/partitionDragController'
import { PartitionResizeController } from './interaction/partitionResizeController'
import type { PartitionResizeEdge } from './interaction/partitionResizeController'
import { cardIdsInRect, normalizeRect } from './interaction/marquee'
import { computeSnap, snapThresholdInCanvas } from './interaction/snap'
import { screenToCanvas } from './interaction/coordinates'
import { contentRects } from './interaction/fitToContent'
import { connectionPathD, rightAnchor } from './interaction/connectionAnchor'
import type { Point } from './interaction/connectionAnchor'
import { visibleCanvasRect } from './lazyOriginal'
import { SnapGuide } from './SnapGuide'
import type { SnapGuideHandle } from './SnapGuide'
import { useCanvasShortcuts } from './useCanvasShortcuts'
import {
  computePartitionResizeLimits,
  PARTITION_TITLE_HEIGHT,
  resolvePartitionColor,
} from '@/core/board/partitions'
import type { ViewportState } from './interaction/coordinates'
import type { CardMoveDelta } from '@/core/commands/impl/moveCards'
import type { CardResizeDelta } from '@/core/commands/impl/resizeCards'
import type { ViewportController } from './interaction/viewportController'

export interface CanvasProps {
  /** 要渲染的卡片；x / y / w / h 均为画布坐标 */
  cards: Card[]
  /** 分区框（T2.5）；折叠时框内卡片隐藏 */
  partitions?: Partition[]
  /** 选中集合（单击 / 框选 / Ctrl+A 都写这里） */
  selectedIds?: string[]
  /** 初始视图状态（T1.6：从 layout.json 恢复）；仅在挂载时应用一次 */
  initialView?: CanvasState
  /**
   * 视口变化回调（已按帧合并）。
   * ⚠️ 请勿在此 setState —— 用 DOM 直写或模块级变量，保住 17.3 要的手感。
   */
  onViewportChange?: (state: ViewportState) => void
  /** 选中集合变化：单击卡片（选中）、单击空白（取消）、框选实时高亮、Ctrl+A 全选 */
  onSelectCards?: (ids: string[]) => void
  /**
   * 拖拽松手且坐标有变化时回调（T2.2 / T2.3 多选）。上层负责写 store + 命令入撤销栈。
   * 拖动过程中本组件只直写 DOM，这里只会被调用一次。
   */
  onCommitMove?: (moves: CardMoveDelta[]) => void
  /** 手柄缩放松手且尺寸有变化时回调（T2.3） */
  onCommitResize?: (resizes: CardResizeDelta[]) => void
  /** 拖框松手且坐标有变化时回调（T2.5）：框 + 框内卡片整组提交 */
  onCommitPartitionMove?: (result: PartitionMoveResult) => void
  /** 点击分区框的折叠 / 展开按钮（T2.5） */
  onTogglePartitionCollapsed?: (id: string) => void
  /** 提交分区框新名字（T2.6）：五步保护由上层完成 */
  onRenamePartition?: (id: string, newName: string) => void
  /** 提交分区框新尺寸（拖拽边缘调整大小，2026-09-11 用户裁决）：命令由上层入撤销栈 */
  onCommitPartitionResize?: (delta: {
    partitionId: string
    from: { w: number; h: number }
    to: { w: number; h: number }
  }) => void
  /** Delete 键移除选中卡片（T2.7）：文件移动与命令由上层完成 */
  onRemoveCards?: (ids: string[]) => void
  /** 选中的分区框（2026-09-12：Ctrl+V 粘贴目标 = 选中的分区） */
  selectedPartitionId?: string | null
  /** 选中分区框变化：按下分区框选中；单击空白取消（传 null） */
  onSelectPartition?: (id: string | null) => void
  /** 已移除视图模式（T2.8）：卡片灰底、禁用拖动 / 缩放 / 框选平移以外的编辑 */
  removedMode?: boolean

  // ---- 阶段三（T3）----

  /** 连线数据（T3.1） */
  connections?: Connection[]
  /** 选中连线集合（T3.2） */
  selectedConnectionIds?: string[]
  /** 单击连线（选中） */
  onSelectConnections?: (ids: string[]) => void
  /** 双击连线（编辑标签，T3.2） */
  onEditConnectionLabel?: (id: string) => void
  /** 创建连线（T3.1）：拖拽松手 / 挂起模式点中目标卡后回调 */
  onCreateConnection?: (fromCardId: string, toCardId: string) => void
  /** 卡片右键菜单（T3.9）：菜单项由上层从菜单配置中心生成 */
  onCardContextMenu?: (card: Card, screen: { x: number; y: number }) => void
  /** 连线右键菜单（断开连接 / 编辑标签）：菜单项由菜单配置中心生成 */
  onConnectionContextMenu?: (connectionId: string, screen: { x: number; y: number }) => void
  /** 分区框右键菜单（T3.9） */
  onPartitionContextMenu?: (partition: Partition, screen: { x: number; y: number }) => void
  /** 画布空白右键菜单（T3.9：新建便签等） */
  onCanvasContextMenu?: (canvasPoint: Point, screen: { x: number; y: number }) => void
  /** 双击卡片打开（T3.5）：image → 打开原图；file → 系统默认程序 */
  onOpenCard?: (card: Card) => void
  /**
   * 便签行内编辑结束（用户要求：双击便签直接在便签本体内编辑，替代弹窗）。
   * Canvas 负责进出编辑态；这里只收到「最终草稿」，命令与落盘由 Board 完成。
   */
  onCommitNote?: (cardId: string, value: string) => void
  /** `Ctrl+F` 请求打开搜索浮层（P1-3）；浮层本身由 Board 渲染，画布只负责派发按键 */
  onRequestSearch?: () => void
  /** 搜索命中的卡片 id（P1-3）：虚线描边，表示「搜到了」 */
  searchHitIds?: string[]
  /** 当前跳转目标卡片 id（P1-3）：粗实线描边，比命中态更醒目 */
  searchActiveId?: string | null
  /**
   * 挂起连线模式（T3.9 菜单「连线」触发）：传源卡 id 后，下一张被点中的卡片
   * 成为连线目标；传 null 取消挂起。
   */
  pendingConnectFrom?: string | null
  /**
   * 画布 API 注册（T3.6 拖入落点换算需要）：挂载后回调一次，
   * 把「屏幕坐标 → 画布坐标」的换算函数交给上层。
   */
  registerCanvasApi?: (api: CanvasApi) => void
}

/** 画布命令式 API（供 Board 层做拖入落点换算，T3.6/T3.7） */
export interface CanvasApi {
  /** 视口内屏幕坐标（clientX/clientY）→ 画布坐标 */
  screenToCanvasPoint: (clientX: number, clientY: number) => Point
  /** 把给定画布坐标变为视口中心（小地图跳转用，2026-09-12）；保持当前缩放不变 */
  centerOn: (canvasPoint: Point) => void
  /** 让指定便签进入行内编辑（右键菜单「备注」对便签复用同一编辑态） */
  beginNoteEdit: (cardId: string) => void
  /** 让指定分区框进入改名编辑态（右键菜单「重命名分区」与双击标题共用，2026-09-14 修复） */
  beginPartitionRename: (partitionId: string) => void
}

export function Canvas({
  cards,
  partitions = [],
  selectedIds = [],
  initialView,
  onViewportChange,
  onSelectCards,
  onCommitMove,
  onCommitResize,
  onCommitPartitionMove,
  onCommitPartitionResize,
  onTogglePartitionCollapsed,
  onRenamePartition,
  onRemoveCards,
  selectedPartitionId = null,
  onSelectPartition,
  removedMode = false,
  connections = [],
  selectedConnectionIds = [],
  onSelectConnections,
  onEditConnectionLabel,
  onCreateConnection,
  onCardContextMenu,
  onConnectionContextMenu,
  onPartitionContextMenu,
  onCanvasContextMenu,
  onOpenCard,
  onCommitNote,
  onRequestSearch,
  searchHitIds = [],
  searchActiveId = null,
  pendingConnectFrom = null,
  registerCanvasApi,
}: CanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  /** 画布根容器（未变换的那个），懒加载与坐标换算用它 */
  const canvasRootRef = useRef<HTMLElement | null>(null)
  const controllerRef = useRef<ViewportController | null>(null)
  const zoomLabelRef = useRef<HTMLSpanElement>(null)

  // 入参存 ref：既让事件监听只挂一次，又能始终读到最新的父组件入参
  const onViewportChangeRef = useRef(onViewportChange)
  onViewportChangeRef.current = onViewportChange
  const initialViewRef = useRef(initialView)
  initialViewRef.current = initialView
  const onSelectCardsRef = useRef(onSelectCards)
  onSelectCardsRef.current = onSelectCards
  const onCommitMoveRef = useRef(onCommitMove)
  onCommitMoveRef.current = onCommitMove
  const onCommitResizeRef = useRef(onCommitResize)
  onCommitResizeRef.current = onCommitResize
  const onCommitPartitionMoveRef = useRef(onCommitPartitionMove)
  onCommitPartitionMoveRef.current = onCommitPartitionMove
  const onCommitPartitionResizeRef = useRef(onCommitPartitionResize)
  onCommitPartitionResizeRef.current = onCommitPartitionResize
  const onTogglePartitionCollapsedRef = useRef(onTogglePartitionCollapsed)
  onTogglePartitionCollapsedRef.current = onTogglePartitionCollapsed
  const onRenamePartitionRef = useRef(onRenamePartition)
  onRenamePartitionRef.current = onRenamePartition
  const onRemoveCardsRef = useRef(onRemoveCards)
  onRemoveCardsRef.current = onRemoveCards
  const onSelectPartitionRef = useRef(onSelectPartition)
  onSelectPartitionRef.current = onSelectPartition
  const onCreateConnectionRef = useRef(onCreateConnection)
  onCreateConnectionRef.current = onCreateConnection
  const onOpenCardRef = useRef(onOpenCard)
  onOpenCardRef.current = onOpenCard
  const onCommitNoteRef = useRef(onCommitNote)
  onCommitNoteRef.current = onCommitNote
  const onRequestSearchRef = useRef(onRequestSearch)
  onRequestSearchRef.current = onRequestSearch
  const onCardContextMenuRef = useRef(onCardContextMenu)
  onCardContextMenuRef.current = onCardContextMenu
  const onConnectionContextMenuRef = useRef(onConnectionContextMenu)
  onConnectionContextMenuRef.current = onConnectionContextMenu
  const onPartitionContextMenuRef = useRef(onPartitionContextMenu)
  onPartitionContextMenuRef.current = onPartitionContextMenu
  const onCanvasContextMenuRef = useRef(onCanvasContextMenu)
  onCanvasContextMenuRef.current = onCanvasContextMenu
  const registerCanvasApiRef = useRef(registerCanvasApi)
  registerCanvasApiRef.current = registerCanvasApi
  const selectedIdsRef = useRef(selectedIds)
  selectedIdsRef.current = selectedIds

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  /** 搜索命中集合（P1-3）：命中的卡片画虚线框 */
  const searchHitSet = useMemo(() => new Set(searchHitIds), [searchHitIds])

  /** 便签行内编辑（用户要求）：正在编辑的便签 id；null = 没有编辑中的便签 */
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  /** 结束编辑：清状态 + 把草稿交给 Board 持久化（命令 + 防抖落盘在 Board） */
  const handleNoteEditFinish = useCallback((cardId: string, value: string) => {
    setEditingNoteId((current) => (current === cardId ? null : current))
    onCommitNoteRef.current?.(cardId, value)
  }, [])

  /** 分区框改名编辑态（2026-09-14 修复）：正在改名的分区 id；null = 没有编辑中的分区。
   *  单一数据源：双击标题与右键菜单「重命名分区」都经此处置位，PartitionView 只据 `editing`
   *  推导是否显示输入框，杜绝两个入口各维护一份状态导致错位 */
  const [editingPartitionId, setEditingPartitionId] = useState<string | null>(null)
  /** 双击标题 / 菜单「重命名分区」→ 置位本分区为编辑态 */
  const handlePartitionBeginEdit = useCallback((id: string) => {
    setEditingPartitionId(id)
  }, [])
  /** 改名取消（Esc / 原名不变）→ 清位 */
  const handlePartitionCancelEdit = useCallback((id: string) => {
    setEditingPartitionId((current) => (current === id ? null : current))
  }, [])
  /** 提交新名：先清位（输入框即卸载），再交给上层走五步保护。
   *  注意：即便上层校验失败（同名冲突等），编辑态也已退出 —— 与双击提交行为一致，
   *  不会卡在「输入被吞、错误提示已弹出」的半开状态 */
  const handlePartitionRename = useCallback((id: string, newName: string) => {
    setEditingPartitionId((current) => (current === id ? null : current))
    onRenamePartitionRef.current?.(id, newName)
  }, [])

  /** 分区框 DOM 注册表（拖框时直写样式，17.3） */
  const partitionElsRef = useRef(new Map<string, HTMLDivElement>())
  const registerPartitionEl = useCallback((id: string, element: HTMLDivElement | null) => {
    if (element) partitionElsRef.current.set(id, element)
    else partitionElsRef.current.delete(id)
  }, [])

  /** 卡片 DOM 注册表（17.3：Map<cardId, HTMLElement>），拖动 / 缩放中靠它直写样式 */
  const cardElsRef = useRef(new Map<string, HTMLDivElement>())
  const registerCardEl = useCallback((cardId: string, element: HTMLDivElement | null) => {
    if (element) cardElsRef.current.set(cardId, element)
    else cardElsRef.current.delete(cardId)
  }, [])

  const cardsRef = useRef(cards)
  cardsRef.current = cards
  const partitionsRef = useRef(partitions)
  partitionsRef.current = partitions
  const removedModeRef = useRef(removedMode)
  removedModeRef.current = removedMode

  // ---- T2.2 卡片拖动 ----

  const dragSource = useMemo<CardDragSource>(
    () => ({
      getCardPosition: (cardId) => {
        const card = cardsRef.current.find((item) => item.id === cardId)
        return card ? { x: card.x, y: card.y } : { x: 0, y: 0 }
      },
      setCardTransform: (cardId, x, y) => {
        cardElsRef.current
          .get(cardId)
          ?.style.setProperty('transform', `translate3d(${x}px, ${y}px, 0)`)
      },
      setDragGhost: (cardId, active) => {
        const element = cardElsRef.current.get(cardId)
        if (element) element.style.opacity = active ? DRAG_OPACITY : ''
      },
      getZoom: () => controllerRef.current?.zoom ?? 1,
    }),
    [],
  )

  const dragDelegate = useMemo<CardDragDelegate>(
    () => ({
      onDragStart: () => {},
      onDragEnd: (moves) => {
        // 原地点名（全部位移为 0）不产生命令，避免撤销栈被无意义操作占满
        const meaningful = moves.filter(
          (move) => move.from.x !== move.to.x || move.from.y !== move.to.y,
        )
        snapGuideRef.current?.hide()
        if (meaningful.length === 0) return
        onCommitMoveRef.current?.(meaningful)
      },
      onClick: (cardId) => {
        snapGuideRef.current?.hide()
        onSelectCardsRef.current?.([cardId])
      },
    }),
    [],
  )

  // ---- T2.4 吸附管线 ----

  const snapGuideRef = useRef<SnapGuideHandle>(null)

  /**
   * 位置修正：把「接近对齐」的卡片吸到参考线上（11.7）。
   * 阈值以屏幕像素为基准按 zoom 换算，任何缩放级别下手感一致、不抢手。
   */
  const adjustPosition = useCallback((cardId: string, proposed: Point): Point => {
    const card = cardsRef.current.find((item) => item.id === cardId)
    if (!card) return proposed

    const targets = cardsRef.current.filter((item) => item.id !== cardId)
    const zoom = controllerRef.current?.zoom ?? 1
    const outcome = computeSnap(proposed, { w: card.w, h: card.h }, targets, snapThresholdInCanvas(zoom))

    // 参考线只画在当前可见区域内（避免超大合成层，17.7）
    const controller = controllerRef.current
    const root = canvasRootRef.current
    if (controller && root) {
      const rect = root.getBoundingClientRect()
      const bounds = visibleCanvasRect(controller.getState(), rect.width, rect.height)
      snapGuideRef.current?.update(
        { vertical: outcome.vertical, horizontal: outcome.horizontal },
        bounds,
      )
    }

    return outcome.position
  }, [])

  const dragController = useMemo(
    () => new CardDragController(dragSource, dragDelegate, { adjustPosition }),
    [dragSource, dragDelegate, adjustPosition],
  )

  // ---- T2.5 分区框拖动（拖框 = 整组移动框内卡片）----

  const partitionDragSource = useMemo(
    () => ({
      setPartitionTransform: (id: string, x: number, y: number) => {
        partitionElsRef.current
          .get(id)
          ?.style.setProperty('transform', `translate3d(${x}px, ${y}px, 0)`)
      },
      setCardTransform: dragSource.setCardTransform,
      getZoom: dragSource.getZoom,
    }),
    [dragSource],
  )

  const partitionDragDelegate = useMemo(
    () => ({
      onDragEnd: (result: PartitionMoveResult) => {
        onCommitPartitionMoveRef.current?.(result)
      },
    }),
    [],
  )

  const partitionDragController = useMemo(
    () => new PartitionDragController(partitionDragSource, partitionDragDelegate),
    [partitionDragSource, partitionDragDelegate],
  )

  // ---- 分区框大小调整（2026-09-11 用户裁决：拖拽边缘改宽高）----

  const partitionResizeSource = useMemo(
    () => ({
      getZoom: dragSource.getZoom,
      setSize: (element: HTMLElement, w: number, h: number) => {
        element.style.width = `${w}px`
        element.style.height = `${h}px`
      },
    }),
    [dragSource],
  )

  const partitionResizeDelegate = useMemo(
    () => ({
      onResizeEnd: (
        partitionId: string,
        from: { w: number; h: number },
        to: { w: number; h: number },
      ) => {
        onCommitPartitionResizeRef.current?.({ partitionId, from, to })
      },
    }),
    [],
  )

  const partitionResizeController = useMemo(
    () => new PartitionResizeController(partitionResizeSource, partitionResizeDelegate),
    [partitionResizeSource, partitionResizeDelegate],
  )

  // ---- T3.1 连线：拖拽创建 + 拖动跟随 ----

  const connectionLayerRef = useRef<ConnectionLayerHandle>(null)
  /** 临时连线（拖出箭头过程）的 path：DOM 直写，不进 React 状态 */
  const tempConnectionRef = useRef<SVGPathElement | null>(null)
  /** 连线拖拽进行中的源卡 id；null 表示未在连线 */
  const connectingFromRef = useRef<string | null>(null)
  /** 挂起连线模式的源卡 id（菜单「连线」触发）；进 ref 供原生监听读取 */
  const pendingConnectRef = useRef<string | null>(pendingConnectFrom)
  pendingConnectRef.current = pendingConnectFrom

  /** 卡片当前画布位置：拖动中直读 DOM，其余读数据 */
  const getCardLivePos = useCallback((id: string): Point | null => {
    const card = cardsRef.current.find((item) => item.id === id)
    if (!card) return null
    const element = cardElsRef.current.get(id)
    const match = element
      ? /translate3d\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px/.exec(element.style.transform)
      : null
    return match ? { x: Number(match[1]), y: Number(match[2]) } : { x: card.x, y: card.y }
  }, [])

  const getCardRectById = useCallback(
    (id: string) => {
      const card = cardsRef.current.find((item) => item.id === id)
      if (!card) return null
      const position = getCardLivePos(id)
      return position ? { x: position.x, y: position.y, w: card.w, h: card.h } : null
    },
    [getCardLivePos],
  )
  /** 供声明顺序在后的函数间接访问（ref 转发，避免 TDZ） */
  const getCardRectByIdRef = useRef(getCardRectById)
  getCardRectByIdRef.current = getCardRectById
  /** getCanvasPoint 声明在下方；连线回调运行时已初始化 */
  const getCanvasPointRef = useRef<((event: PointerEvent) => Point) | null>(null)

  /** 开始从某张卡拖出连线：显示临时线（getCanvasPoint 声明在其后，函数体运行时才解引用） */
  const beginConnectionDrag = useCallback(
    (event: PointerEvent, fromCardId: string) => {
      connectingFromRef.current = fromCardId
      const from = getCardRectById(fromCardId)
      if (!from || !tempConnectionRef.current) return
      // 起点固定为源卡右缘中点（与正式连线一致，用户裁决 2026-09-11）
      const start = rightAnchor(from)
      tempConnectionRef.current.setAttribute('d', connectionPathD(start, start))
      tempConnectionRef.current.style.display = ''
      // 拖出箭头期间锁卡片拖动（记录的 pointerId 与卡片拖动互斥）
      event.preventDefault()
    },
    [getCardRectById],
  )

  /** 更新临时线终点（画布坐标）。getCanvasPoint 在下方声明，运行时已就绪 */
  const updateConnectionDrag = useCallback((event: PointerEvent) => {
    const fromId = connectingFromRef.current
    if (!fromId || !tempConnectionRef.current) return
    const from = getCardRectByIdRef.current(fromId)
    if (!from) return
    const to = getCanvasPointRef.current?.(event) ?? { x: 0, y: 0 }
    const start = rightAnchor(from)
    tempConnectionRef.current.setAttribute('d', connectionPathD(start, to))
  }, [])

  /** 结束连线拖拽：命中目标卡则创建连线，否则取消 */
  const endConnectionDrag = useCallback(
    (event: PointerEvent) => {
      const fromId = connectingFromRef.current
      connectingFromRef.current = null
      if (!tempConnectionRef.current) return
      tempConnectionRef.current.style.display = 'none'

      if (!fromId) return
      const target = document.elementFromPoint(event.clientX, event.clientY)
      const cardElement = target?.closest(`[${CARD_ID_ATTR}]`) as HTMLElement | null
      const toId = cardElement?.getAttribute(CARD_ID_ATTR)
      if (toId && toId !== fromId) onCreateConnectionRef.current?.(fromId, toId)
    },
    [],
  )

  // ---- T2.3 缩放手柄 ----

  const resizeSource = useMemo<CardResizeSource>(
    () => ({
      getCardSize: (cardId) => {
        const card = cardsRef.current.find((item) => item.id === cardId)
        return card ? { w: card.w, h: card.h } : { w: MIN_CARD_SIZE, h: MIN_CARD_SIZE }
      },
      setCardSize: (cardId, w, h) => {
        const element = cardElsRef.current.get(cardId)
        if (!element) return
        element.style.width = `${w}px`
        element.style.height = `${h}px`
      },
      // n / w 边缩放联动位置：与拖拽控制器同一通道（直写 transform，17.3）
      getCardPosition: (cardId) => {
        const card = cardsRef.current.find((item) => item.id === cardId)
        return card ? { x: card.x, y: card.y } : { x: 0, y: 0 }
      },
      setCardPosition: (cardId, x, y) => {
        const element = cardElsRef.current.get(cardId)
        if (!element) return
        element.style.transform = `translate3d(${x}px, ${y}px, 0)`
      },
      getZoom: () => controllerRef.current?.zoom ?? 1,
      getAspectRatio: (cardId, element) => {
        // 1) 首选"已加载原图的真实比例"：懒加载把原图写进 src 之后
        //    naturalWidth / naturalHeight 才有效（方案 A：直接加载原图，没有缩略图）。
        const img = element?.querySelector<HTMLImageElement>('[data-card-image]')
        const naturalW = img?.naturalWidth ?? 0
        const naturalH = img?.naturalHeight ?? 0
        if (naturalW > 0 && naturalH > 0) return naturalW / naturalH

        // 2) 原图还没加载（视口外 / 加载失败）时退回卡片当前比例：
        //    图片卡片的初始尺寸本就按原图比例算好（T1.4 的 cardSizeForImage），
        //    因此这个退路同样是对的；非图片卡片一律返回 null → 自由缩放。
        const card = cardsRef.current.find((item) => item.id === cardId)
        if (card && card.type === 'image' && card.w > 0 && card.h > 0) return card.w / card.h
        return null
      },
    }),
    [],
  )

  const resizeDelegate = useMemo<CardResizeDelegate>(
    () => ({
      onResizeStart: () => {},
      onResizeEnd: (cardId, from, to, position) => {
        onCommitResizeRef.current?.([
          {
            id: cardId,
            from,
            to,
            // n / w 边缩放联动出的位置（可选；东南角缩放不传）
            fromPos: position?.from,
            toPos: position?.to,
          },
        ])
      },
    }),
    [],
  )

  const resizeController = useMemo(
    () => new CardResizeController(resizeSource, resizeDelegate),
    [resizeSource, resizeDelegate],
  )

  // ---- T2.3 框选 ----

  const selectionBoxRef = useRef<SelectionBoxHandle>(null)
  const marqueeRef = useRef<{
    pointerId: number
    startScreen: Point
    startCanvas: Point
    dragging: boolean
  } | null>(null)
  /** 上一次框选实时高亮的集合指纹：没变化就不 setState */
  const marqueeSelectionKeyRef = useRef('')

  /** 屏幕坐标 → 画布坐标（17.4 公式，origin 必须是未被变换的根容器） */
  const getCanvasPoint = useCallback((event: PointerEvent): Point => {
    const controller = controllerRef.current
    const root = canvasRootRef.current
    if (!controller || !root) return { x: 0, y: 0 }
    const rect = root.getBoundingClientRect()
    return screenToCanvas(
      { x: event.clientX, y: event.clientY },
      controller.getState(),
      { left: rect.left, top: rect.top },
    )
  }, [])
  getCanvasPointRef.current = getCanvasPoint

  const handleMarqueePointerDown = useCallback(
    (event: PointerEvent) => {
      marqueeRef.current = {
        pointerId: event.pointerId,
        startScreen: { x: event.clientX, y: event.clientY },
        startCanvas: getCanvasPoint(event),
        dragging: false,
      }
    },
    [getCanvasPoint],
  )

  const handleMarqueeMove = useCallback(
    (event: PointerEvent) => {
      const state = marqueeRef.current
      if (!state || event.pointerId !== state.pointerId) return

      if (!state.dragging) {
        // 与平移一致的 4px 判定（11.5）
        const distance = Math.hypot(
          event.clientX - state.startScreen.x,
          event.clientY - state.startScreen.y,
        )
        if (distance <= DRAG_THRESHOLD_PX) return
        state.dragging = true
      }

      const rect = normalizeRect(state.startCanvas, getCanvasPoint(event))
      selectionBoxRef.current?.show(rect)

      const ids = cardIdsInRect(rect, cardsRef.current)
      const key = ids.join(',')
      if (key !== marqueeSelectionKeyRef.current) {
        marqueeSelectionKeyRef.current = key
        onSelectCardsRef.current?.(ids)
      }
    },
    [getCanvasPoint],
  )

  const handleMarqueeEnd = useCallback((event: PointerEvent) => {
    const state = marqueeRef.current
    if (!state || event.pointerId !== state.pointerId) return
    marqueeRef.current = null
    marqueeSelectionKeyRef.current = ''
    selectionBoxRef.current?.hide()

    // Ctrl+单击空白（未跨阈值）→ 取消选中（5.1）
    if (!state.dragging) onSelectCardsRef.current?.([])
  }, [])

  const handleMarqueeCancel = useCallback(() => {
    if (!marqueeRef.current) return
    marqueeRef.current = null
    marqueeSelectionKeyRef.current = ''
    selectionBoxRef.current?.hide()
  }, [])

  // ---- 事件接线 ----

  /** Viewport 转发来的「卡片上的按下」：手柄走缩放，卡片本体走拖动（多选时整组随动） */
  const handleItemPointerDown = useCallback(
    (event: PointerEvent) => {
      // 已移除视图（T2.8）：允许点选（恢复要用），禁止拖动 / 缩放
      if (removedModeRef.current) {
        const target = event.target as HTMLElement | null
        const element = target?.closest(`[${CANVAS_ITEM_ATTR}]`) as HTMLElement | null
        const cardId = element?.getAttribute(CARD_ID_ATTR)
        if (cardId) onSelectCardsRef.current?.([cardId])
        return
      }

      const target = event.target as HTMLElement | null
      const cardElement = target?.closest(`[${CANVAS_ITEM_ATTR}]`) as HTMLElement | null
      if (!cardElement) return

      // 便签编辑态（2026-09-13）：textarea 上的按下交给浏览器默认行为
      // （选字 / 挪光标 / 双击选词）。必须在一切手势分流之前早退 ——
      // Viewport 的原生根监听先于 React 合成事件触发，textarea 自己的
      // stopPropagation 拦不住它，只有这里早退才能不让拖拽控制器接管
      if (target?.closest('[data-note-editing]')) return

      // 挂起连线模式（T3.9 菜单「连线」）：下一张被点中的卡片成为目标
      const pendingFrom = pendingConnectRef.current
      if (pendingFrom) {
        pendingConnectRef.current = null
        const pendingTarget = cardElement.getAttribute(CARD_ID_ATTR)
        if (pendingTarget && pendingTarget !== pendingFrom) {
          onCreateConnectionRef.current?.(pendingFrom, pendingTarget)
        }
        return
      }

      // 分区框：标题按钮不拖（折叠交给 click），框本体走整组拖动（T2.5）
      if (target?.closest('button')) return

      // 分区框大小调整手柄（2026-09-11 用户裁决）：优先于整组拖动。
      // 约束（内容包围盒下限 + 相邻分区防重叠上限）在这里按当前数据算好交给控制器。
      const resizeHandle = target?.closest('[data-partition-resize]') as HTMLElement | null
      if (resizeHandle) {
        const partitionElement = target?.closest(`[${PARTITION_ID_ATTR}]`) as HTMLElement | null
        const partitionId = partitionElement?.getAttribute(PARTITION_ID_ATTR)
        const partition = partitionsRef.current.find((item) => item.id === partitionId)
        if (partitionElement && partitionId && partition) {
          // 2026-09-12：按下分区（含调整大小手柄）即选中它（Ctrl+V 粘贴目标跟随）
          onSelectPartitionRef.current?.(partitionId)
          const members = cardsRef.current.filter((card) => card.group === partition.name)
          const limits = computePartitionResizeLimits(
            partition,
            partitionsRef.current,
            members,
          )
          const edge = (resizeHandle.getAttribute('data-partition-resize') ?? 'se') as PartitionResizeEdge
          partitionResizeController.begin(event, {
            partitionId,
            element: partitionElement,
            edge,
            size: { w: partition.w, h: partition.collapsed ? PARTITION_TITLE_HEIGHT : partition.h },
            limits,
          })
          return
        }
      }

      const partitionElement = target?.closest(`[${PARTITION_ID_ATTR}]`) as HTMLElement | null
      if (partitionElement) {
        const partitionId = partitionElement.getAttribute(PARTITION_ID_ATTR)
        const partition = partitionsRef.current.find((item) => item.id === partitionId)
        if (partitionId && partition) {
          // 2026-09-12：按下分区框即选中它（与卡片选中互斥，见 boardStore.selectPartition）
          onSelectPartitionRef.current?.(partitionId)
          // 框内卡片快照从数据层取：折叠时卡片未渲染也要随动（数据层位移）
          const companions = cardsRef.current
            .filter((card) => card.group === partition.name)
            .map((card) => ({ id: card.id, from: { x: card.x, y: card.y } }))
          partitionDragController.begin(
            event,
            partitionId,
            partitionElement,
            { x: partition.x, y: partition.y },
            companions,
          )
          return
        }
      }

      const cardId = cardElement.getAttribute(CARD_ID_ATTR)
      if (!cardId) return

      // 连接手柄（T3.1）：从卡片边缘拖出箭头
      if (target?.closest('[data-connect-handle]')) {
        beginConnectionDrag(event, cardId)
        return
      }

      // 缩放手柄（2026-09-13 起按 edge 分流：se=右下角，n/s/e/w=便签四边中点）
      if (target?.closest('[data-resize-edge]')) {
        const edgeHandle = target?.closest('[data-resize-edge]') as HTMLElement | null
        const edge = (edgeHandle?.getAttribute('data-resize-edge') ?? 'se') as CardResizeEdge
        resizeController.begin(event, cardId, cardElement, edge)
        return
      }

      // 多选拖动：按下的卡在选中集合内且选中数 > 1 时，整组随动（11.2）
      const ids = selectedIdsRef.current
      const companions = ids.length > 1 && ids.includes(cardId) ? ids.filter((id) => id !== cardId) : []
      dragController.begin(event, cardId, cardElement, companions)
    },
    [
      dragController,
      resizeController,
      partitionDragController,
      partitionResizeController,
      beginConnectionDrag,
    ],
  )

  // 拖拽 / 缩放 / 框选 / 拖框 / 连线的过程事件都挂 window：
  // setPointerCapture 会把后续事件重定向到起点元素，事件仍会冒泡到 window
  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      dragController.move(event)
      resizeController.move(event)
      partitionDragController.move(event)
      partitionResizeController.move(event)
      handleMarqueeMove(event)
      // T3.1：连线拖出中每帧更新临时线
      if (connectingFromRef.current) updateConnectionDrag(event)
      // T3.1：有卡片在拖动时，连线端点直读 DOM 跟随（零 setState）。
      // 卡片缩放（T2.3）与分区块整组拖动（T2.5）同样改变卡片几何，连线同步跟随。
      if (dragController.isDragging) connectionLayerRef.current?.refresh()
      if (resizeController.isResizing) connectionLayerRef.current?.refresh()
      if (partitionDragController.isDragging) connectionLayerRef.current?.refresh()
    }
    const handleUp = (event: PointerEvent) => {
      dragController.end(event)
      resizeController.end(event)
      partitionDragController.end(event)
      partitionResizeController.end(event)
      handleMarqueeEnd(event)
      if (connectingFromRef.current) endConnectionDrag(event)
    }
    const handleCancel = () => {
      dragController.cancel()
      resizeController.cancel()
      partitionDragController.cancel()
      partitionResizeController.cancel()
      snapGuideRef.current?.hide()
      handleMarqueeCancel()
      // 连线拖出被取消：隐藏临时线
      connectingFromRef.current = null
      if (tempConnectionRef.current) tempConnectionRef.current.style.display = 'none'
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleCancel)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleCancel)
    }
  }, [
    dragController,
    resizeController,
    partitionDragController,
    partitionResizeController,
    handleMarqueeMove,
    handleMarqueeEnd,
    handleMarqueeCancel,
    updateConnectionDrag,
    endConnectionDrag,
  ])

  /** 单击空白 → 取消选中（5.1）；分区选中一并取消（2026-09-12） */
  const handleBackgroundClick = useCallback(() => {
    onSelectCardsRef.current?.([])
    onSelectPartitionRef.current?.(null)
  }, [])

  /** 折叠 / 展开分区框（T2.5）：低频 UI 操作，走 React 状态 */
  const handleTogglePartitionCollapsed = useCallback((id: string) => {
    onTogglePartitionCollapsedRef.current?.(id)
  }, [])

  /** 折叠分区的框内卡片不渲染（第六章：折叠后框内卡片隐藏，只留标题条） */
  const collapsedGroupNames = useMemo(
    () => new Set(partitions.filter((partition) => partition.collapsed).map((item) => item.name)),
    [partitions],
  )
  const visibleCards = useMemo(
    () =>
      cards
        .filter((card) => !(card.group && collapsedGroupNames.has(card.group)))
        // T3.9 置顶 / 置底：按 zIndex 升序渲染（DOM 顺序即层叠顺序）。
        // 稳定排序（index 兜底）保证同 zIndex 的卡片保持原有插入顺序
        .map((card, index) => ({ card, index }))
        .sort((a, b) => a.card.zIndex - b.card.zIndex || a.index - b.index)
        .map((item) => item.card),
    [cards, collapsedGroupNames],
  )

  const writeZoomLabel = useCallback((zoom: number) => {
    if (zoomLabelRef.current) {
      zoomLabelRef.current.textContent = `${Math.round(zoom * 100)}%`
    }
  }, [])

  /** 17.7：把视口内的图片从缩略图升级为原图（纯 DOM 操作，零 React 更新） */
  const upgradeOriginals = useCallback(() => {
    const root = canvasRootRef.current
    const controller = controllerRef.current
    if (!root || !controller) return
    upgradeVisibleImages(root, controller.getState())
  }, [])

  // ⚠️ 刻意不 setState：视口每帧都在变，用 DOM 直写才能保住 17.3 要的手感
  const handleViewportChange = useCallback(
    (state: ViewportState) => {
      writeZoomLabel(state.zoom)
      // 每帧最多一次（ViewportController 已按帧合并通知）
      upgradeOriginals()
      onViewportChangeRef.current?.(state)
    },
    [writeZoomLabel, upgradeOriginals],
  )

  const handleViewportReady = useCallback(
    (controller: ViewportController) => {
      controllerRef.current = controller
      canvasRootRef.current =
        wrapperRef.current?.querySelector<HTMLElement>(`[${CANVAS_ROOT_ATTR}]`) ?? null

      // T1.6：恢复上一次保存的视图（只在挂载时应用一次，之后交给用户操作）
      const initial = initialViewRef.current
      if (initial) controller.setState(initial)

      writeZoomLabel(controller.zoom)
      onViewportChangeRef.current?.(controller.getState())
      upgradeOriginals()

      // T3.6：把屏幕 → 画布换算交给上层（拖入落点用）
      registerCanvasApiRef.current?.({
        screenToCanvasPoint: (clientX: number, clientY: number): Point => {
          const root = canvasRootRef.current
          if (!root) return { x: 0, y: 0 }
          const rect = root.getBoundingClientRect()
          return screenToCanvas(
            { x: clientX, y: clientY },
            controller.getState(),
            { left: rect.left, top: rect.top },
          )
        },
        // 小地图跳转（2026-09-12）：画布坐标 → 视口中心；offset 按容器尺寸反推，
        // setState 内部 applyToDom + notify，走正常视口变更链路（快照 / 小地图同步刷新）
        centerOn: (canvasPoint: Point): void => {
          const root = canvasRootRef.current
          if (!root) return
          controller.setState({
            zoom: controller.zoom,
            offsetX: root.clientWidth / 2 - canvasPoint.x * controller.zoom,
            offsetY: root.clientHeight / 2 - canvasPoint.y * controller.zoom,
          })
        },
        // 右键菜单「备注」对便签复用行内编辑（与双击同一编辑态）
        beginNoteEdit: (cardId: string): void => {
          const card = cardsRef.current.find((item) => item.id === cardId)
          if (card?.type !== 'note') return
          setEditingNoteId(cardId)
        },
        // 右键菜单「重命名分区」进入分区框改名编辑态（与双击标题同一编辑态，2026-09-14 修复）
        beginPartitionRename: (partitionId: string): void => {
          const partition = partitionsRef.current.find((item) => item.id === partitionId)
          if (!partition) return
          setEditingPartitionId(partitionId)
        },
      })
    },
    [writeZoomLabel, upgradeOriginals],
  )

  // 卡片集合变化（进空间 / 切空间）后，新挂载的图片要补判一次可见性
  useEffect(() => {
    upgradeOriginals()
  }, [cards, upgradeOriginals])

  // ---- T3.9 右键菜单：事件在画布根上统一拦截，命中对象交给上层生成菜单 ----
  useEffect(() => {
    const root = wrapperRef.current?.querySelector<HTMLElement>(`[${CANVAS_ROOT_ATTR}]`)
    if (!root) return

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault()

      const target = event.target as HTMLElement | null
      const screen = { x: event.clientX, y: event.clientY }

      // 连线右键（断开连接 / 编辑标签）：先于卡片判断（连线画在卡片之下，
      // 命中线是独立的 SVG path，closest 到 data-connection-id 即命中）
      const connectionElement = target?.closest(`[${CONNECTION_ID_ATTR}]`) as SVGPathElement | null
      if (connectionElement) {
        const connectionId = connectionElement.getAttribute(CONNECTION_ID_ATTR)
        if (connectionId) {
          onConnectionContextMenuRef.current?.(connectionId, screen)
          return
        }
      }

      const cardElement = target?.closest(`[${CARD_ID_ATTR}]`) as HTMLElement | null
      if (cardElement) {
        const card = cardsRef.current.find(
          (item) => item.id === cardElement.getAttribute(CARD_ID_ATTR),
        )
        if (card) {
          onCardContextMenuRef.current?.(card, screen)
          return
        }
      }

      const partitionElement = target?.closest(`[${PARTITION_ID_ATTR}]`) as HTMLElement | null
      if (partitionElement) {
        const partition = partitionsRef.current.find(
          (item) => item.id === partitionElement.getAttribute(PARTITION_ID_ATTR),
        )
        if (partition) {
          onPartitionContextMenuRef.current?.(partition, screen)
          return
        }
      }

      // 空白：给上层画布坐标（新建便签落点用）+ 屏幕坐标（浮层定位用）。
      // 已移除视图到此为止：灰卡右键上面已分发（恢复 / 彻底删除），空白不弹画布菜单
      if (removedModeRef.current) return
      onCanvasContextMenuRef.current?.(getCanvasPoint(event as unknown as PointerEvent), screen)
    }

    root.addEventListener('contextmenu', handleContextMenu)
    return () => root.removeEventListener('contextmenu', handleContextMenu)
  }, [getCanvasPoint])

  // ---- T3.5 / T3.4 双击卡片：note 进编辑，image / file 用系统程序打开 ----
  useEffect(() => {
    const root = wrapperRef.current?.querySelector<HTMLElement>(`[${CANVAS_ROOT_ATTR}]`)
    if (!root) return

    const handleDoubleClick = (event: MouseEvent) => {
      if (removedModeRef.current) return
      const target = event.target as HTMLElement | null
      const cardElement = target?.closest(`[${CARD_ID_ATTR}]`) as HTMLElement | null
      const card = cardsRef.current.find(
        (item) => item.id === cardElement?.getAttribute(CARD_ID_ATTR),
      )
      if (!card) return
      if (card.type === 'note') {
        // 双击便签：直接进入行内编辑（在便签本体内改文字，替代原编辑弹窗）
        setEditingNoteId(card.id)
      } else {
        onOpenCardRef.current?.(card)
      }
    }

    root.addEventListener('dblclick', handleDoubleClick)
    return () => root.removeEventListener('dblclick', handleDoubleClick)
  }, [])

  // 快捷键（5.3）：一律交给「快捷键注册中心」派发 —— 有哪些操作、默认按什么键、
  // 遗留组合键都在 core/shortcuts/keys，用户可在设置页改绑（2026-09-13）。
  // 2026-09-14：监听与派发整块抽到 useCanvasShortcuts（本文件行数已顶死，
  // 插件期还要往里埋钩子）。
  useCanvasShortcuts({
    controller: controllerRef,
    cards: cardsRef,
    partitions: partitionsRef,
    removedMode: removedModeRef,
    selectedIds: selectedIdsRef,
    onSelectCards: onSelectCardsRef,
    onRequestSearch: onRequestSearchRef,
    onRemoveCards: onRemoveCardsRef,
  })

  return (
    <div ref={wrapperRef} className="relative h-full w-full">
      <Viewport
        onReady={handleViewportReady}
        onChange={handleViewportChange}
        onItemPointerDown={handleItemPointerDown}
        onMarqueePointerDown={handleMarqueePointerDown}
        onBackgroundClick={handleBackgroundClick}
      >
        {/* 框选矩形放在卡片之下：半透明填充不遮内容，边框仍可见 */}
        <SelectionBox ref={selectionBoxRef} />

        {/* 分区框（T2.5）：渲染在卡片之下，半透明色块不抢内容焦点（12 章） */}
        {partitions.map((partition, index) => (
          <PartitionView
            key={partition.id}
            partition={partition}
            color={resolvePartitionColor(partition.color, index)}
            selected={selectedPartitionId === partition.id}
            registerEl={registerPartitionEl}
            onToggleCollapsed={handleTogglePartitionCollapsed}
            editing={partition.id === editingPartitionId}
            onBeginEdit={handlePartitionBeginEdit}
            onCancelEdit={handlePartitionCancelEdit}
            onRename={handlePartitionRename}
          />
        ))}

        {/* 对齐参考线（T2.4）：z-10，盖在卡片上方，纯展示不接事件 */}
        <SnapGuide ref={snapGuideRef} />

        {/* 连线层（T3.1/T3.2）：SVG 画在 stage 坐标系，缩放端点天然不错位 */}
        <ConnectionLayer
          ref={connectionLayerRef}
          connections={connections}
          cards={cards}
          selectedIds={selectedConnectionIds}
          interactive={!removedMode}
          onSelectConnection={(id) => onSelectConnections?.([id])}
          onEditConnection={onEditConnectionLabel}
        />

        {/* T3.1：拖出箭头过程中的临时线（DOM 直写）。
            与连线层同方案：固定大尺寸 + 平移组，不依赖 0×0 溢出绘制 */}
        <svg
          className="pointer-events-none absolute overflow-visible"
          style={{
            left: -CONNECTION_SVG_MARGIN,
            top: -CONNECTION_SVG_MARGIN,
            width: CONNECTION_SVG_TOTAL,
            height: CONNECTION_SVG_TOTAL,
          }}
        >
          <g transform={`translate(${CONNECTION_SVG_MARGIN} ${CONNECTION_SVG_MARGIN})`}>
            <path
              ref={tempConnectionRef}
              style={{ display: 'none' }}
              fill="none"
              strokeWidth={1.5}
              strokeDasharray="6 4"
              className="stroke-primary"
            />
          </g>
        </svg>

        {visibleCards.map((card) => (
          <CardView
            key={card.id}
            card={card}
            selected={selectedSet.has(card.id)}
            registerEl={registerCardEl}
            grayscale={removedMode}
            searchState={
              card.id === searchActiveId
                ? 'active'
                : searchHitSet.has(card.id)
                  ? 'hit'
                  : undefined
            }
            noteEditing={card.id === editingNoteId}
            onNoteEditFinish={handleNoteEditFinish}
          />
        ))}
      </Viewport>

      {/* 状态条：卡片数 / 缩放百分比 / 帧率 / 操作提示（对应 Ctrl+0） */}
      <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-3 rounded border border-border bg-card/90 px-2 py-1 text-xs text-muted-foreground shadow-sm">
        <span>{cards.length} 张</span>
        <span className="text-border">|</span>
        <span ref={zoomLabelRef}>100%</span>
        {/* 帧率表只服务于开发期手感验收（11.2 ~ 11.4），正式构建不渲染 */}
        {import.meta.env.DEV ? (
          <>
            <span className="text-border">|</span>
            <FpsMeter />
          </>
        ) : null}
        <span className="text-border">|</span>
        <span>滚轮缩放 · 拖空白平移 · 拖卡片移动 · Ctrl+拖框选</span>
      </div>

      <div className="absolute bottom-3 right-3 flex items-center gap-2">
        <button
          type="button"
          className="rounded border border-border bg-card/90 px-2 py-1 text-xs text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground"
          onClick={() =>
            controllerRef.current?.fitToContent(contentRects(cardsRef.current, partitionsRef.current))
          }
        >
          适应内容（Ctrl+Alt+0）
        </button>
        <button
          type="button"
          className="rounded border border-border bg-card/90 px-2 py-1 text-xs text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground"
          onClick={() => controllerRef.current?.reset()}
        >
          复原视图（Ctrl+0）
        </button>
      </div>
    </div>
  )
}
