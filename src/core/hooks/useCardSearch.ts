// ============================================================================
// 模块说明（中文）
// 卡片搜索浮层的状态与动作（P1-3）。**纯 React 胶水**：匹配 / 整形 / 回绕等
// 纯逻辑在 `core/board/search.ts`（同名测试已覆盖），本 hook 只把状态接起来。
//
// 为什么放 core/hooks：与 useTheme 同层 —— 不接触 DOM / 画布，Board 直接消费；
// 跳转动作由调用方注入（`jumpTo`，Board 用它做「选中 + 视口居中」），
// 本 hook 不持有 canvasApiRef，保持 core 层不反向依赖 canvas（守卫规则 4）。
//
// 状态定位：搜索是 UI 瞬时态，**不进 Zustand**（无需落盘 / 跨页共享）；
// 关闭只藏浮层，查询词保留 —— 再次 Ctrl+F 可以在原词基础上微调。
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'

import type { Card } from '@/core/types'
import { searchTextOfCard } from '@/core/registry/cardTypes'
import type { CardSearchDoc } from '@/core/board/search'
import { describeHits, matchCards, stepIndex } from '@/core/board/search'

export interface UseCardSearchOptions {
  /** 参与搜索的卡片（调用方决定范围：正常视图 / 已移除视图） */
  cards: readonly Card[]
  /** 跳到某个命中项（选中 + 视口居中），由持有画布 API 的一方实现 */
  jumpTo: (id: string) => void
}

export function useCardSearch({ cards, jumpTo }: UseCardSearchOptions) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)

  // 组装搜索文档：插件卡的自有文本（如待办标题与条目）作为 extra 字段参与匹配
  //（2026-09-20 搜索打通插件卡）。纯数据映射，卡片数量级内开销可忽略。
  const docs = useMemo<CardSearchDoc[]>(
    () => cards.map((card) => ({ ...card, extra: searchTextOfCard(card) })),
    [cards],
  )

  const hits = useMemo(() => matchCards(docs, query), [docs, query])
  const items = useMemo(() => describeHits(docs, hits), [docs, hits])

  // 命中数变少（卡片被删 / 换空间）后当前项可能越界，退回「未选中」
  useEffect(() => {
    setActiveIndex((current) => (current >= items.length ? -1 : current))
  }, [items.length])

  /** 改词即重置当前项：旧的跳转位置对新词没有意义，按 Enter 从第一条开始 */
  const changeQuery = useCallback((value: string) => {
    setQuery(value)
    setActiveIndex(-1)
  }, [])

  const step = useCallback(
    (delta: number) => {
      // 在 updater 外计算：updater 里做副作用会被 StrictMode 双调用放大成两次跳转
      const next = stepIndex(activeIndex, items.length, delta)
      setActiveIndex(next)
      const item = items[next]
      if (next >= 0 && item) jumpTo(item.id)
    },
    [activeIndex, items, jumpTo],
  )

  const pick = useCallback(
    (index: number) => {
      setActiveIndex(index)
      const item = items[index]
      if (item) jumpTo(item.id)
    },
    [items, jumpTo],
  )

  const openSearch = useCallback(() => setOpen(true), [])
  const closeSearch = useCallback(() => setOpen(false), [])

  /** 传给画布的高亮集合：浮层开着才高亮，关闭即清（查询词保留） */
  const hitIds = useMemo(() => (open ? hits.map((hit) => hit.id) : []), [open, hits])
  const activeId = open && activeIndex >= 0 ? (items[activeIndex]?.id ?? null) : null

  return {
    open,
    query,
    items,
    activeIndex,
    hitIds,
    activeId,
    openSearch,
    closeSearch,
    changeQuery,
    step,
    pick,
  }
}
