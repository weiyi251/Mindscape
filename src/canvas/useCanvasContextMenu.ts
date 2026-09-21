// ============================================================================
// 模块说明（中文）
// 画布「弹出菜单」的接线层（2026-09-21 移动端适配 M2 从 Canvas.tsx 拆出）。
//
// 拆的原因：Canvas.tsx 被架构守卫的行数上限顶死（规则 1），而移动端要在这里加
// 「长按 = 右键」这条新链路，原文件塞不下。判定与分派的**逻辑**已经外抽到
// interaction/contextMenuHitTest.ts（纯函数、已单测），本文件只剩两件事：
//   ① 在画布根上挂 / 卸 contextmenu 监听；
//   ② 把「元素 + 屏幕坐标」这对口喂给那个纯分派函数。
// 桌面与移动端因此共用同一份命中优先级，不会出现「桌面改了、移动端忘改」。
//
// 参数一律传 ref 容器（与 useCanvasShortcuts 同一约定）：菜单回调每帧都可能换引用，
// 但监听只挂一次，回调里永远读到最新值（17.3 精神）。
// ============================================================================

import { useCallback, useEffect, useRef } from 'react'

import type { Card, Partition } from '@/core/types'

import { CANVAS_ROOT_ATTR } from './Viewport'
import { CARD_ID_ATTR } from './Card'
import { PARTITION_ID_ATTR } from './Partition'
import { CONNECTION_ID_ATTR } from './Connection'
import { dispatchCanvasContextMenu } from './interaction/contextMenuHitTest'
import type { Point } from './interaction/coordinates'

/** 弹菜单所需的「最新值容器」（结构类型，直接传 Canvas 里的 useRef） */
export interface CanvasContextMenuRefs {
  wrapper: { current: HTMLDivElement | null }
  cards: { current: Card[] }
  partitions: { current: Partition[] }
  removedMode: { current: boolean }
  /** 屏幕坐标 → 画布坐标（空白菜单的新建落点要用；未就绪时按 {0,0} 处理） */
  getCanvasPoint: { current: ((event: PointerEvent) => Point) | null }
  onCard: { current: ((card: Card, screen: Point) => void) | undefined }
  onConnection: { current: ((connectionId: string, screen: Point) => void) | undefined }
  onPartition: { current: ((partition: Partition, screen: Point) => void) | undefined }
  onCanvas: { current: ((canvas: Point, screen: Point) => void) | undefined }
}

/** 右键 / 长按菜单的命中属性 → DOM 属性名（常量住在各自组件里） */
const CONTEXT_MENU_ATTRS = {
  connectionId: CONNECTION_ID_ATTR,
  cardId: CARD_ID_ATTR,
  partitionId: PARTITION_ID_ATTR,
}

/**
 * 挂好 contextmenu 监听，并返回「从某个元素 + 屏幕坐标弹出菜单」的入口
 * （长按链路拿这个入口复用同一份分派）。
 */
export function useCanvasContextMenu(
  refs: CanvasContextMenuRefs,
): (element: HTMLElement | null, screen: Point) => void {
  // 依赖容器本身每帧都是新对象（Canvas 里传的是字面量），所以先存进 ref，
  // 让 dispatchContextMenu 的引用保持稳定 —— 否则 contextmenu 监听每次重渲染都重挂
  const refsRef = useRef(refs)
  refsRef.current = refs

  const dispatchContextMenu = useCallback(
    (element: HTMLElement | null, screen: Point) => {
      const current = refsRef.current
      dispatchCanvasContextMenu(element, screen, {
        attributes: CONTEXT_MENU_ATTRS,
        removedMode: current.removedMode.current,
        findCard: (id) => current.cards.current.find((item) => item.id === id),
        findPartition: (id) => current.partitions.current.find((item) => item.id === id),
        onConnection: (id, point) => current.onConnection.current?.(id, point),
        onCard: (card, point) => current.onCard.current?.(card, point),
        onPartition: (partition, point) => current.onPartition.current?.(partition, point),
        // 空白：给上层画布坐标（新建便签落点用）+ 屏幕坐标（浮层定位用）
        onBlank: (point) =>
          current.onCanvas.current?.(
            current.getCanvasPoint.current?.({
              clientX: point.x,
              clientY: point.y,
            } as PointerEvent) ?? { x: 0, y: 0 },
            point,
          ),
      })
    },
    [],
  )

  useEffect(() => {
    const root = refsRef.current.wrapper.current?.querySelector<HTMLElement>(
      `[${CANVAS_ROOT_ATTR}]`,
    )
    if (!root) return

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault()
      dispatchContextMenu(event.target as HTMLElement | null, {
        x: event.clientX,
        y: event.clientY,
      })
    }

    root.addEventListener('contextmenu', handleContextMenu)
    return () => root.removeEventListener('contextmenu', handleContextMenu)
  }, [dispatchContextMenu])

  return dispatchContextMenu
}
