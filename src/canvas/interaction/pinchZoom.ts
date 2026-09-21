// ============================================================================
// 模块说明（中文）
// 双指捏合缩放的纯数学（2026-09-21 移动端适配 M2，决策 D4「手势优先」）。
//
// 要解决的问题：桌面版缩放只有滚轮一条路（`ViewportController.handleWheel`），
// 触屏没有滚轮，必须从**两根手指的位置**推出「缩放多少 + 以哪里为锚点」。
//
// 一帧捏合被拆成两个正交的分量，顺序不能反：
//   ① 平移：两指**中点**移了多少，画面就跟多少 —— 单指平移在手势里被禁用，
//      否则捏合时必然夹带大幅漂移；
//   ② 缩放：两指间距的比值作为倍率，锚点取**移动后的新中点**。
// 先平移再缩放，才能让「按下时两指下方的那块内容」始终停在两指下方 ——
// 反过来（先缩放后平移）会因为锚点已经变了而产生 1~2px 的抖动。
//
// 与滚轮路径的两处刻意差异：
//   · **不带阻尼回弹**：滚轮越界靠 dampZoom + 140ms 回弹表达「到头了」，
//     手指捏合停在边界即可，回弹动画在触屏上只会觉得画面在自己动；
//     所以这里用 clamp 后的锚点缩放（zoomAroundScreenPoint 的默认口径）。
//   · **两指起点重合时不放大小数**：手指按下的一瞬间两点距离可以是 0，
//     比值会炸到 Infinity。低于 MIN_PINCH_SPAN_PX 一律视为「倍率 1」，只做平移。
//
// 本文件全是纯函数（不碰 DOM、不碰 React、不持有状态），可在 node 下 100% 单测。
// 状态机在 touchGesture.ts，DOM 写入在 viewportController.ts。
// ============================================================================

import { distanceBetween, zoomAroundScreenPoint } from './coordinates'
import type { ContainerOrigin, Point, ViewportState } from './coordinates'

/**
 * 两指间距的下限（CSS 像素）。低于它就不算缩放、只算平移 ——
 * 手指刚落下、或两指几乎并拢时，间距比值会放大成巨大的倍率。
 */
export const MIN_PINCH_SPAN_PX = 12

/** 两指间距：缩放倍率的来源 */
export function pinchSpan(a: Point, b: Point): number {
  return distanceBetween(a, b)
}

/** 两指中点：平移分量与缩放锚点的来源 */
export function pinchMidpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/** 一帧捏合的输入：上一帧与当前帧的两指位置 */
export interface PinchFrame {
  prevMid: Point
  nextMid: Point
  prevSpan: number
  nextSpan: number
}

/**
 * 由一帧捏合推出新的视口状态（不改入参）。
 *
 * @param viewport 当前视口（本帧开始前的 zoom / offset）
 * @param origin   画布容器左上角（必须是**未被变换**的那个容器，见 17.4）
 */
export function pinchViewportState(
  viewport: ViewportState,
  origin: ContainerOrigin,
  frame: PinchFrame,
): ViewportState {
  // ① 平移：中点位移直接加到 offset 上（与滚轮同理，位移是屏幕像素）
  const panned: ViewportState = {
    zoom: viewport.zoom,
    offsetX: viewport.offsetX + (frame.nextMid.x - frame.prevMid.x),
    offsetY: viewport.offsetY + (frame.nextMid.y - frame.prevMid.y),
  }

  // ② 缩放：两指间距比值 = 倍率；间距过小（含 0）时倍率取 1，即「只平移」
  const tooNarrow = frame.prevSpan < MIN_PINCH_SPAN_PX || frame.nextSpan < MIN_PINCH_SPAN_PX
  const ratio = tooNarrow ? 1 : frame.nextSpan / frame.prevSpan
  const targetZoom = panned.zoom * ratio

  // clamp 走默认口径（钳进 10%~400%）：捏合到边界就停住，不回弹
  return zoomAroundScreenPoint(panned, targetZoom, frame.nextMid, origin)
}
