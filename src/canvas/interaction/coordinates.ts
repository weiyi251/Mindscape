// ============================================================================
// 模块说明（中文）
// 坐标系换算工具。对应开发计划书 17.4 的「坐标系换算（必须统一）」：
//
//   画布坐标 = (屏幕坐标 - 画布容器左上角 - offset) / zoom
//   屏幕坐标 = 画布坐标 * zoom + offset + 画布容器左上角
//
// 铁律：所有涉及位置的逻辑（拖拽、吸附、框选、连线端点）**一律先换算到画布坐标系
// 再计算**，否则缩放后必然错位。
//
// 本文件是纯函数模块（不碰 DOM、不碰 React），因此可被 100% 单元测试覆盖。
// viewport 的 transform 与 DOM 写入在 viewportController.ts。
//
// 实现任务：T0.11（准备层）。
// ============================================================================

/** 屏幕坐标 / 画布坐标通用点 */
export interface Point {
  x: number
  y: number
}

/** 视口变换状态（与 core/types.ts 的 CanvasState 字段一致，便于落盘往返） */
export interface ViewportState {
  zoom: number
  offsetX: number
  offsetY: number
}

/** 画布容器左上角在屏幕坐标中的位置（来自 getBoundingClientRect） */
export interface ContainerOrigin {
  left: number
  top: number
}

/**
 * 缩放范围 10% ~ 400%。
 * 依据 11.3「缩放范围 10% ~ 400%」——注意不是任意值，两端都要钳制。
 */
export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 4

/** 滚轮灵敏度：zoom 乘数按 exp(-deltaY * k) 变化，保证上下滚对称抵消 */
const WHEEL_ZOOM_SENSITIVITY = 0.0015

/**
 * 11.3「到边界有阻尼感」的两个参数：
 *   · ZOOM_OVERSHOOT_LIMIT —— 允许越过边界的比例（8%）。超过就完全推不动了。
 *   · ZOOM_DAMPING_RATIO   —— 越界增量的衰减系数（0.3）。越小越"硬"。
 * 两者都是手感参数，文档未给具体值，由用户实操后微调。
 */
export const ZOOM_OVERSHOOT_LIMIT = 0.08
export const ZOOM_DAMPING_RATIO = 0.3

/**
 * 钳制缩放值到 11.3 规定的区间。
 * NaN 回落 1（100%）；±Infinity 按方向钳到边界（避免滚轮增量溢出时缩放跳回 100%）。
 */
export function clampZoom(zoom: number): number {
  if (Number.isNaN(zoom)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/**
 * 给缩放目标加上**边界阻尼**（11.3「到边界有阻尼感」）。
 *
 * 行为：在 [10%, 400%] 内原样返回；越界后把超出部分乘 ZOOM_DAMPING_RATIO 衰减，
 * 并把衰减后的越界量限制在 ZOOM_OVERSHOOT_LIMIT 以内。
 * 也就是说滚到头之后"还能再推一点点，但会明显变沉"，松手后由 controller 回弹到边界。
 *
 * 例：400% 上限，用户继续滚到理想值 600%
 *   → 越界 (6-4)/4 = 0.5 → 衰减 0.15 → 超过 8% 上限 → 钳到 4 × 1.08 = 432%
 *
 * 非法值（NaN / Infinity / ≤0）直接交给 clampZoom 处理，不参与阻尼。
 */
export function dampZoom(target: number): number {
  if (!Number.isFinite(target) || target <= 0) return clampZoom(target)
  if (target >= MIN_ZOOM && target <= MAX_ZOOM) return target

  const bound = target > MAX_ZOOM ? MAX_ZOOM : MIN_ZOOM
  const overshoot = (target - bound) / bound
  const damped = overshoot * ZOOM_DAMPING_RATIO
  const capped = Math.max(-ZOOM_OVERSHOOT_LIMIT, Math.min(ZOOM_OVERSHOOT_LIMIT, damped))

  return bound * (1 + capped)
}

/** 屏幕坐标 → 画布坐标 */
export function screenToCanvas(
  screen: Point,
  viewport: ViewportState,
  origin: ContainerOrigin,
): Point {
  return {
    x: (screen.x - origin.left - viewport.offsetX) / viewport.zoom,
    y: (screen.y - origin.top - viewport.offsetY) / viewport.zoom,
  }
}

/** 画布坐标 → 屏幕坐标 */
export function canvasToScreen(
  canvas: Point,
  viewport: ViewportState,
  origin: ContainerOrigin,
): Point {
  return {
    x: canvas.x * viewport.zoom + viewport.offsetX + origin.left,
    y: canvas.y * viewport.zoom + viewport.offsetY + origin.top,
  }
}

/**
 * 以某个**屏幕点**为锚点缩放（11.3：必须"以鼠标位置为中心"，不是画布中心）。
 * 做法：先算出锚点下的画布坐标，缩放后反推 offset，使该画布点仍落在同一屏幕位置。
 */
export function zoomAroundScreenPoint(
  viewport: ViewportState,
  nextZoomRaw: number,
  anchorScreen: Point,
  origin: ContainerOrigin,
  options: { clamp?: boolean } = {},
): ViewportState {
  // clamp: false 仅供「带阻尼的缩放」使用 —— 阻尼本身已经限定了越界幅度，
  // 若此处再钳回边界，阻尼就永远看不到效果（越界信息会被这里吃掉）。
  const zoom = (options.clamp ?? true) ? clampZoom(nextZoomRaw) : nextZoomRaw
  const anchorCanvas = screenToCanvas(anchorScreen, viewport, origin)
  return {
    zoom,
    offsetX: anchorScreen.x - origin.left - anchorCanvas.x * zoom,
    offsetY: anchorScreen.y - origin.top - anchorCanvas.y * zoom,
  }
}

/**
 * 滚轮增量 → **未钳制**的缩放目标。
 * 用指数映射而非线性相加：滚轮上下一段距离可以精确抵消，手感更自然。
 * 需要钳制 / 阻尼请分别用 zoomFromWheelDelta / dampZoom 包一层。
 */
export function wheelZoomTarget(currentZoom: number, deltaY: number): number {
  return currentZoom * Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)
}

/**
 * 滚轮增量 → 新缩放值（已钳制到 10%~400%，不带阻尼）。
 * ⚠️ 灵敏度系数 0.0015 为准备层拟定值（文档未给），属手感参数，由用户实操后微调。
 */
export function zoomFromWheelDelta(currentZoom: number, deltaY: number): number {
  return clampZoom(wheelZoomTarget(currentZoom, deltaY))
}

/** 判断两个点之间的距离是否超过阈值（T0.12 的 4px 判定会复用） */
export function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}
