// ============================================================================
// 模块说明（中文）
// useCanvasShortcuts.ts 的单测。只测其中的**纯派发函数** dispatchCanvasShortcut ——
// 它不碰 window，node 环境可直接调用（本项目不引入 jsdom，事件监听本身不做单测）。
// 覆盖点：每个画布动作是否命中正确的画布能力、preventDefault 的时机、
// 已移除视图与空选中下的边界行为。
// ============================================================================

import { describe, expect, it, vi } from 'vitest'

import type { Card, Partition } from '@/core/types'

import { contentRects } from './interaction/fitToContent'
import type { ViewportController } from './interaction/viewportController'
import { dispatchCanvasShortcut } from './useCanvasShortcuts'
import type { CanvasShortcutRefs } from './useCanvasShortcuts'

const card = (id: string): Card =>
  ({
    id,
    type: 'file',
    filePath: `${id}.txt`,
    originalPath: `${id}.txt`,
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    note: '',
    group: '',
    zIndex: 0,
    meta: {},
  }) as Card

const partition = (id: string): Partition =>
  ({
    id,
    name: id,
    folderPath: id,
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    color: 'auto',
    collapsed: false,
    meta: {},
  }) as Partition

function makeFakes(
  over: {
    removedMode?: boolean
    selectedIds?: string[]
    cards?: Card[]
    partitions?: Partition[]
  } = {},
) {
  const fitToContent = vi.fn()
  const reset = vi.fn()
  const preventDefault = vi.fn()
  const onSelectCards = vi.fn()
  const onRequestSearch = vi.fn()
  const onRemoveCards = vi.fn()

  const refs: CanvasShortcutRefs = {
    controller: { current: { fitToContent, reset } as unknown as ViewportController },
    cards: { current: over.cards ?? [card('a'), card('b')] },
    partitions: { current: over.partitions ?? [partition('p')] },
    removedMode: { current: over.removedMode ?? false },
    selectedIds: { current: over.selectedIds ?? ['a'] },
    onSelectCards: { current: onSelectCards },
    onRequestSearch: { current: onRequestSearch },
    onRemoveCards: { current: onRemoveCards },
  }

  return {
    refs,
    fitToContent,
    reset,
    preventDefault,
    event: { preventDefault },
    onSelectCards,
    onRequestSearch,
    onRemoveCards,
  }
}

describe('dispatchCanvasShortcut', () => {
  it('view.fit：把当前内容矩形交给控制器，并阻止浏览器默认行为', () => {
    const f = makeFakes()
    dispatchCanvasShortcut('view.fit', f.refs, f.event)
    expect(f.preventDefault).toHaveBeenCalledTimes(1)
    expect(f.fitToContent).toHaveBeenCalledWith(
      contentRects(f.refs.cards.current, f.refs.partitions.current),
    )
  })

  it('view.reset：复原视图', () => {
    const f = makeFakes()
    dispatchCanvasShortcut('view.reset', f.refs, f.event)
    expect(f.reset).toHaveBeenCalledTimes(1)
    expect(f.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('canvas.selectAll：全选画布上的卡片', () => {
    const f = makeFakes({ cards: [card('a'), card('b'), card('c')] })
    dispatchCanvasShortcut('canvas.selectAll', f.refs, f.event)
    expect(f.onSelectCards).toHaveBeenCalledWith(['a', 'b', 'c'])
  })

  it('canvas.search：请求打开搜索浮层（必须 preventDefault，否则被页内查找抢走）', () => {
    const f = makeFakes()
    dispatchCanvasShortcut('canvas.search', f.refs, f.event)
    expect(f.onRequestSearch).toHaveBeenCalledTimes(1)
    expect(f.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('canvas.escape：取消选中（这里不阻止默认行为）', () => {
    const f = makeFakes()
    dispatchCanvasShortcut('canvas.escape', f.refs, f.event)
    expect(f.onSelectCards).toHaveBeenCalledWith([])
    expect(f.preventDefault).not.toHaveBeenCalled()
  })

  it('card.remove：有选中时移除选中的卡片', () => {
    const f = makeFakes({ selectedIds: ['a', 'b'] })
    dispatchCanvasShortcut('card.remove', f.refs, f.event)
    expect(f.onRemoveCards).toHaveBeenCalledWith(['a', 'b'])
    expect(f.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('card.remove：已移除视图下不生效（T2.7 / 5.3）', () => {
    const f = makeFakes({ removedMode: true })
    dispatchCanvasShortcut('card.remove', f.refs, f.event)
    expect(f.onRemoveCards).not.toHaveBeenCalled()
  })

  it('card.remove：没有选中时什么也不做', () => {
    const f = makeFakes({ selectedIds: [] })
    dispatchCanvasShortcut('card.remove', f.refs, f.event)
    expect(f.onRemoveCards).not.toHaveBeenCalled()
    expect(f.preventDefault).not.toHaveBeenCalled()
  })

  it('不属于画布的动作（如撤销）一律忽略', () => {
    const f = makeFakes()
    dispatchCanvasShortcut('edit.undo', f.refs, f.event)
    expect(f.fitToContent).not.toHaveBeenCalled()
    expect(f.reset).not.toHaveBeenCalled()
    expect(f.onSelectCards).not.toHaveBeenCalled()
    expect(f.onRequestSearch).not.toHaveBeenCalled()
    expect(f.onRemoveCards).not.toHaveBeenCalled()
    expect(f.preventDefault).not.toHaveBeenCalled()
  })

  it('控制器尚未挂载（null）时不抛错', () => {
    const f = makeFakes()
    f.refs.controller.current = null
    expect(() => dispatchCanvasShortcut('view.fit', f.refs, f.event)).not.toThrow()
    expect(() => dispatchCanvasShortcut('view.reset', f.refs, f.event)).not.toThrow()
  })
})
