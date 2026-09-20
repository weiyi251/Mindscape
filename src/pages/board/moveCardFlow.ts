// ============================================================================
// 模块说明（中文）
// 「移动卡片到文件夹」的编排层（2026-09-15 从 Board.tsx 原样外抽）。
//
// 为什么单独成文件：Board.tsx 有行数棘轮（架构守卫规则 1，阈值 2080），
// 新功能「重命名文件」（renameFileFlow.ts）要在旁边加一段 —— 把这块旧逻辑
// 搬出来腾地方，Board 侧只留「组依赖 + 一行调用」的薄壳。
//
// 职责划分：
//   · 二级文件夹菜单项组装 → pages/board/contextMenus.buildCardMoveItems
//   · 移动命令（可撤销，视图 + 文件一起动）→ core/commands/impl/moveCardToFolder
//   · 「早退守卫 → 弹二级菜单 → 选中执行 → 错误提示」的编排 → 本文件
//
// 依赖全部以参数注入（不直接 import store / history），可在 node 环境单测。
// 行为与外抽前完全一致（原样迁移，无逻辑改动）。
// ============================================================================

import { buildCardMoveItems } from './contextMenus'
import { createMoveCardsToFolderCommand } from '@/core/commands/impl/moveCardToFolder'
import type { CardFileRefUpdate } from '@/core/commands/impl/moveCardToFolder'
import { currentTopFolderOf } from '@/core/commands/impl/moveCardToFolder'
import type { Command } from '@/core/commands/types'
import type { StorageProvider } from '@/core/storage/StorageProvider'
import type { ContextMenuState } from '@/components/ui/context-menu'
import type { Card, Partition } from '@/core/types'

/** 用户可见文案常量表（与外抽前 Board 里的字面量一致） */
export const MOVE_CARD_TEXT = {
  readOnly: '布局由更新版本创建，处于只读模式，无法移动',
  noTarget: '没有可移动到的其他文件夹',
  failed: (message: string) => `移动失败：${message}`,
} as const

export interface MoveCardFlowDeps {
  /** 空间文件夹绝对路径（空串 = 无当前空间，静默早退） */
  spacePath: string
  /** 存储层（Board 传 localStorageProvider） */
  provider: StorageProvider
  /** 当前画布上的全部分区（二级菜单列出可移动目标；Board 传 store 快照数组） */
  partitions: Partition[]
  /** 只读模式：true 时拒绝移动 */
  readOnly: boolean
  /** 执行命令（Board 传 history.execute，成功后自动入撤销栈） */
  execute: (command: Command) => Promise<void>
  /** 请求落盘（Board 传 writer.schedule） */
  schedule: () => void
  /** 展开二级菜单（Board 传 setContextMenu） */
  showMenu: (menu: ContextMenuState) => void
  /** 失败提示（Board 传 setActionError） */
  onError: (message: string) => void
  /** do / undo 的应用：image 卡先重登记资源表，再写回卡片文件归属 */
  applyUpdate: (updates: CardFileRefUpdate[]) => void
  /** 目标分区包围盒变化（do 扩大 / undo 还原） */
  applyPartitionRects: (updates: { id: string; x: number; y: number; w: number; h: number }[]) => void
}

/**
 * 弹出「移动到…」二级文件夹菜单；选定后执行可撤销的移动命令并请求落盘。
 * 早退守卫：无空间 / 只读 / 全部目标都无文件（便签）/ 没有可移动目标。
 *
 * 【批量（2026-09-20 用户要求）】cards 可以是多张（框选后右键 → 整批移动）：
 * 一次动作一条组合命令，`Ctrl+Z` 一步整组还原。无文件的便签自动跳过
 * （它们在菜单层的 targets 里，但没有可移动的文件）。
 *
 * @param cards  目标卡片（至少一张；右键点中的那张 + 选中集合内的其余卡片）
 * @param screen 二级菜单的屏幕坐标（沿用一级菜单的弹出位置）
 */
export function openMoveCardMenu(
  cards: readonly Card[],
  screen: { x: number; y: number },
  deps: MoveCardFlowDeps,
): void {
  if (deps.spacePath === '') return
  if (deps.readOnly) {
    deps.onError(MOVE_CARD_TEXT.readOnly)
    return
  }
  // 便签（filePath 为空）没有文件可搬，从批次里剔除
  const movables = cards.filter((card) => card.filePath !== '')
  if (movables.length === 0) return

  const move = (
    targetFolderRel: string,
    groupName: string | undefined,
    partition: Partition | null,
  ) => {
    void deps
      .execute(
        createMoveCardsToFolderCommand(movables, targetFolderRel, groupName, partition, {
          spacePath: deps.spacePath,
          // 资源表写入必须早于 store 更新（渲染时读快照，方案 A 裁决 6）；
          // undo 复用同一路径把原图绝对路径写回旧值 —— 由 deps.applyUpdate 的
          // Board 侧实现保证
          provider: deps.provider,
          applyUpdate: deps.applyUpdate,
          applyPartitionRects: deps.applyPartitionRects,
        }),
      )
      .then(() => deps.schedule())
      .catch((error: unknown) => {
        deps.onError(
          MOVE_CARD_TEXT.failed(error instanceof Error ? error.message : String(error)),
        )
      })
  }

  // 隐藏「目标已经在的文件夹」：单卡按它自己的所在目录；多卡时**只有全部目标
  // 都已在该目录**才隐藏（否则用户没法把散落的卡片归并到其中之一）
  const folders = new Set(movables.map((card) => currentTopFolderOf(card.filePath)))
  const currentFolder = folders.size === 1 ? [...folders][0] : ''

  const items = buildCardMoveItems({
    partitions: deps.partitions,
    currentFolder,
    // 多卡时逐项给出张数，避免「移到哪、移几张」有歧义
    countLabel: movables.length > 1 ? movables.length : undefined,
    onMove: move,
  })

  if (items.length === 0) {
    deps.onError(MOVE_CARD_TEXT.noTarget)
    return
  }
  deps.showMenu({ x: screen.x, y: screen.y, items })
}
