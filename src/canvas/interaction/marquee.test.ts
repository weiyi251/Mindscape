// ============================================================================
// 模块说明（中文）
// 框选纯函数（marquee）与缩放命令（resizeCards）的单元测试（T2.3）。
// ============================================================================

import { describe, expect, it } from 'vitest'

import { cardIdsInRect, normalizeRect } from './marquee'
import { createResizeCardsCommand, hasMeaningfulResize } from '@/core/commands/impl/resizeCards'
import { History } from '@/core/commands/history'

describe('normalizeRect', () => {
  it('从任意方向框选都归一化为左上角矩形', () => {
    expect(normalizeRect({ x: 0, y: 0 }, { x: 100, y: 50 })).toEqual({ x: 0, y: 0, w: 100, h: 50 })
    expect(normalizeRect({ x: 100, y: 50 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0, w: 100, h: 50 })
    expect(normalizeRect({ x: 100, y: 0 }, { x: 0, y: 50 })).toEqual({ x: 0, y: 0, w: 100, h: 50 })
  })
})

describe('cardIdsInRect', () => {
  const cards = [
    { id: 'a', x: 0, y: 0, w: 100, h: 80 },
    { id: 'b', x: 200, y: 0, w: 100, h: 80 },
    { id: 'c', x: 400, y: 300, w: 100, h: 80 },
  ]

  it('相交即命中（11.5 采用宽容判定）', () => {
    // 框只擦到卡片 a 的右下角
    expect(cardIdsInRect({ x: 90, y: 70, w: 20, h: 20 }, cards)).toEqual(['a'])
  })

  it('框住多张时按传入顺序返回', () => {
    expect(cardIdsInRect({ x: 0, y: 0, w: 350, h: 100 }, cards)).toEqual(['a', 'b'])
  })

  it('框外无命中', () => {
    expect(cardIdsInRect({ x: 1000, y: 1000, w: 10, h: 10 }, cards)).toEqual([])
  })
})

describe('createResizeCardsCommand', () => {
  it('do 应用新尺寸，undo 还原旧尺寸', async () => {
    const writes: Array<{ id: string; w: number; h: number }[]> = []
    const apply = (sizes: { id: string; w: number; h: number }[]) => {
      writes.push(sizes.map((size) => ({ ...size })))
    }
    const history = new History()

    await history.execute(
      createResizeCardsCommand([{ id: 'c1', from: { w: 100, h: 80 }, to: { w: 200, h: 160 } }], apply),
    )
    expect(writes.at(-1)).toEqual([{ id: 'c1', w: 200, h: 160 }])

    await history.undo()
    expect(writes.at(-1)).toEqual([{ id: 'c1', w: 100, h: 80 }])

    await history.redo()
    expect(writes.at(-1)).toEqual([{ id: 'c1', w: 200, h: 160 }])
  })

  it('hasMeaningfulResize 过滤无变化缩放', () => {
    expect(hasMeaningfulResize([{ id: 'a', from: { w: 10, h: 10 }, to: { w: 10, h: 10 } }])).toBe(false)
    expect(hasMeaningfulResize([{ id: 'a', from: { w: 10, h: 10 }, to: { w: 10, h: 11 } }])).toBe(true)
  })

  // 2026-09-13：便签西 / 北边缩放联动位置的命令覆盖
  it('带位置增量时 do / undo 同时应用尺寸与位置', async () => {
    const writes: Array<{ id: string; w: number; h: number; x?: number; y?: number }[]> = []
    const apply = (sizes: { id: string; w: number; h: number; x?: number; y?: number }[]) => {
      writes.push(sizes.map((size) => ({ ...size })))
    }
    const history = new History()
    const delta = {
      id: 'c1',
      from: { w: 240, h: 180 },
      to: { w: 180, h: 180 },
      fromPos: { x: 100, y: 80 },
      toPos: { x: 160, y: 80 },
    }

    await history.execute(createResizeCardsCommand([delta], apply))
    expect(writes.at(-1)).toEqual([{ id: 'c1', w: 180, h: 180, x: 160, y: 80 }])

    await history.undo()
    expect(writes.at(-1)).toEqual([{ id: 'c1', w: 240, h: 180, x: 100, y: 80 }])
  })

  it('不带位置增量的旧形态保持原行为（x / y 为 undefined）', async () => {
    const writes: Array<{ id: string; w: number; h: number; x?: number; y?: number }[]> = []
    const apply = (sizes: { id: string; w: number; h: number; x?: number; y?: number }[]) => {
      writes.push(sizes.map((size) => ({ ...size })))
    }
    const history = new History()

    await history.execute(
      createResizeCardsCommand([{ id: 'c1', from: { w: 100, h: 80 }, to: { w: 150, h: 90 } }], apply),
    )
    expect(writes.at(-1)).toEqual([{ id: 'c1', w: 150, h: 90, x: undefined, y: undefined }])
  })

  it('hasMeaningfulResize 识别纯位置变化（防御）', () => {
    expect(
      hasMeaningfulResize([
        {
          id: 'a',
          from: { w: 10, h: 10 },
          to: { w: 10, h: 10 },
          fromPos: { x: 0, y: 0 },
          toPos: { x: 5, y: 0 },
        },
      ]),
    ).toBe(true)
    expect(
      hasMeaningfulResize([
        {
          id: 'a',
          from: { w: 10, h: 10 },
          to: { w: 10, h: 10 },
          fromPos: { x: 5, y: 0 },
          toPos: { x: 5, y: 0 },
        },
      ]),
    ).toBe(false)
  })
})
