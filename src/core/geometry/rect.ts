// ============================================================================
// 模块说明（中文）
// 通用矩形几何：包围盒并集 + 等比缩放适配变换。
//
// 【为什么要有这个文件（2026-09-14 建立）】
//   下列实现原先是**两份逐行相同的私有副本**，只是类型名不同：
//     · canvas/minimapGeometry.ts  unionRects / fitTransform（类型叫 BoundsRect）
//     · canvas/interaction/fitToContent.ts  unionRects / fitViewportState（类型叫 FitRect）
//   另有 4+ 处各自声明的 `{ x, y, w, h }` 矩形类型（CanvasBounds / ModalRect …）。
//   重复的算法意味着「改一处漏一处」——事实上两份 unionRects 的**空输入语义**已经
//   出现了细微分野（一份跳过 null 项，另一份只在长度为 0 时早退）。
//   这里统一为唯一实现，调用方各自包装输出形态（是否 clampZoom、字段命名等）。
//
// 坐标系无关：本模块只做纯算术，既用于画布坐标，也用于小地图 / 视口坐标。
// 纯函数，可 100% 单元测试覆盖。
// ============================================================================

/** 轴对齐矩形。x / y 为左上角，w / h 为宽高（全部是同一坐标系下的同一单位） */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** 等比缩放 + 平移的变换结果：`目标 = 源 × scale + offset` */
export interface FitTransform {
  scale: number
  offsetX: number
  offsetY: number
}

/**
 * 一组矩形的并集包围盒。
 * · `null` / `undefined` 项被**跳过**（便于直接传「可能不存在的视口框 / 分区框」）
 * · 一个有效矩形都没有时返回 `null`，调用方据此决定退化行为
 */
export function unionRects(rects: readonly (Rect | null | undefined)[]): Rect | null {
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
 * 计算把 `bounds` 等比缩放后塞进 `view`（四周留 `padding`）所需的**缩放比**：
 *
 *   scale = min(可用宽 / 内容宽, 可用高 / 内容高)
 *
 * 退化输入（可用区或内容宽高为 0 / 负）一律按 1 处理，保证返回值恒为有限正数。
 *
 * ⚠️ **不做缩放钳制**。需要钳进 [MIN_ZOOM, MAX_ZOOM] 的调用方自己包一层，并且
 * **必须用钳制后的值再去算偏移量** —— 否则内容会被摆到视口外（见 fitToContent）。
 */
export function fitScale(
  bounds: Rect,
  view: { width: number; height: number },
  padding: number,
): number {
  const innerW = Math.max(1, view.width - padding * 2)
  const innerH = Math.max(1, view.height - padding * 2)
  const w = Math.max(1, bounds.w)
  const h = Math.max(1, bounds.h)

  return Math.min(innerW / w, innerH / h)
}

/**
 * 在**已确定的 scale** 下，算出把 bounds 居中放进「视口内缩 padding 的可用区」的平移量。
 *
 * 与 fitScale 配对使用，便于调用方先钳制 scale 再求偏移（顺序不能颠倒）。
 * 两个性质：可用区中心恒等于视口中心（`padding + 可用宽/2 ≡ view.width/2`，
 * 只要 padding 没大到把可用区压成 1px）；scale 为 0 时 offsets 退化为 padding + 居中修正。
 */
export function centeredOffset(
  bounds: Rect,
  view: { width: number; height: number },
  padding: number,
  scale: number,
): { offsetX: number; offsetY: number } {
  const innerW = Math.max(1, view.width - padding * 2)
  const innerH = Math.max(1, view.height - padding * 2)
  const w = Math.max(1, bounds.w)
  const h = Math.max(1, bounds.h)

  return {
    offsetX: padding + (innerW - w * scale) / 2 - bounds.x * scale,
    offsetY: padding + (innerH - h * scale) / 2 - bounds.y * scale,
  }
}

/**
 * `fitScale` + `centeredOffset` 的组合：一步得到完整的等比缩放适配变换。
 *
 * 这是「把小内容整体框进一块区域」的常见需求（小地图、缩略预览）；
 * 需要钳制缩放、或按视口中心而非可用区中心对齐的调用方（如「适应内容」），
 * 请改用上面两个函数自行组合，并注意**先钳制 scale，再算 offset**。
 */
export function scaleToFit(
  bounds: Rect,
  view: { width: number; height: number },
  padding: number,
): FitTransform {
  const scale = fitScale(bounds, view, padding)
  return { scale, ...centeredOffset(bounds, view, padding, scale) }
}
