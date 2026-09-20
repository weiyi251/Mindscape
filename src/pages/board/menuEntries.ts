// ============================================================================
// 模块说明（中文）
// 右键菜单的**弹出入口**（2026-09-20 自 Board.tsx 外抽 —— 行数棘轮 2000 上限
// 已顶到 2002，而 C3 对齐分布 / A2 生成分区 / A1 外部变动提示条都还要动 Board；
// 按守卫约定「先外抽而不是调阈值」）。
//
// 职责：**取上下文 + 组装菜单数组 + 放入浮层 state**。菜单项的配置与回调映射
// 仍在 pages/board/contextMenus 里（那边是纯函数，本文件只是把 Board 的状态 /
// store 快照喂给它），两级合起来才等于 T3.9 的「配置中心 → 浮层」这条链路。
//
// 依赖以参数注入（不开 React hooks、不 import 页面层），可在 node 环境单测。
// ============================================================================

import { buildCardMenuItems, buildConnectionMenuItems, buildPartitionMenuItems } from './contextMenus'
import type { ContextMenuState } from '@/components/ui/context-menu'
import { useBoardStore } from '@/core/store/boardStore'
import { useSpacesStore } from '@/core/store/spacesStore'
import type { Card, Partition } from '@/core/types'

/** 屏幕坐标（与 contextMenus 的 ScreenPoint 同形） */
interface ScreenPoint {
  x: number
  y: number
}

export interface MenuEntryDeps {
  /** 浮层状态写入（Board 传 setContextMenu） */
  setContextMenu: (menu: ContextMenuState) => void
  /** 已移除视图（决定卡片菜单是否插入「恢复 / 彻底删除」） */
  removedView: boolean
  /** 当前选中集合（决定批量操作的张数） */
  selectedIds: string[]
  /** 当前画布卡片（按选中 id 取对象，供批量移动使用） */
  cards: Card[]
  /** 「移动到…」（批量：目标为卡片数组） */
  onMove: (cards: Card[], screen: ScreenPoint) => void
  onRestore: (ids: string[]) => void
  onSetColor: (card: Card, screen: ScreenPoint) => void
  onDeleteForever: (ids: string[]) => void
  /** 「重命名文件」：Board 侧已组装好依赖的薄壳（编排见 renameFileFlow.ts） */
  onRenameFile: (card: Card) => void
  /** 剪贴板是否有卡片（决定分区菜单「粘贴」是否可用） */
  hasCopiedCards: boolean
  /** 「分区颜色…」：Board 侧以 partitionId 为入参（见 partitionColorFlow） */
  onSetPartitionColor: (partitionId: string, screen: ScreenPoint) => void
}

/** 当前空间路径（未打开空间时为空串 —— 与各 flow 的「静默早退」约定一致） */
function currentSpacePath(): string {
  return useSpacesStore.getState().getCurrentSpace()?.folderPath ?? ''
}

/** 卡片右键：组装并弹出菜单 */
export function openCardContextMenu(card: Card, screen: ScreenPoint, deps: MenuEntryDeps): void {
  const items = buildCardMenuItems({
    card,
    screen,
    spacePath: currentSpacePath(),
    removedView: deps.removedView,
    selectedIds: deps.selectedIds,
    selectedCards: deps.cards.filter((item) => deps.selectedIds.includes(item.id)),
    onMove: deps.onMove,
    onRestore: deps.onRestore,
    onSetColor: deps.onSetColor,
    onDeleteForever: deps.onDeleteForever,
    onRenameFile: deps.onRenameFile,
  })
  deps.setContextMenu({ x: screen.x, y: screen.y, items })
}

/** 分区右键：组装并弹出菜单 */
export function openPartitionContextMenu(
  partition: Partition,
  screen: ScreenPoint,
  deps: MenuEntryDeps,
): void {
  const items = buildPartitionMenuItems({
    partition,
    screen,
    spacePath: currentSpacePath(),
    hasCopiedCards: deps.hasCopiedCards,
    onSetColor: deps.onSetPartitionColor,
  })
  deps.setContextMenu({ x: screen.x, y: screen.y, items })
}

/** 连线右键：组装并弹出菜单（连线可能已被删除 → 静默返回） */
export function openConnectionContextMenu(
  connectionId: string,
  screen: ScreenPoint,
  deps: MenuEntryDeps,
): void {
  const connection = useBoardStore
    .getState()
    .connections.find((item) => item.id === connectionId)
  if (!connection) return
  const items = buildConnectionMenuItems({ connection, spacePath: currentSpacePath() })
  deps.setContextMenu({ x: screen.x, y: screen.y, items })
}
