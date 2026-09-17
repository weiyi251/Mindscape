// ============================================================================
// 模块说明（中文）
// 「便签颜色」的编排层（2026-09-15 用户需求「添加自定义便签颜色功能」）。
//
// 与 partitionColorFlow.ts 同构：右键「便签颜色…」→ 弹二级色板菜单 →
// 选中后执行**可撤销**的 meta 命令并请求落盘。选择结果写入
// card.meta.noteColor（约定见 core/board/noteColors.ts），「默认便签纸」
// 首项传 null = 删键回到默认。
//
// 依赖全部以参数注入（不直接 import store / history），可在 node 环境单测。
// ============================================================================

import { buildNoteColorItems } from './contextMenus'
import { createSetCardMetaCommand } from '@/core/commands/impl/setCardMeta'
import type { ApplyCardMeta } from '@/core/commands/impl/setCardMeta'
import { metaWithNoteColor } from '@/core/board/noteColors'
import type { Command } from '@/core/commands/types'
import type { ContextMenuState } from '@/components/ui/context-menu'
import type { Card } from '@/core/types'

export interface NoteColorDeps {
  /** 执行命令（Board 传 history.execute，成功后自动入撤销栈） */
  execute: (command: Command) => Promise<void>
  /** 请求落盘（Board 传 writer.schedule） */
  schedule: () => void
  /** 展开二级菜单（Board 传 setContextMenu） */
  showMenu: (menu: ContextMenuState) => void
  /** 写回层（Board 传 useBoardStore.getState().setCardMeta） */
  applyMeta: ApplyCardMeta
}

/**
 * 弹出「便签颜色…」二级色板菜单；选中后执行可撤销的 meta 命令并请求落盘。
 * 首项「默认便签纸」onPick(null)，其余项 onPick(色板色值)。
 *
 * @param card   目标便签卡片（菜单弹出时定格其 meta，undo 用它还原）
 * @param screen 二级菜单的屏幕坐标（沿用一级菜单的弹出位置）
 */
export function openNoteColorMenu(
  card: Card,
  screen: { x: number; y: number },
  deps: NoteColorDeps,
): void {
  const items = buildNoteColorItems((color) => {
    void deps
      .execute(
        createSetCardMetaCommand(
          card.id,
          card.meta,
          metaWithNoteColor(card.meta, color),
          deps.applyMeta,
        ),
      )
      .then(() => deps.schedule())
  })
  deps.showMenu({ x: screen.x, y: screen.y, items })
}
