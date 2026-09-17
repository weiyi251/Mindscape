// ============================================================================
// 模块说明（中文）
// canvas/interaction/connectionDrag.ts 的单元测试（node 环境，无真实 DOM）。
//
// 用假的 path 元素 / 假的 elementFromPoint 命中树验证控制器合同：
//   · begin   临时线显示、起点落在源端右缘（条目端 = 条目行 y）、锁定拖动；
//   · update  终点跟随指针（画布坐标）；
//   · end     命中其他卡创建连线（条目命中带 itemId）、命中空白 / 同卡取消；
//   · cancel  临时线隐藏。
// 固化的规则：起点固定右缘（2026-09-11 用户裁决）；条目偏移查不到退回整卡中点。
// ============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConnectionDragController } from './connectionDrag'
import type { ConnectionDragDeps } from './connectionDrag'

/** 假的临时线 path：记录 d 与 display */
function fakePath() {
  const state = { d: '', display: 'none' }
  const el = {
    setAttribute: (name: string, value: string) => {
      if (name === 'd') state.d = value
    },
    style: { set display(value: string) { state.display = value } },
  } as unknown as SVGPathElement
  return { el, state }
}

/** 假命中树：elementFromPoint 的返回值（closest 按选择器查祖先） */
function fakeTarget(options: { cardId?: string; itemId?: string } = {}) {
  const cardEl = {
    getAttribute: (name: string) => (name === 'data-card-id' ? (options.cardId ?? null) : null),
    closest: () => null,
  }
  const itemEl = {
    getAttribute: (name: string) => (name === 'data-connect-item' ? (options.itemId ?? null) : null),
    closest: () => null,
  }
  return {
    closest: (selector: string) => {
      if (selector.includes('data-connect-item') && options.itemId !== undefined) return itemEl
      if (selector.includes('data-card-id') && options.cardId !== undefined) return cardEl
      return null
    },
  } as unknown as HTMLElement
}

/** 控制器假依赖：源卡 rect (0,0,100,100)，条目 item_1 的偏移 24 */
function makeDeps(overrides: Partial<ConnectionDragDeps> = {}): ConnectionDragDeps & {
  created: { from: unknown; to: unknown }[]
} {
  const created: { from: unknown; to: unknown }[] = []
  return {
    created,
    getCardRect: (cardId) => (cardId === 'c_1' ? { x: 0, y: 0, w: 100, h: 100 } : null),
    getItemOffset: (cardId, itemId) =>
      cardId === 'c_1' && itemId === 'item_1' ? 24 : undefined,
    getCanvasPoint: () => ({ x: 300, y: 48 }),
    getTempPath: () => null,
    onCreateConnection: (from, to) => created.push({ from, to }),
    ...overrides,
  }
}

/** pointer 事件假件 */
function fakePointer(): PointerEvent {
  return { preventDefault: vi.fn(), clientX: 300, clientY: 48 } as unknown as PointerEvent
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('ConnectionDragController · begin', () => {
  it('临时线显示，起点 = 源卡右缘中点（100, 50），并锁定卡片拖动', () => {
    const { el, state } = fakePath()
    const deps = makeDeps({ getTempPath: () => el })
    const controller = new ConnectionDragController(deps)

    const event = fakePointer()
    controller.begin(event, { cardId: 'c_1' })

    expect(state.display).toBe('')
    expect(state.d).toContain('M 100 50')
    expect(event.preventDefault).toHaveBeenCalled()
    expect(controller.isConnecting).toBe(true)
  })

  it('条目端：起点纵向落在条目行 y（0 + 24）', () => {
    const { el, state } = fakePath()
    const deps = makeDeps({ getTempPath: () => el })
    const controller = new ConnectionDragController(deps)

    controller.begin(fakePointer(), { cardId: 'c_1', itemId: 'item_1' })

    expect(state.d).toContain('M 100 24')
  })

  it('条目偏移查不到：退回整卡右缘中点（脏数据兜底）', () => {
    const { el, state } = fakePath()
    const deps = makeDeps({ getTempPath: () => el })
    const controller = new ConnectionDragController(deps)

    controller.begin(fakePointer(), { cardId: 'c_1', itemId: '不存在' })

    expect(state.d).toContain('M 100 50')
  })
})

describe('ConnectionDragController · update', () => {
  it('临时线终点跟随指针（画布坐标）', () => {
    const { el, state } = fakePath()
    const deps = makeDeps({ getTempPath: () => el })
    const controller = new ConnectionDragController(deps)
    controller.begin(fakePointer(), { cardId: 'c_1' })

    controller.update(fakePointer())

    // 起点（右缘中点）不变，终点是 getCanvasPoint 的返回值 (300, 48)
    expect(state.d).toContain('M 100 50')
    expect(state.d.trimEnd().endsWith('300 48')).toBe(true)
  })

  it('未在连线时 update 不动作（不抛错）', () => {
    const { el, state } = fakePath()
    const deps = makeDeps({ getTempPath: () => el })
    const controller = new ConnectionDragController(deps)

    expect(() => controller.update(fakePointer())).not.toThrow()
    expect(state.d).toBe('')
  })
})

describe('ConnectionDragController · end', () => {
  it('命中其他卡：整卡连线回调（to 无 itemId）', () => {
    const { el } = fakePath()
    const deps = makeDeps({ getTempPath: () => el })
    vi.stubGlobal('document', { elementFromPoint: () => fakeTarget({ cardId: 'c_2' }) })
    const controller = new ConnectionDragController(deps)
    controller.begin(fakePointer(), { cardId: 'c_1' })

    controller.end(fakePointer())

    expect(deps.created).toEqual([
      { from: { cardId: 'c_1' }, to: { cardId: 'c_2', itemId: undefined } },
    ])
    expect(controller.isConnecting).toBe(false)
  })

  it('命中条目连线点：to 带该条目 id（条目级连线）', () => {
    const { el } = fakePath()
    const deps = makeDeps({ getTempPath: () => el })
    vi.stubGlobal('document', {
      elementFromPoint: () => fakeTarget({ cardId: 'c_2', itemId: 't9' }),
    })
    const controller = new ConnectionDragController(deps)
    controller.begin(fakePointer(), { cardId: 'c_1', itemId: 'item_1' })

    controller.end(fakePointer())

    expect(deps.created).toEqual([
      { from: { cardId: 'c_1', itemId: 'item_1' }, to: { cardId: 'c_2', itemId: 't9' } },
    ])
  })

  it('命中空白 / 源卡自己：不回调', () => {
    const { el } = fakePath()
    const deps = makeDeps({ getTempPath: () => el })
    const controller = new ConnectionDragController(deps)

    vi.stubGlobal('document', { elementFromPoint: () => fakeTarget({}) })
    controller.begin(fakePointer(), { cardId: 'c_1' })
    controller.end(fakePointer())
    expect(deps.created).toEqual([])

    vi.stubGlobal('document', { elementFromPoint: () => fakeTarget({ cardId: 'c_1' }) })
    controller.begin(fakePointer(), { cardId: 'c_1' })
    controller.end(fakePointer())
    expect(deps.created).toEqual([])
  })

  it('松手后临时线隐藏', () => {
    const { el, state } = fakePath()
    const deps = makeDeps({ getTempPath: () => el })
    vi.stubGlobal('document', { elementFromPoint: () => fakeTarget({ cardId: 'c_2' }) })
    const controller = new ConnectionDragController(deps)
    controller.begin(fakePointer(), { cardId: 'c_1' })

    controller.end(fakePointer())

    expect(state.display).toBe('none')
  })
})

describe('ConnectionDragController · cancel', () => {
  it('取消：临时线隐藏且复位（后续 move 不动作）', () => {
    const { el, state } = fakePath()
    const deps = makeDeps({ getTempPath: () => el })
    const controller = new ConnectionDragController(deps)
    controller.begin(fakePointer(), { cardId: 'c_1' })

    controller.cancel()

    expect(state.display).toBe('none')
    expect(controller.isConnecting).toBe(false)
  })
})
