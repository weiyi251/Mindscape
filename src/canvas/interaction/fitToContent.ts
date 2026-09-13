// ============================================================================
// 模块说明（中文）
// 「缩放到全部内容」（P1-4，Ctrl+Shift+0）的纯计算层。
//
// 对应计划要求：计算所有卡片 / 分区包围盒 → 反解 zoom / offset，
// 写入动作在 ViewportController.fitToContent（直写 style.transform，不经过
// React state，守 17.3 红线）—— 本模块只负责「算」，不碰 DOM。
//
// 几何口径（与 MiniMap 一致）：
//   · 卡片按其 x/y/w/h；折叠分区按「标题条高度」参与包围盒（PARTITION_TITLE_HEIGHT），
//     否则收起的长分区会把视口撑得远超实际所见
//
// 适配规则（与 Figma「缩放以适应」同思路）：
//   · zoom = min(可用宽 / 内容宽, 可用高 / 内容高)，再钳到 [MIN_ZOOM, MAX_ZOOM]
//     —— 内容比视口小时会**放大**到贴合（留边），小到离谱由 MAX_ZOOM 兜底
//   · 包围盒中心对准视口中心
//   · 空内容 / 视口尺寸非法 → 返回 null，由调用方决定退化行为（本产品选择不动）
//
// 纯函数，node 环境直接单测。
//
// 实现任务：P1-4。
// ============================================================================

import { PARTITION_TITLE_HEIGHT } from '@/core/board/partitions'
import type { Card, Partition } from '@/core/types'

import { clampZoom } from './coordinates'
import type { ViewportState } from './coordinates'

/** 参与包围盒计算的矩形（画布坐标） */
export interface FitRect {
  x: number
  y: number
  w: number
  h: number
}

/** 默认四周留白（CSS 像素）：完全贴边会显得顶格，不好看也不好点 */
const FIT_PADDING = 40

/** 卡片 + 分区 → 参与适配的矩形集合（折叠分区按标题条高度算，见文件顶部说明） */
export function contentRects(
  cards: readonly Pick<Card, 'x' | 'y' | 'w' | 'h'>[],
  partitions: readonly Partition[],
): FitRect[] {
  return [
    ...cards.map((card) => ({ x: card.x, y: card.y, w: card.w, h: card.h })),
    ...partitions.map((partition) => ({
      x: partition.x,
      y: partition.y,
      w: partition.w,
      h: partition.collapsed ? PARTITION_TITLE_HEIGHT : partition.h,
    })),
  ]
}

/** 所有矩形的包围盒；空集合返回 null */
export function unionRects(rects: readonly FitRect[]): FitRect | null {
  if (rects.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const rect of rects) {
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
    maxX = Math.max(maxX, rect.x + rect.w)
    maxY = Math.max(maxY, rect.y + rect.h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export interface FitViewportOptions {
  /** 视口尺寸（CSS 像素，来自画布根容器的 rect） */
  width: number
  height: number
  /** 四周留白；缺省 FIT_PADDING */
  padding?: number
}

/**
 * 由矩形集合反解视口状态。
 * 返回 null 的情况：没有内容、或视口尺寸非法（0 / NaN）—— 调用方应保持现状不动。
 */
export function fitViewportState(
  rects: readonly FitRect[],
  options: FitViewportOptions,
): ViewportState | null {
  const bounds = unionRects(rects)
  if (!bounds) return null

  const { width, height } = options
  if (!(width > 0) || !(height > 0)) return null

  const padding = options.padding ?? FIT_PADDING
  // 视口小到放不下两侧留白时，按 1px 可用区算，保证仍能得到一个合法 zoom
  const usableWidth = Math.max(width - padding * 2, 1)
  const usableHeight = Math.max(height - padding * 2, 1)
  const boundsWidth = Math.max(bounds.w, 1)
  const boundsHeight = Math.max(bounds.h, 1)

  const zoom = clampZoom(Math.min(usableWidth / boundsWidth, usableHeight / boundsHeight))
  const centerX = bounds.x + bounds.w / 2
  const centerY = bounds.y + bounds.h / 2

  // 容器内坐标 = 画布坐标 × zoom + offset；令包围盒中心落在视口中心
  return {
    zoom,
    offsetX: width / 2 - centerX * zoom,
    offsetY: height / 2 - centerY * zoom,
  }
}
