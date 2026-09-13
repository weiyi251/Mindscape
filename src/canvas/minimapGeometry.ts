// ============================================================================
// 模块说明（中文）
// 小地图（2026-09-12 新增）的纯计算部分：画布 → 小地图的映射变换。
//
// 为什么单独拆出来：绘制本身是 DOM/canvas 胶水（不进 React state，17.3），
// 但「等比缩放 + 坐标互转」是纯几何，可脱离 DOM 单测。
// ⚠️ 文件名用 minimapGeometry（而不是 minimap）：与组件 MiniMap.tsx 在
// Windows 大小写不敏感文件系统上只差一个字母，会触发 TS 大小写冲突。
//
// 映射约定：小地图坐标 = 画布坐标 × scale + offset（先等比缩放再平移居中）。
//
// 2026-09-14 去重：原先本文件自带一份 `unionRects` 与 `fitTransform`，
// 与 canvas/interaction/fitToContent.ts 的实现逐行相同。现统一到
// `core/geometry/rect.ts`（`Rect` / `unionRects` / `scaleToFit`），
// 本文件只保留小地图特有的**命名与输出形态**。
// ============================================================================

import { scaleToFit } from '@/core/geometry/rect'
import type { Rect } from '@/core/geometry/rect'

/** 画布 → 小地图的线性变换：mx = x * scale + offsetX */
export interface MinimapTransform {
  scale: number
  offsetX: number
  offsetY: number
}

/**
 * 计算把 bounds 等比缩放后居中放进 viewW × viewH（四周留 padding）的变换。
 * 退化输入（宽或高为 0，如空内容）按 1 处理，scale 兜底为 1，避免除零。
 *
 * 实现委托给 core/geometry/rect.ts 的 scaleToFit（同一算法，唯一的差异是本函数
 * 收 viewW / viewH 两个参数而非 view 对象 —— 保持既有调用点不变）。
 */
export function fitTransform(
  bounds: Rect,
  viewW: number,
  viewH: number,
  padding: number,
): MinimapTransform {
  return scaleToFit(bounds, { width: viewW, height: viewH }, padding)
}

/** 画布坐标 → 小地图坐标 */
export function applyTransform(
  point: { x: number; y: number },
  transform: MinimapTransform,
): { x: number; y: number } {
  return {
    x: point.x * transform.scale + transform.offsetX,
    y: point.y * transform.scale + transform.offsetY,
  }
}

/** 小地图坐标 → 画布坐标（点击跳转用，applyTransform 的逆） */
export function invertTransform(
  point: { x: number; y: number },
  transform: MinimapTransform,
): { x: number; y: number } {
  return {
    x: (point.x - transform.offsetX) / transform.scale,
    y: (point.y - transform.offsetY) / transform.scale,
  }
}
