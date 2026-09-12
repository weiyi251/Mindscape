// ============================================================================
// 模块说明（中文）
// 小地图（2026-09-12 新增）的纯计算部分：内容包围盒、画布 → 小地图的映射变换。
//
// 为什么单独拆出来：绘制本身是 DOM/canvas 胶水（不进 React state，17.3），
// 但「框住全部内容 + 等比缩放 + 坐标互转」是纯几何，可脱离 DOM 单测。
// ⚠️ 文件名用 minimapGeometry（而不是 minimap）：与组件 MiniMap.tsx 在
// Windows 大小写不敏感文件系统上只差一个字母，会触发 TS 大小写冲突。
//
// 映射约定：小地图坐标 = 画布坐标 × scale + offset（先等比缩放再平移居中）。
// ============================================================================

/** 画布坐标系 / 小地图坐标系通用的矩形 */
export interface BoundsRect {
  x: number
  y: number
  w: number
  h: number
}

/** 画布 → 小地图的线性变换：mx = x * scale + offsetX */
export interface MinimapTransform {
  scale: number
  offsetX: number
  offsetY: number
}

/**
 * 一组矩形的并集包围盒；空输入（或全为 null）返回 null。
 * 用于把卡片 / 分区 / 当前视口框一起框进小地图视野。
 */
export function unionRects(
  rects: readonly (BoundsRect | null | undefined)[],
): BoundsRect | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const rect of rects) {
    if (!rect) continue
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
    maxX = Math.max(maxX, rect.x + rect.w)
    maxY = Math.max(maxY, rect.y + rect.h)
  }

  if (!Number.isFinite(minX)) return null
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/**
 * 计算把 bounds 等比缩放后居中放进 viewW × viewH（四周留 padding）的变换。
 * 退化输入（宽或高为 0，如空内容）按 1 处理，scale 兜底为 1，避免除零。
 */
export function fitTransform(
  bounds: BoundsRect,
  viewW: number,
  viewH: number,
  padding: number,
): MinimapTransform {
  const innerW = Math.max(1, viewW - padding * 2)
  const innerH = Math.max(1, viewH - padding * 2)
  const w = Math.max(1, bounds.w)
  const h = Math.max(1, bounds.h)

  const scale = Math.min(innerW / w, innerH / h)
  const offsetX = padding + (innerW - w * scale) / 2 - bounds.x * scale
  const offsetY = padding + (innerH - h * scale) / 2 - bounds.y * scale

  return { scale, offsetX, offsetY }
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
