// ============================================================================
// 模块说明（中文）
// 小地图组件（2026-09-12 新增）：固定在画布右下角，概览全部分区 / 卡片与当前
// 视口位置，支持点击 / 拖拽跳转；显示与隐藏由上层（Board）控制并记忆偏好。
//
// 【17.3 手感约束】视口每帧都在变 → 本组件**不订阅视口的 React state**：
//   上层在 handleViewportChange 里调用 registerRedraw 登记的绘制函数，
//   直接重画 2D canvas（每帧一次，零 React 更新）。
//   卡片 / 分区是低频数据，走 props（Zustand 订阅）。
//
// 【主题适配】矩形颜色从 CSS 变量读取（--foreground / --primary），
//   深 / 浅主题切换后下一帧自动跟随；分区沿用 resolvePartitionColor 的 8 色。
//
// 【尺寸】面板体 208×132 CSS 像素，按 devicePixelRatio 放大BackingStore，清晰不糊。
// ============================================================================

import { useCallback, useEffect, useRef } from 'react'

import type { Card, Partition } from '@/core/types'
import { PARTITION_TITLE_HEIGHT, resolvePartitionColor } from '@/core/board/partitions'
import { getViewportSnapshot } from './viewportSnapshot'
import { visibleCanvasRect } from './lazyOriginal'
import {
  applyTransform,
  fitTransform,
  invertTransform,
} from './minimapGeometry'
import type { MinimapTransform } from './minimapGeometry'
import { unionRects } from '@/core/geometry/rect'
import type { Rect } from '@/core/geometry/rect'

/** 小地图显示偏好在 localStorage 的键（'visible' / 'hidden'） */
export const MINIMAP_PREF_KEY = 'mindscape.minimap'

/** 面板体尺寸（CSS 像素）与四周留白 */
const MINIMAP_VIEW_W = 208
const MINIMAP_VIEW_H = 132
const MINIMAP_PADDING = 8

/** 从 CSS 变量读主题色（shadcn 的变量值是 HSL 三元组，需包一层 hsl()） */
function cssColor(varName: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  return value ? `hsl(${value})` : fallback
}

export interface MiniMapProps {
  cards: Card[]
  partitions: Partition[]
  /** 点击 / 拖拽小地图：把对应画布坐标变为视口中心（上层走 CanvasApi.centerOn） */
  onJump?: (canvasPoint: { x: number; y: number }) => void
  /** 登记每帧重绘函数（视口变化时由上层调用，零 React 更新） */
  registerRedraw?: (fn: () => void) => void
  /** 点击「收起」 */
  onCollapse?: () => void
}

export function MiniMap({ cards, partitions, onJump, registerRedraw, onCollapse }: MiniMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  /** 最近一次绘制用的变换（点击跳转时做小地图 → 画布坐标反解） */
  const transformRef = useRef<MinimapTransform | null>(null)
  const pressingRef = useRef(false)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    // BackingStore 按 dpr 放大，绘制逻辑全部用 CSS 像素
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== MINIMAP_VIEW_W * dpr || canvas.height !== MINIMAP_VIEW_H * dpr) {
      canvas.width = MINIMAP_VIEW_W * dpr
      canvas.height = MINIMAP_VIEW_H * dpr
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.clearRect(0, 0, MINIMAP_VIEW_W, MINIMAP_VIEW_H)

    // 当前视口矩形（可见区反算，与主画布懒加载同一套几何）
    const view = getViewportSnapshot()
    const root = document.querySelector('[data-canvas-root]')
    const viewportRect: Rect | null = root
      ? visibleCanvasRect(view, root.clientWidth, root.clientHeight)
      : null

    // 折叠分区按标题条高度计入（与主画布视觉一致）
    const sizedPartitions = partitions.map((partition) => ({
      ...partition,
      h: partition.collapsed ? PARTITION_TITLE_HEIGHT : partition.h,
    }))

    const bounds =
      unionRects([...sizedPartitions, ...cards, viewportRect]) ?? { x: -400, y: -400, w: 800, h: 800 }
    const transform = fitTransform(bounds, MINIMAP_VIEW_W, MINIMAP_VIEW_H, MINIMAP_PADDING)
    transformRef.current = transform

    // 分区框：色板填充 + 描边
    sizedPartitions.forEach((partition, index) => {
      const origin = applyTransform({ x: partition.x, y: partition.y }, transform)
      const color = resolvePartitionColor(partition.color, index)
      context.globalAlpha = 0.3
      context.fillStyle = color
      context.fillRect(origin.x, origin.y, partition.w * transform.scale, partition.h * transform.scale)
      context.globalAlpha = 0.7
      context.strokeStyle = color
      context.lineWidth = 1
      context.strokeRect(origin.x, origin.y, partition.w * transform.scale, partition.h * transform.scale)
    })

    // 卡片：前景色小块（最小 2px，缩得很小时仍可见）
    context.globalAlpha = 0.55
    context.fillStyle = cssColor('--foreground', '#888888')
    for (const card of cards) {
      const origin = applyTransform({ x: card.x, y: card.y }, transform)
      context.fillRect(
        origin.x,
        origin.y,
        Math.max(2, card.w * transform.scale),
        Math.max(2, card.h * transform.scale),
      )
    }

    // 当前视口：主色描边 + 淡填充（「你现在在这里」）
    if (viewportRect) {
      const origin = applyTransform({ x: viewportRect.x, y: viewportRect.y }, transform)
      const w = viewportRect.w * transform.scale
      const h = viewportRect.h * transform.scale
      context.globalAlpha = 0.1
      context.fillStyle = cssColor('--primary', '#5A7D6A')
      context.fillRect(origin.x, origin.y, w, h)
      context.globalAlpha = 0.9
      context.strokeStyle = cssColor('--primary', '#5A7D6A')
      context.lineWidth = 1.5
      context.strokeRect(origin.x, origin.y, w, h)
    }

    context.globalAlpha = 1
  }, [cards, partitions])

  // 卡片 / 分区变化（进空间、增删、移动落盘）→ 重绘一次
  useEffect(() => {
    draw()
  }, [draw])

  // 登记给上层：视口每帧变化时直呼 draw（不经过 React）
  useEffect(() => {
    registerRedraw?.(draw)
  }, [registerRedraw, draw])

  /** 小地图点击位置 → 画布坐标 → 请求视口跳转 */
  const jumpFrom = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current
      const transform = transformRef.current
      if (!canvas || !transform || !onJump) return
      const rect = canvas.getBoundingClientRect()
      onJump(invertTransform({ x: clientX - rect.left, y: clientY - rect.top }, transform))
    },
    [onJump],
  )

  return (
    <div
      className="absolute bottom-12 right-3 z-20 overflow-hidden rounded-lg border border-border bg-background/90 shadow-md backdrop-blur-sm"
      data-minimap=""
    >
      <div className="flex h-7 items-center justify-between border-b border-border/60 px-2">
        <span className="text-[11px] text-muted-foreground">小地图</span>
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onCollapse}
          title="收起小地图"
          className="flex h-4 w-4 items-center justify-center rounded text-[11px] leading-none text-foreground/60 hover:bg-foreground/10"
        >
          ✕
        </button>
      </div>
      <canvas
        ref={canvasRef}
        style={{ width: `${MINIMAP_VIEW_W}px`, height: `${MINIMAP_VIEW_H}px` }}
        className="block cursor-crosshair"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          pressingRef.current = true
          jumpFrom(event.clientX, event.clientY)
        }}
        onPointerMove={(event) => {
          if (pressingRef.current) jumpFrom(event.clientX, event.clientY)
        }}
        onPointerUp={() => {
          pressingRef.current = false
        }}
        onPointerCancel={() => {
          pressingRef.current = false
        }}
      />
    </div>
  )
}
