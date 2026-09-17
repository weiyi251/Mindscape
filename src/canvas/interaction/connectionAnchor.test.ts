// ============================================================================
// 模块说明（中文）
// 连线端点几何的单元测试（T3.1 / T3.2 / 2026-09-11 锚点固定化裁决）。
// 固化的规则：连线锚点固定「源卡右缘中点 → 目标卡左缘中点」，
// 不随目标方向变化；缩放时端点不错位由架构保证（SVG 画在 stage 坐标系）。
// ============================================================================

import { describe, expect, it } from 'vitest'

import {
  connectionAnchors,
  connectionAnchorsWithItems,
  distanceToSegment,
  leftAnchor,
  leftAnchorAtOffset,
  rectCenter,
  rightAnchor,
  rightAnchorAtOffset,
} from './connectionAnchor'

const CARD_A = { x: 0, y: 0, w: 100, h: 100 }
const CARD_B = { x: 300, y: 0, w: 100, h: 100 }

describe('固定锚点（右出左进，用户裁决 2026-09-11）', () => {
  it('rightAnchor = 右缘中点', () => {
    expect(rightAnchor(CARD_A)).toEqual({ x: 100, y: 50 })
  })

  it('leftAnchor = 左缘中点', () => {
    expect(leftAnchor(CARD_B)).toEqual({ x: 300, y: 50 })
  })

  it('两张水平相邻卡：A 右缘 → B 左缘', () => {
    const { start, end } = connectionAnchors(CARD_A, CARD_B)
    expect(start).toEqual({ x: 100, y: 50 })
    expect(end).toEqual({ x: 300, y: 50 })
  })

  it('锚点不随目标方向漂移：目标在上方 / 下方 / 左侧时起点都是右缘中点', () => {
    // 目标在右上
    expect(connectionAnchors(CARD_A, { x: 200, y: -300, w: 100, h: 100 }).start).toEqual({
      x: 100,
      y: 50,
    })
    // 目标在正下
    expect(connectionAnchors(CARD_A, { x: 0, y: 400, w: 100, h: 100 }).start).toEqual({
      x: 100,
      y: 50,
    })
    // 目标在左侧（回绕连线，起点仍是右缘中点）
    expect(connectionAnchors(CARD_A, { x: -400, y: 0, w: 100, h: 100 }).start).toEqual({
      x: 100,
      y: 50,
    })
  })

  it('终点永远落在目标卡左缘中点', () => {
    const C = { x: 250, y: 150, w: 120, h: 80 }
    const { end } = connectionAnchors(CARD_A, C)
    expect(end).toEqual({ x: 250, y: 190 })
  })

  it('rectCenter 仍用于标签中点估算', () => {
    expect(rectCenter(CARD_A)).toEqual({ x: 50, y: 50 })
  })
})

describe('distanceToSegment', () => {
  it('垂足在线段上时取垂线距离', () => {
    expect(distanceToSegment({ x: 5, y: 13 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(13)
  })

  it('垂足落在线段外时取到端点的距离', () => {
    expect(distanceToSegment({ x: -3, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3)
  })

  it('零长度线段退化为点到点距离', () => {
    expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// 条目级锚点（2026-09-17）：连线精确到卡片内某一行（如待办条目）
// 固化的规则：仍保持「右缘出 / 左缘进」，只是纵向从整卡中点改为条目行 y。
// ---------------------------------------------------------------------------

describe('条目级锚点（offset 相对卡片顶边）', () => {
  it('rightAnchorAtOffset = 右缘 + 条目偏移', () => {
    expect(rightAnchorAtOffset(CARD_A, 24)).toEqual({ x: 100, y: 24 })
  })

  it('leftAnchorAtOffset = 左缘 + 条目偏移（左进右出不变）', () => {
    expect(leftAnchorAtOffset(CARD_B, 48)).toEqual({ x: 300, y: 48 })
  })

  it('卡片不在原点时偏移相对卡片顶边', () => {
    const card = { x: 500, y: 200, w: 80, h: 120 }
    expect(rightAnchorAtOffset(card, 30)).toEqual({ x: 580, y: 230 })
  })

  it('偏移 clamp 到卡片高度内（表与高度短暂不一致时端点不飞出卡片）', () => {
    expect(rightAnchorAtOffset(CARD_A, -10)).toEqual({ x: 100, y: 0 })
    expect(leftAnchorAtOffset(CARD_B, 999)).toEqual({ x: 300, y: 100 })
  })

  it('undefined / 非有限数退回整卡中点（旧连线与脏数据兜底）', () => {
    expect(rightAnchorAtOffset(CARD_A, undefined)).toEqual({ x: 100, y: 50 })
    expect(leftAnchorAtOffset(CARD_B, Number.NaN)).toEqual({ x: 300, y: 50 })
    expect(leftAnchorAtOffset(CARD_B, Number.POSITIVE_INFINITY)).toEqual({ x: 300, y: 50 })
  })

  it('connectionAnchorsWithItems：两端各带条目偏移', () => {
    const { start, end } = connectionAnchorsWithItems(CARD_A, CARD_B, 24, 48)
    expect(start).toEqual({ x: 100, y: 24 })
    expect(end).toEqual({ x: 300, y: 48 })
  })

  it('connectionAnchorsWithItems：不传偏移时等价于 connectionAnchors', () => {
    expect(connectionAnchorsWithItems(CARD_A, CARD_B)).toEqual(connectionAnchors(CARD_A, CARD_B))
  })
})
