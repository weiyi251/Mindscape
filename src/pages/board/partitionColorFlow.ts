// ============================================================================
// 模块说明（中文）
// 「指定分区颜色」的编排层（2026-09-15 从 Board.tsx 原样外抽）。
//
// 为什么单独成文件：Board.tsx 有行数棘轮（架构守卫规则 1，阈值 2080），
// 而新功能「便签颜色」（noteColorFlow.ts）要在旁边加同构的一段 —— 先把这块
// 旧逻辑搬出来腾地方，Board 侧只留薄壳调用。
//
// 职责划分：
//   · 二级色板菜单项组装 → pages/board/contextMenus.buildPartitionColorItems
//   · 改色命令（可撤销）→ core/commands/impl/setPartitionColor
//   · 「找到分区 → 记下旧色 → 弹菜单 → 选中执行」的编排 → 本文件
//
// 依赖全部以参数注入（不直接 import store / history），可在 node 环境单测。
// 行为与外抽前完全一致（原样迁移，无逻辑改动）。
// ============================================================================

import { buildPartitionColorItems } from './contextMenus'
import { createSetPartitionColorCommand } from '@/core/commands/impl/setPartitionColor'
import type { ApplyPartitionColor } from '@/core/commands/impl/setPartitionColor'
import type { Command } from '@/core/commands/types'
import type { ContextMenuState } from '@/components/ui/context-menu'
import type { Partition } from '@/core/types'

/** 本流程需要的分区状态切片（传 useBoardStore.getState() 即可，结构化类型） */
export type PartitionColorLookup = readonly Pick<Partition, 'id' | 'color'>[]

export interface PartitionColorDeps {
  /** 当前画布上的全部分区（查目标与改色前的旧值） */
  partitions: PartitionColorLookup
  /** 执行命令（Board 传 history.execute，成功后自动入撤销栈） */
  execute: (command: Command) => Promise<void>
  /** 请求落盘（Board 传 writer.schedule） */
  schedule: () => void
  /** 展开二级菜单（Board 传 setContextMenu） */
  showMenu: (menu: ContextMenuState) => void
  /** 写回层（Board 传 useBoardStore.getState().setPartitionColor） */
  applyColor: ApplyPartitionColor
}

/**
 * 弹出「指定颜色」二级色板菜单；选中后执行可撤销的改色命令并请求落盘。
 * 找不到分区（已折叠进历史快照的过期 id 等）时静默返回。
 *
 * @param partitionId 目标分区 id
 * @param screen      二级菜单的屏幕坐标（沿用一级菜单的弹出位置）
 */
export function openPartitionColorMenu(
  partitionId: string,
  screen: { x: number; y: number },
  deps: PartitionColorDeps,
): void {
  const current = deps.partitions.find((partition) => partition.id === partitionId)
  if (!current) return

  // 记下改色前的值，命令的 undo 用它还原
  const previousColor = current.color
  const items = buildPartitionColorItems((color) => {
    void deps
      .execute(createSetPartitionColorCommand(partitionId, previousColor, color, deps.applyColor))
      .then(() => deps.schedule())
  })
  deps.showMenu({ x: screen.x, y: screen.y, items })
}
