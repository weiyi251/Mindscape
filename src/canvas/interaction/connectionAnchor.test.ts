// ============================================================================
// 模块说明（中文）
// 连线端点几何的单元测试（T3.1 / T3.2 / 2026-09-11 锚点固定化裁决）。
// 固化的规则：连线锚点固定「源卡右缘中点 → 目标卡左缘中点」，
// 不随目标方向变化；缩放时端点不错位由架构保证（SVG 画在 stage 坐标系）。
// ============================================================================

import { describe, expect, it } from 'vitest'

import {
  connectionAnchors,
  distanceToSegment,
  leftAnchor,
  rectCenter,
  rightAnchor,
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
