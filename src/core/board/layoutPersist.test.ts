// ============================================================================
// 模块说明（中文）
// 布局持久化核对（T2.11）：阶段二新增的数据（分区框 / 卡片 group / removed 记录）
// 必须能完整通过「zod 序列化 → parseLayout」往返而不丢失任何字段。
//
// LayoutWriter 写盘内容由 Board 组装（snapshot 的 cards / partitions / removed），
// 这里以 zod schema 为准做往返校验 —— 保证「改动能整理」的所有成果都能落盘恢复。
// ============================================================================

import { describe, expect, it } from 'vitest'

import type { Layout } from '@/core/types'
import { DATA_VERSION, createEmptyLayout, parseLayout } from '@/core/types'

describe('布局持久化往返核对（T2.11）', () => {
  it('分区框 / group 卡片 / removed 记录 / 视图状态完整往返', () => {
    const layout: Layout = {
      ...createEmptyLayout(),
      canvas: { zoom: 0.67, offsetX: -120, offsetY: 45 },
      cards: [
        {
          id: 'c_001',
          type: 'image',
          filePath: '参考资料/ref-01.jpg',
          originalPath: '参考资料/ref-01.jpg',
          x: 120,
          y: 200,
          w: 240,
          h: 180,
          rotation: 0,
          zIndex: 0,
          note: '',
          group: '参考资料',
          meta: {},
        },
        {
          id: 'c_002',
          type: 'image',
          filePath: '根图.jpg',
          originalPath: '根图.jpg',
          x: 400,
          y: 80,
          w: 240,
          h: 180,
          rotation: 0,
          zIndex: 1,
          note: '根目录卡片没有 group',
          meta: {},
        },
      ],
      partitions: [
        {
          id: 'p_001',
          name: '参考资料',
          folderPath: '参考资料',
          x: 96,
          y: 144,
          w: 288,
          h: 260,
          color: '#5A7D6A',
          collapsed: true,
          meta: {},
        },
      ],
      removed: [
        { id: 'c_003', originalPath: '灵感收集/旧图.png', movedTo: '_已移除/灵感收集/旧图.png' },
      ],
    }

    const parsed = parseLayout(JSON.stringify(layout))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const data = parsed.data
    // 视图
    expect(data.canvas).toEqual({ zoom: 0.67, offsetX: -120, offsetY: 45 })
    // 卡片：位置 / 尺寸 / group / 备注
    expect(data.cards[0]).toMatchObject({
      id: 'c_001',
      filePath: '参考资料/ref-01.jpg',
      x: 120,
      y: 200,
      group: '参考资料',
    })
    expect(data.cards[1].group).toBeUndefined()
    // 分区框：位置 / 折叠 / 颜色
    expect(data.partitions[0]).toMatchObject({
      id: 'p_001',
      name: '参考资料',
      folderPath: '参考资料',
      collapsed: true,
      color: '#5A7D6A',
    })
    // removed 记录：originalPath / movedTo
    expect(data.removed).toEqual([
      { id: 'c_003', originalPath: '灵感收集/旧图.png', movedTo: '_已移除/灵感收集/旧图.png' },
    ])
    expect(data.version).toBe(DATA_VERSION)
  })

  it('空布局序列化后仍可解析（默认值兜底）', () => {
    const parsed = parseLayout(JSON.stringify(createEmptyLayout()))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.data.cards).toEqual([])
    expect(parsed.data.partitions).toEqual([])
    expect(parsed.data.removed).toEqual([])
  })
})
