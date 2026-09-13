// ============================================================================
// 模块说明（中文）
// 画布侧快捷键（从 Canvas.tsx 拆出 —— 该文件已被守卫行数上限顶死，
// 插件期还要往里埋钩子。见 docs/插件功能实施方案.md §7）。
//
// 拆成两半，好处是**派发逻辑可单测**（本项目不引入 jsdom，无法测事件监听）：
//   · dispatchCanvasShortcut —— 纯派发：给定动作 + 一组「最新值容器」+ 事件门面，
//     执行对应画布能力。不碰 window，因此 node 环境可直接调用断言。
//   · useCanvasShortcuts —— 仅负责挂 / 卸 window keydown，把注册中心解析出的
//     动作交给上面那个纯函数。
//
// 分工边界：fit / reset / 全选 / 搜索 / Esc 取消选中 / Delete 移除选中 —— 画布专属
// 动作在这里；撤销 / 重做 / 复制 / 粘贴 / 保存由 Board 侧处理，本模块不碰。
// 键位一律按物理键位（event.code）由 resolveShortcut 判定（Shift 把 key 变上档
// 字符也不受影响）；绑定同步读 getState()，不进 React 订阅 —— 按键是高频路径，
// 不能因为改绑引起画布重渲染（17.3 精神）。
//
// 参数一律传 ref 容器（在各组件里都是 useRef 产物、引用稳定），因此
// useEffect 只挂一次监听，回调里永远读到最新值。
// ============================================================================

import { useEffect } from 'react'

import type { Card, Partition } from '@/core/types'
import { resolveShortcut } from '@/core/shortcuts/keys'
import type { ShortcutId } from '@/core/shortcuts/keys'
import { useShortcutsStore } from '@/core/store/shortcutsStore'

import { contentRects } from './interaction/fitToContent'
import type { ViewportController } from './interaction/viewportController'

/** 快捷键派发所需的「最新值容器」（结构类型，直接传 Canvas 里的 useRef 即可） */
export interface CanvasShortcutRefs {
  controller: { current: ViewportController | null }
  cards: { current: Card[] }
  partitions: { current: Partition[] }
  removedMode: { current: boolean }
  selectedIds: { current: string[] }
  onSelectCards: { current: ((ids: string[]) => void) | undefined }
  onRequestSearch: { current: (() => void) | undefined }
  onRemoveCards: { current: ((ids: string[]) => void) | undefined }
}

/** 事件门面：KeyboardEvent 满足它；单测可传一个假对象 */
export interface PreventableEvent {
  preventDefault: () => void
}

/**
 * 把一个画布快捷键动作派发到对应能力上（纯函数：只读传入的容器，不碰全局）。
 * 不认识的动作（属于 Board 侧或未绑定）直接忽略。
 */
export function dispatchCanvasShortcut(
  action: ShortcutId,
  refs: CanvasShortcutRefs,
  event: PreventableEvent,
): void {
  switch (action) {
    case 'view.fit':
      event.preventDefault()
      refs.controller.current?.fitToContent(contentRects(refs.cards.current, refs.partitions.current))
      return
    case 'view.reset':
      event.preventDefault()
      refs.controller.current?.reset()
      return
    case 'canvas.selectAll':
      event.preventDefault()
      refs.onSelectCards.current?.(refs.cards.current.map((card) => card.id))
      return
    case 'canvas.search':
      // preventDefault 是必需的 —— 浏览器 / WebView 的「页内查找」会抢这个
      // 组合键（且它查不到画布上的内容）
      event.preventDefault()
      refs.onRequestSearch.current?.()
      return
    case 'canvas.escape':
      refs.onSelectCards.current?.([])
      return
    case 'card.remove': {
      // 已移除视图下不生效（T2.7 / 5.3）
      if (refs.removedMode.current) return
      const ids = refs.selectedIds.current
      if (ids.length > 0) {
        event.preventDefault()
        refs.onRemoveCards.current?.(ids)
      }
      return
    }
    default:
      return
  }
}

/**
 * 注册画布快捷键监听（挂载一次，卸载时移除）。
 * 幂等：同一事件只在此一处判定，避免多个 effect 各判一遍导致改绑后漏判。
 */
export function useCanvasShortcuts(refs: CanvasShortcutRefs): void {
  const {
    controller,
    cards,
    partitions,
    removedMode,
    selectedIds,
    onSelectCards,
    onRequestSearch,
    onRemoveCards,
  } = refs

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const action = resolveShortcut(event, useShortcutsStore.getState().bindings)
      if (!action) return
      // 容器对象在按键时才组装 —— 避免每次渲染造一个新对象把 effect 拽着重挂
      dispatchCanvasShortcut(
        action,
        {
          controller,
          cards,
          partitions,
          removedMode,
          selectedIds,
          onSelectCards,
          onRequestSearch,
          onRemoveCards,
        },
        event,
      )
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
    // 参数全是引用稳定的 ref 容器：监听只挂一次
  }, [
    controller,
    cards,
    partitions,
    removedMode,
    selectedIds,
    onSelectCards,
    onRequestSearch,
    onRemoveCards,
  ])
}
