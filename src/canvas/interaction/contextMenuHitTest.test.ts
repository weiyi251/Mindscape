import { describe, expect, it } from 'vitest'

import { dispatchCanvasContextMenu, hitTestCanvasTarget } from './contextMenuHitTest'
import type {
  HitTestAttributes,
  HitTestElement,
  CanvasContextMenuDispatch,
} from './contextMenuHitTest'

const ATTRS: HitTestAttributes = {
  connectionId: 'data-connection-id',
  cardId: 'data-card-id',
  partitionId: 'data-partition-id',
}

/** 假 DOM 节点：只需要 closest / getAttribute 两个方法（parent 用来向上冒泡） */
interface FakeNode extends HitTestElement {
  parent: FakeNode | null
}

/**
 * closest 按 `[属性名]` 选择器向上找带该属性的最近祖先（与真实语义一致）。
 */
function fakeNode(own: Record<string, string> = {}, parent: FakeNode | null = null): FakeNode {
  const node: FakeNode = {
    parent,
    getAttribute: (name) => own[name] ?? null,
    closest: (selector) => {
      const match = /^\[([\w-]+)\]$/.exec(selector)
      const name = match?.[1]
      if (!name) return null
      let current: FakeNode | null = node
      while (current) {
        if (current.getAttribute(name) !== null) return current
        current = current.parent
      }
      return null
    },
  }
  return node
}

describe('hitTestCanvasTarget：四级优先级', () => {
  it('连线优先于卡片（线画在卡片之下，但命中线自身时应弹连线菜单）', () => {
    const card = fakeNode({ [ATTRS.cardId]: 'card-1' })
    const path = fakeNode({ [ATTRS.connectionId]: 'conn-9' }, card)
    expect(hitTestCanvasTarget(path, ATTRS)).toEqual({ kind: 'connection', connectionId: 'conn-9' })
  })

  it('卡片优先于分区（卡片渲染在分区框之上）', () => {
    const partition = fakeNode({ [ATTRS.partitionId]: 'p-1' })
    const card = fakeNode({ [ATTRS.cardId]: 'card-2' }, partition)
    expect(hitTestCanvasTarget(card, ATTRS)).toEqual({ kind: 'card', cardId: 'card-2' })
  })

  it('只有分区时命中分区', () => {
    const handle = fakeNode({ 'data-partition-resize': 'se' }, fakeNode({ [ATTRS.partitionId]: 'p-3' }))
    expect(hitTestCanvasTarget(handle, ATTRS)).toEqual({ kind: 'partition', partitionId: 'p-3' })
  })

  it('向上冒泡找祖先：命中的是元素本体还是祖先都算', () => {
    const card = fakeNode({ [ATTRS.cardId]: 'card-4' })
    const img = fakeNode({}, card)
    expect(hitTestCanvasTarget(img, ATTRS)).toEqual({ kind: 'card', cardId: 'card-4' })
  })

  it('什么都没命中 → blank（画布级菜单的落点）', () => {
    expect(hitTestCanvasTarget(fakeNode({ class: 'gap' }), ATTRS)).toEqual({ kind: 'blank' })
  })

  it('元素为 null → blank（长按时拿不到 target 的兜底）', () => {
    expect(hitTestCanvasTarget(null, ATTRS)).toEqual({ kind: 'blank' })
  })

  it('属性存在但值是空串，视为未命中（不能弹出 id 为空的菜单）', () => {
    const card = fakeNode({ [ATTRS.cardId]: '' })
    expect(hitTestCanvasTarget(card, ATTRS)).toEqual({ kind: 'blank' })
  })

  it('不认识的选择器不会误命中（假 closest 返回 null 时逐级上溯后落到 blank）', () => {
    const nested = fakeNode({ 'data-thing': 'x' }, fakeNode({ 'data-other': 'y' }))
    expect(hitTestCanvasTarget(nested, ATTRS)).toEqual({ kind: 'blank' })
  })
})

// ---------------------------------------------------------------------------
// dispatchCanvasContextMenu：桌面 contextmenu 与移动端长按共用的分派
// ---------------------------------------------------------------------------

interface FakeCard {
  id: string
}
interface FakePartition {
  id: string
}

/** 记录调用了哪个回调、参数是什么（顺序即语义：只能有一个回调被触发） */
function recorder(overrides: Partial<CanvasContextMenuDispatch<FakeCard, FakePartition>> = {}) {
  const calls: string[] = []
  const cards: FakeCard[] = [{ id: 'card-1' }]
  const partitions: FakePartition[] = [{ id: 'p-1' }]
  const deps: CanvasContextMenuDispatch<FakeCard, FakePartition> = {
    attributes: ATTRS,
    removedMode: false,
    findCard: (id) => cards.find((card) => card.id === id),
    findPartition: (id) => partitions.find((partition) => partition.id === id),
    onConnection: (id) => calls.push(`connection:${id}`),
    onCard: (card) => calls.push(`card:${card.id}`),
    onPartition: (partition) => calls.push(`partition:${partition.id}`),
    onBlank: () => calls.push('blank'),
    ...overrides,
  }
  return { calls, deps }
}

const SCREEN = { x: 120, y: 240 }

describe('dispatchCanvasContextMenu：命中即分派', () => {
  it('命中卡片 → 只调 onCard，并把卡片对象与屏幕坐标传出去', () => {
    const { calls, deps } = recorder()
    dispatchCanvasContextMenu(fakeNode({ [ATTRS.cardId]: 'card-1' }), SCREEN, deps)
    expect(calls).toEqual(['card:card-1'])
  })

  it('命中连线 → 只调 onConnection（连线不需要集合里的对象）', () => {
    const { calls, deps } = recorder()
    dispatchCanvasContextMenu(fakeNode({ [ATTRS.connectionId]: 'conn-1' }), SCREEN, deps)
    expect(calls).toEqual(['connection:conn-1'])
  })

  it('命中分区 → 只调 onPartition', () => {
    const { calls, deps } = recorder()
    dispatchCanvasContextMenu(fakeNode({ [ATTRS.partitionId]: 'p-1' }), SCREEN, deps)
    expect(calls).toEqual(['partition:p-1'])
  })

  it('空白 → onBlank 收到同一份屏幕坐标（上层据此换算画布落点与浮层定位）', () => {
    const { calls, deps } = recorder()
    let seen: { x: number; y: number } | null = null
    dispatchCanvasContextMenu(fakeNode({}), SCREEN, {
      ...deps,
      onBlank: (screen) => {
        seen = screen
        calls.push('blank')
      },
    })
    expect(calls).toEqual(['blank'])
    expect(seen).toEqual(SCREEN)
  })

  it('已移除视图：空白不弹画布菜单，但灰卡右键照常（恢复 / 彻底删除要用）', () => {
    const blank = recorder({ removedMode: true })
    dispatchCanvasContextMenu(fakeNode({}), SCREEN, blank.deps)
    expect(blank.calls).toEqual([])

    const card = recorder({ removedMode: true })
    dispatchCanvasContextMenu(fakeNode({ [ATTRS.cardId]: 'card-1' }), SCREEN, card.deps)
    expect(card.calls).toEqual(['card:card-1'])
  })

  it('命中了元素但集合里已找不到（同一帧被删）→ 静默放弃，不弹空菜单', () => {
    const card = recorder()
    dispatchCanvasContextMenu(fakeNode({ [ATTRS.cardId]: 'gone' }), SCREEN, card.deps)
    expect(card.calls).toEqual([])

    const partition = recorder()
    dispatchCanvasContextMenu(fakeNode({ [ATTRS.partitionId]: 'gone' }), SCREEN, partition.deps)
    expect(partition.calls).toEqual([])
  })
})
