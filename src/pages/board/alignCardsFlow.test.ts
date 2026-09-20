// ============================================================================
// 模块说明（中文）
// alignCardsFlow（多选对齐与分布编排）的单元测试（2026-09-20 用户计划 C3）。
//
// 覆盖：卡片 → 几何输入翻译（含锁定）、走现成 moveCards 命令（可撤销）、
// 锁定卡的取舍（对齐参与 / 分布排除）、无位移时静默 no-op（不占撤销栈、不落盘）。
// ============================================================================

import { describe, expect, it, vi } from 'vitest'

import { alignItemsOf, runAlignCards } from './alignCardsFlow'
import { LOCKED_META_KEY } from '@/core/board/cardMeta'
import { History } from '@/core/commands/history'
import type { Card } from '@/core/types'

function makeCard(over: Partial<Card> & { id: string }): Card {
  return {
    type: 'image',
    filePath: `${over.id}.png`,
    originalPath: `${over.id}.png`,
    x: 0,
    y: 0,
    w: 100,
    h: 60,
    rotation: 0,
    zIndex: 0,
    note: '',
    meta: {},
    ...over,
  }
}

function setup() {
  const history = new History()
  const positions = new Map<string, { x: number; y: number }>()
  const applyPositions = vi.fn((items: { id: string; x: number; y: number }[]) => {
    for (const item of items) positions.set(item.id, { x: item.x, y: item.y })
  })
  const schedule = vi.fn()
  return {
    history,
    schedule,
    applyPositions,
    positions,
    deps: {
      execute: (command: Parameters<typeof history.execute>[0]) => history.execute(command),
      schedule,
      applyPositions,
    },
  }
}

describe('alignItemsOf：卡片 → 几何输入', () => {
  it('带出矩形与锁定标记', () => {
    const cards = [
      makeCard({ id: 'a', x: 10, y: 20, w: 30, h: 40 }),
      makeCard({ id: 'b', meta: { [LOCKED_META_KEY]: true } }),
    ]

    expect(alignItemsOf(cards)).toEqual([
      { id: 'a', rect: { x: 10, y: 20, w: 30, h: 40 }, locked: false },
      { id: 'b', rect: { x: 0, y: 0, w: 100, h: 60 }, locked: true },
    ])
  })
})

describe('runAlignCards', () => {
  it('左对齐：坐标写回 + 请求落盘各一次', async () => {
    const { deps, schedule, applyPositions, positions } = setup()
    const cards = [makeCard({ id: 'a', x: 0, y: 0 }), makeCard({ id: 'b', x: 300, y: 40 })]

    await runAlignCards(cards, 'left', deps)

    expect(applyPositions).toHaveBeenCalledTimes(1)
    expect(positions.get('b')).toEqual({ x: 0, y: 40 })
    expect(positions.has('a')).toBe(false)
    expect(schedule).toHaveBeenCalledTimes(1)
  })

  it('一次命令入撤销栈：撤销回到原位置，重做再对齐', async () => {
    const { deps, history, positions } = setup()
    const cards = [makeCard({ id: 'a', x: 0, y: 0 }), makeCard({ id: 'b', x: 300, y: 40 })]

    await runAlignCards(cards, 'left', deps)
    expect(positions.get('b')).toEqual({ x: 0, y: 40 })

    await history.undo()
    expect(positions.get('b')).toEqual({ x: 300, y: 40 })

    await history.redo()
    expect(positions.get('b')).toEqual({ x: 0, y: 40 })
  })

  it('锁定卡当基准但自身不移动', async () => {
    const { deps, positions } = setup()
    const cards = [
      makeCard({ id: 'pinned', x: 0, y: 0, meta: { [LOCKED_META_KEY]: true } }),
      makeCard({ id: 'b', x: 300, y: 40 }),
    ]

    await runAlignCards(cards, 'left', deps)

    expect(positions.has('pinned')).toBe(false)
    expect(positions.get('b')).toEqual({ x: 0, y: 40 })
  })

  it('分布：锁定卡退出参与集合（不被当作锚点）', async () => {
    const { deps, positions } = setup()
    const cards = [
      makeCard({ id: 'a', x: 0, y: 0 }),
      makeCard({ id: 'b', x: 120, y: 0 }),
      makeCard({ id: 'c', x: 300, y: 0 }),
      makeCard({ id: 'pinned', x: 1000, y: 0, meta: { [LOCKED_META_KEY]: true } }),
    ]

    await runAlignCards(cards, 'distribute-h', deps)

    expect(positions.get('b')).toEqual({ x: 150, y: 0 })
    expect(positions.has('pinned')).toBe(false)
  })

  it('已对齐 / 参与项不足：静默 no-op（不发命令、不落盘）', async () => {
    const { deps, schedule, applyPositions } = setup()

    await runAlignCards(
      [makeCard({ id: 'a', x: 0, y: 0 }), makeCard({ id: 'b', x: 0, y: 50 })],
      'left',
      deps
    )
    expect(applyPositions).not.toHaveBeenCalled()
    expect(schedule).not.toHaveBeenCalled()

    // 只有 2 张未锁定卡时分布不可执行
    await runAlignCards(
      [makeCard({ id: 'a' }), makeCard({ id: 'b', x: 200 })],
      'distribute-h',
      deps
    )
    expect(applyPositions).not.toHaveBeenCalled()
  })
})
