// ============================================================================
// 模块说明（中文）
// 框选（Ctrl + 左键拖）的纯计算函数。对应开发计划书 T2.3 与 11.5「框选验收标准」。
// 与 DOM / React 完全解耦，便于在 node 测试环境验证。
// ============================================================================

import type { Point } from './coordinates'

/** 轴对齐矩形（画布坐标） */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** 把两个任意角点归一化成「x / y 为左上角」的矩形（用户可以从任意方向框选） */
export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  }
}

/** 卡片与框选矩形**相交**即选中（11.5「框内卡片实时高亮」采用更宽容的相交判定，Figma 同款） */
function rectHitsCard(rect: Rect, card: { x: number; y: number; w: number; h: number }): boolean {
  return (
    rect.x < card.x + card.w &&
    rect.x + rect.w > card.x &&
    rect.y < card.y + card.h &&
    rect.y + rect.h > card.y
  )
}

/** 批量命中：返回与矩形相交的卡片 id（保持传入顺序，选中集合稳定） */
export function cardIdsInRect(
  rect: Rect,
  cards: Array<{ id: string; x: number; y: number; w: number; h: number }>,
): string[] {
  return cards.filter((card) => rectHitsCard(rect, card)).map((card) => card.id)
}
