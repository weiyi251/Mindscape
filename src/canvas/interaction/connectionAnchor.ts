// ============================================================================
// 模块说明（中文）
// 连线端点几何。对应开发计划书 T3.1：
//   「连线跟随卡片移动而移动；缩放时端点不错位」。
//
// 设计要点：
//   · 锚点固定：起点 = 源卡右缘中点，终点 = 目标卡左缘中点（用户裁决 2026-09-11）。
//     不再按「中心连线与边框交点」动态取点 —— 那会让同一节点的连线起点
//     随目标方向漂移，视觉混乱。左进右出，与节点式画布（ComfyUI 等）习惯一致。
//   · 本模块只做纯几何计算（画布坐标）。连线的 SVG 画在 stage 坐标系里，
//     与卡片同一套 transform 变换 —— 缩放/平移时端点天然不错位（17.3 不需要
//     任何额外补偿），拖动卡片时由 ConnectionLayer 直写 path 的 d 属性跟随。
//
// 纯函数，可单元测试。
// 实现任务：T3.1；锚点固定化：2026-09-11 用户裁决。
// ============================================================================

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Point {
  x: number
  y: number
}

/** 矩形中心 */
export function rectCenter(rect: Rect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
}

/**
 * 连线的统一**出发**锚点：源卡右缘中点。
 * （用户裁决 2026-09-11：所有连线必须从节点图片右侧的固定原点出发，
 * 禁止按目标方向在四边上找交点 —— 起点一致、走向清晰。）
 */
export function rightAnchor(rect: Rect): Point {
  return { x: rect.x + rect.w, y: rect.y + rect.h / 2 }
}

/** 连线的统一**到达**锚点：目标卡左缘中点（左进右出，与节点式画布习惯一致） */
export function leftAnchor(rect: Rect): Point {
  return { x: rect.x, y: rect.y + rect.h / 2 }
}

/**
 * 一条连线的两端锚点（画布坐标）：固定「右缘中点 → 左缘中点」。
 * 不再随目标方向变化 —— 同一节点的所有连线起点永远相同。
 */
export function connectionAnchors(
  from: Rect,
  to: Rect,
): { start: Point; end: Point } {
  return {
    start: rightAnchor(from),
    end: leftAnchor(to),
  }
}

/**
 * 连线的 SVG path（三次贝塞尔）。
 * 控制点沿水平方向外伸，弯曲程度与两端横向距离成正比 ——
 * 横向连线近乎水平直线，纵向连线呈 S 形，视觉上与节点式画布一致。
 */
export function connectionPathD(start: Point, end: Point): string {
  const dx = end.x - start.x
  const bend = Math.max(Math.abs(dx) / 2, 40)
  return `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`
}

/** 点到线段的最短距离（单击选中连线时做 6px 容差命中用；画布坐标） */
export function distanceToSegment(point: Point, a: Point, b: Point): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const lengthSquared = abx * abx + aby * aby

  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y)

  // 投影参数 clamp 到 [0,1]：垂足落在线段外时取端点
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * abx + (point.y - a.y) * aby) / lengthSquared))
  const footX = a.x + abx * t
  const footY = a.y + aby * t
  return Math.hypot(point.x - footX, point.y - footY)
}
