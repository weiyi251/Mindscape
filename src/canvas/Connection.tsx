// ============================================================================
// 模块说明（中文）
// 卡片连线层（T3.1 / T3.2）。对应开发计划书第十三章：连线是「思路整理」的核心能力。
//
// 设计要点（17.3 / 17.4）：
//   · SVG 画在 **stage 坐标系**内（与卡片同一套 transform 变换）——
//     缩放 / 平移时端点天然不错位，标签也随连线缩放（T3.2 验收标准），
//     不需要任何 viewport 补偿。
//   · svg 根元素 pointer-events-none + 0 尺寸 overflow-visible：
//     不挡卡片点击；每条 path 单独开 pointer-events:stroke 命中（6px 视觉线宽）。
//   · 拖动卡片时 React 不重渲染 —— ConnectionLayer.refresh() 由 Canvas 在
//     window pointermove 里调用，直读卡片 DOM 的 translate3d 重算端点，
//     直写 path 的 d 属性（零 setState，保住拖拽手感）。
//   · 选中 / 双击 / 删除是低频操作，走 React 回调（Canvas → Board → 命令系统）。
//
// 几何计算全部在 interaction/connectionAnchor.ts（纯函数）。
// 实现任务：T3.1 / T3.2。
// ============================================================================

import { forwardRef, useImperativeHandle, useRef } from 'react'

import type { Card, Connection } from '@/core/types'
import { itemAnchorsOfMeta } from '@/core/board/cardMeta'
import { connectionAnchorsWithItems, connectionPathD, rectCenter } from './interaction/connectionAnchor'
import type { Point, Rect } from './interaction/connectionAnchor'

/** 标记「连线 path」的属性：命中与双击编辑靠它反查连线 id */
export const CONNECTION_ID_ATTR = 'data-connection-id'

/** 单击选中连线的命中容差（画布坐标） */
const CONNECTION_HIT_WIDTH = 8

/**
 * 连线 SVG 层的几何方案：**固定大尺寸 + 平移组**。
 * ⚠️ 修复记录：此前用「0×0 + overflow-visible」让内容溢出元素框绘制，
 * 但 WebView2 对零尺寸 SVG 根的溢出绘制不可靠（连线整层不可见的兜底原因）。
 * 现改为明确尺寸：画布原点 (0,0) 映射到 SVG 层中心，四向各留 100000px；
 * 溢出内容仍保留 overflow-visible 兜底。
 */
export const CONNECTION_SVG_MARGIN = 100_000
export const CONNECTION_SVG_TOTAL = CONNECTION_SVG_MARGIN * 2

export interface ConnectionLayerProps {
  connections: Connection[]
  cards: Card[]
  /** 选中的连线 id（高亮） */
  selectedIds: string[]
  /** 单击连线 */
  onSelectConnection?: (id: string) => void
  /** 双击连线（编辑标签，T3.2） */
  onEditConnection?: (id: string) => void
  /** 已移除视图等场景整体禁用交互 */
  interactive?: boolean
}

export interface ConnectionLayerHandle {
  /**
   * 拖动卡片时由 Canvas 每帧调用：直读卡片 DOM 位置重算全部连线端点。
   * 卡片 DOM 不存在（折叠分区 / 已删除）时退回 store 里的 x/y。
   */
  refresh: () => void
}

/** 连线颜色（4.2 默认 gray；其余颜色 key 预留给插件）。
 *  ⚠️ 必须用 Tailwind 类承载（见模块说明：var() 不能写在 SVG 表现属性里）。 */
const STROKE_CLASS: Record<string, string> = {
  gray: 'stroke-muted-foreground',
}

function strokeClass(key: string): string {
  return STROKE_CLASS[key] ?? STROKE_CLASS.gray
}

/**
 * 卡片当前矩形：优先直读 DOM transform / 尺寸（拖动 / 缩放中的实时值），
 * 读不到再用数据坐标。w/h 来自数据或 DOM 直读（缩放控制器直写 width/height）。
 */
function cardRect(
  cards: Card[],
  domPos: Map<string, Point>,
  domSize: Map<string, { w: number; h: number }>,
  id: string,
): Rect | null {
  const card = cards.find((item) => item.id === id)
  if (!card) return null
  const position = domPos.get(id) ?? { x: card.x, y: card.y }
  const size = domSize.get(id) ?? { w: card.w, h: card.h }
  return { x: position.x, y: position.y, w: size.w, h: size.h }
}

/** 解析元素 style.transform 里的 translate3d(x px, y px, ...)；没有则返回 null */
function readTranslate3d(element: HTMLElement | null | undefined): Point | null {
  const transform = element?.style.transform
  if (!transform) return null
  const match = /translate3d\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px/.exec(transform)
  if (!match) return null
  return { x: Number(match[1]), y: Number(match[2]) }
}

/**
 * 条目偏移查询（2026-09-17 条目级连线）：连线端声明了条目 id 时，
 * 从对应卡片的 meta.itemAnchors 协议表查条目行 y 偏移；未声明 / 查不到
 * 都返回 undefined —— 锚点计算退回整卡中点（旧数据兼容）。
 */
function itemOffsetFor(cards: Card[], cardId: string, itemId: string | undefined): number | undefined {
  if (!itemId) return undefined
  const card = cards.find((item) => item.id === cardId)
  return card ? itemAnchorsOfMeta(card.meta)[itemId] : undefined
}

/** 读内联样式的像素值（缩放控制器直写的 width / height）；没有则返回 null */
function readPx(value: string | undefined): number | null {
  if (!value) return null
  const match = /^(-?[\d.]+)px$/.exec(value.trim())
  return match ? Number(match[1]) : null
}

export const ConnectionLayer = forwardRef<ConnectionLayerHandle, ConnectionLayerProps>(
  function ConnectionLayer(
    { connections, cards, selectedIds, onSelectConnection, onEditConnection, interactive = true },
    ref,
  ) {
    const svgRef = useRef<SVGSVGElement>(null)
    /** 连线 id → 该条连线涉及的可直写节点（path + 标签 g），refresh 用 */
    const nodesRef = useRef(new Map<string, { path: SVGPathElement; label: SVGGElement | null }>())

    useImperativeHandle(ref, () => ({
      refresh() {
        // 拖动 / 缩放中的卡片实时几何：从 DOM 直读（Canvas 已把 cardElsRef 传进来）
        const domPos = new Map<string, Point>()
        const domSize = new Map<string, { w: number; h: number }>()
        for (const connection of connections) {
          for (const id of [connection.from, connection.to]) {
            if (domPos.has(id)) continue
            const element = svgRef.current
              ?.closest('[data-canvas-stage]')
              ?.querySelector<HTMLElement>(`[data-card-id="${id}"]`)
            const position = readTranslate3d(element)
            if (position) domPos.set(id, position)
            const w = readPx(element?.style.width)
            const h = readPx(element?.style.height)
            if (w !== null && h !== null) domSize.set(id, { w, h })
          }
        }

        for (const connection of connections) {
          const nodes = nodesRef.current.get(connection.id)
          if (!nodes) continue
          const from = cardRect(cards, domPos, domSize, connection.from)
          const to = cardRect(cards, domPos, domSize, connection.to)
          if (!from || !to) continue

          const { start, end } = connectionAnchorsWithItems(
            from,
            to,
            itemOffsetFor(cards, connection.from, connection.fromItem),
            itemOffsetFor(cards, connection.to, connection.toItem),
          )
          nodes.path.setAttribute('d', connectionPathD(start, end))

          if (nodes.label && connection.label) {
            const middle = bezierMiddle(start, end)
            nodes.label.setAttribute('transform', `translate(${middle.x}, ${middle.y})`)
          }
        }
      },
    }))

    return (
      <svg
        ref={svgRef}
        className="pointer-events-none absolute overflow-visible"
        style={{
          left: -CONNECTION_SVG_MARGIN,
          top: -CONNECTION_SVG_MARGIN,
          width: CONNECTION_SVG_TOTAL,
          height: CONNECTION_SVG_TOTAL,
        }}
        aria-hidden={false}
      >
        {/* 箭头 marker：端点颜色继承连线的 stroke（context-stroke 兼容性不足，用固定灰） */}
        <defs>
          <marker
            id="mindscape-connection-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 9 5 L 0 9 z" className="fill-muted-foreground" />
          </marker>
        </defs>

        {/* 平移组：stage 画布原点 (0,0) 映射到 SVG 层中心，path 坐标仍是 stage 坐标 */}
        <g transform={`translate(${CONNECTION_SVG_MARGIN} ${CONNECTION_SVG_MARGIN})`}>
        {connections.map((connection) => {
          const from = cardRect(cards, new Map(), new Map(), connection.from)
          const to = cardRect(cards, new Map(), new Map(), connection.to)
          if (!from || !to) return null // 端点卡片不存在（数据残留）：不渲染

          const { start, end } = connectionAnchorsWithItems(
            from,
            to,
            itemOffsetFor(cards, connection.from, connection.fromItem),
            itemOffsetFor(cards, connection.to, connection.toItem),
          )
          const selected = selectedIds.includes(connection.id)
          const middle = rectCenter({
            x: Math.min(start.x, end.x),
            y: Math.min(start.y, end.y),
            w: Math.abs(end.x - start.x),
            h: Math.abs(end.y - start.y),
          })
          const labelWidth = estimateLabelWidth(connection.label)

          return (
            <g key={connection.id}>
              {/* 加宽的透明命中线：细线难点中，用 12px 透明线承接单击/双击 */}
              <path
                d={connectionPathD(start, end)}
                fill="none"
                stroke="transparent"
                strokeWidth={CONNECTION_HIT_WIDTH}
                style={interactive ? { pointerEvents: 'stroke' } : undefined}
                className={interactive ? 'cursor-pointer' : undefined}
                {...{ [CONNECTION_ID_ATTR]: connection.id }}
                onPointerDown={
                  interactive
                    ? (event) => {
                        event.stopPropagation()
                        onSelectConnection?.(connection.id)
                      }
                    : undefined
                }
                onDoubleClick={
                  interactive
                    ? (event) => {
                        event.stopPropagation()
                        onEditConnection?.(connection.id)
                      }
                    : undefined
                }
              />
              <path
                ref={(element) => {
                  if (element) nodesRef.current.set(connection.id, { path: element, label: null })
                  else nodesRef.current.delete(connection.id)
                }}
                d={connectionPathD(start, end)}
                fill="none"
                className={selected ? 'stroke-primary' : strokeClass(connection.color)}
                strokeWidth={selected ? 2.5 : 1.5}
                markerEnd="url(#mindscape-connection-arrow)"
              />
              {connection.label ? (
                <g
                  ref={(element) => {
                    const nodes = nodesRef.current.get(connection.id)
                    if (nodes) nodes.label = element
                  }}
                  transform={`translate(${middle.x}, ${middle.y})`}
                >
                  <rect
                    x={-(labelWidth / 2 + 6)}
                    y={-11}
                    width={labelWidth + 12}
                    height={20}
                    rx={4}
                    className="fill-background stroke-border"
                  />
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="fill-foreground select-none"
                    style={{ fontSize: 11 }}
                  >
                    {connection.label}
                  </text>
                </g>
              ) : null}
            </g>
          )
        })}
        </g>
      </svg>
    )
  },
)

/** 三次贝塞尔 t=0.5 的点：(p0 + 3c1 + 3c2 + p3) / 8 */
function bezierMiddle(start: Point, end: Point): Point {
  const dx = end.x - start.x
  const bend = Math.max(Math.abs(dx) / 2, 40)
  const c1 = { x: start.x + bend, y: start.y }
  const c2 = { x: end.x - bend, y: end.y }
  return {
    x: (start.x + 3 * c1.x + 3 * c2.x + end.x) / 8,
    y: (start.y + 3 * c1.y + 3 * c2.y + end.y) / 8,
  }
}

/** 估算标签宽度（中文≈字号、ASCII≈0.6 字号；够用，避免拖动中每帧 getBBox） */
function estimateLabelWidth(label: string): number {
  let width = 0
  for (const char of label) width += char.charCodeAt(0) > 0xff ? 11 : 6.6
  return Math.max(width, 16)
}
