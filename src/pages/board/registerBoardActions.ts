// ============================================================================
// 模块说明（中文）
// 画布菜单 / 右键菜单的**动作登记**（2026-09-20 自 Board.tsx 外抽 —— 行数棘轮
// 只剩 11 行，而 C 组优化项（卡片锁定 / 批量移动 / 对齐分布）都要动 Board；
// 逐项往里加必然撞红线，故先把这整块「id → 真实实现」的映射搬出来）。
//
// 职责：把 `core/registry/menus.ts` 配置中心里的动作 id 接到 Board 的具体实现上
// （菜单项本身来自配置中心，这里只做映射，杜绝在浮层里硬编码菜单项 —— T3.9 约定）。
//
// 依赖全部以参数注入（不直接持有 React 状态 / 不 import 页面层），因此本文件是
// 纯映射胶水：可在 node 环境用 actionRegistry.runAction 直接驱动断言（同名测试）。
//
// ⚠️ 用法：Board 的 useEffect 里调用一次；依赖数组沿用原 effect 的那一组 handler，
//    保证 handler 重建时重新登记（注册表以 id 为键，重复登记即覆盖，安全）。
// ============================================================================

import type { MutableRefObject } from 'react'

import type { CanvasApi } from '@/canvas/Canvas'
import type { Point } from '@/canvas/interaction/coordinates'
import { PARTITION_TITLE_HEIGHT } from '@/core/board/partitions'
import { registerAction } from '@/core/registry/actionRegistry'
import { CARD_ACTION, CONNECTION_ACTION, PARTITION_ACTION } from '@/core/registry/menus'
import { useBoardStore } from '@/core/store/boardStore'
import { useSpacesStore } from '@/core/store/spacesStore'
import type { Card, Connection, Partition } from '@/core/types'
import type { Command } from '@/core/commands/types'
import { joinPath } from '@/core/utils/paths'
import { toggleCardLock } from './cardLockFlow'

/** 分区粘贴的目标描述（与 Board 的 pasteCards 第二参一致） */
interface PasteDestination {
  destDir: string
  groupName: string | null
  partitionId: string | null
}

/** 动作登记所需的 Board 侧实现（全部来自 Board 的 useCallback / ref） */
export interface BoardActionDeps {
  handleRemoveCards: (ids: string[]) => void
  handleCardZIndex: (cardId: string, to: 'front' | 'back') => void
  handleCardNote: (card: Card) => void
  handleCardTags: (card: Card) => void
  openCardWithSystem: (card: Card) => Promise<void>
  handleTogglePartitionCollapsed: (id: string) => void
  handleEditConnectionLabel: (id: string) => void
  handleRemoveConnections: (ids: string[]) => void
  handleCopyCards: (cards: Card[]) => Promise<void>
  pasteCards: (point: Point, destOverride?: PasteDestination) => Promise<void>
  /** 「连线」菜单项：设置挂起中的连线起点卡片（Board 的 setPendingConnectFrom） */
  setPendingConnectFrom: (cardId: string) => void
  /** 命令执行（Board 传 history.execute，成功后自动入撤销栈） */
  execute: (command: Command) => Promise<void>
  /** 请求落盘（Board 传 writer.schedule） */
  schedule: () => void
  /** 画布命令式 API（便签行内编辑 / 分区行内改名） */
  canvasApiRef: MutableRefObject<CanvasApi | null>
}

/** 菜单上下文里可能出现的三种目标（与 MenuContext 对齐，此处只取需要的三个） */
interface ActionContext {
  card?: Card
  partition?: Partition
  connection?: Connection
}

/**
 * 一次性登记全部核心菜单动作。
 * Board 在 useEffect 中调用（依赖数组 = 上面这组 handler）。
 */
export function registerBoardActions(deps: BoardActionDeps): void {
  const register = (id: string, run: (ctx: ActionContext) => void) => {
    registerAction(id, (ctx) =>
      run({ card: ctx.card, partition: ctx.partition, connection: ctx.connection }),
    )
  }

  register(CARD_ACTION.openOriginal, ({ card }) => {
    if (card) void deps.openCardWithSystem(card)
  })
  register(CARD_ACTION.remove, ({ card }) => {
    if (card) deps.handleRemoveCards([card.id])
  })
  register(CARD_ACTION.bringToFront, ({ card }) => {
    if (card) deps.handleCardZIndex(card.id, 'front')
  })
  register(CARD_ACTION.sendToBack, ({ card }) => {
    if (card) deps.handleCardZIndex(card.id, 'back')
  })
  register(CARD_ACTION.addNote, ({ card }) => {
    if (!card) return
    // 便签：复用双击的行内编辑态（用户要求：便签编辑不再弹窗）
    if (card.type === 'note') {
      deps.canvasApiRef.current?.beginNoteEdit(card.id)
      return
    }
    deps.handleCardNote(card)
  })
  register(CARD_ACTION.editLabel, ({ card }) => {
    if (card) deps.handleCardTags(card)
  })
  // 「连线」：进入挂起模式，下一张点中的卡片为目标（配合边缘拖拽，T3.1）
  register(CARD_ACTION.connect, ({ card }) => {
    if (card) deps.setPendingConnectFrom(card.id)
  })
  // 「复制」（2026-09-11 用户裁决：三种类型全支持）：菜单 / Ctrl+C 同一实现
  register(CARD_ACTION.copy, ({ card }) => {
    if (card) void deps.handleCopyCards([card])
  })
  // 「锁定 / 解锁卡片」（2026-09-20 用户要求：摆好版面后防误拖）：
  // 一次 meta 翻转（可撤销），编排见 cardLockFlow.ts
  register(CARD_ACTION.toggleLock, ({ card }) => {
    if (!card) return
    void toggleCardLock(card, {
      execute: deps.execute,
      schedule: deps.schedule,
      applyMeta: (id, meta) => useBoardStore.getState().setCardMeta(id, meta),
    })
  })
  // 「粘贴」：粘贴进目标分区（落点 = 分区中心），拷贝原件或克隆便签
  register(PARTITION_ACTION.paste, ({ partition }) => {
    if (!partition) return
    const spacePath = useSpacesStore.getState().getCurrentSpace()?.folderPath
    if (!spacePath) return
    const center = {
      x: partition.x + partition.w / 2,
      y:
        partition.y +
        (partition.collapsed
          ? PARTITION_TITLE_HEIGHT / 2
          : PARTITION_TITLE_HEIGHT + (partition.h - PARTITION_TITLE_HEIGHT) / 2),
    }
    void deps.pasteCards(center, {
      destDir: joinPath(spacePath, partition.folderPath),
      groupName: partition.name,
      partitionId: partition.id,
    })
  })
  register(PARTITION_ACTION.rename, ({ partition }) => {
    // 2026-09-14 修复：右键「重命名分区」须进入**改名编辑态**（与双击标题一致），
    // 而不是直接以「当前名」调 handleRenamePartition —— 后者有 `新名 === 现名` 早退守卫，
    // 传入当前名会直接 return，导致菜单点击毫无反应。进入编辑态后由用户输入新名，
    // 提交时 PartitionView 经 onRename 回调走五步保护。
    if (partition) deps.canvasApiRef.current?.beginPartitionRename(partition.id)
  })
  register(PARTITION_ACTION.toggleCollapse, ({ partition }) => {
    if (partition) deps.handleTogglePartitionCollapsed(partition.id)
  })
  // 连线菜单：编辑标签（同双击）/ 删除连线（断开连接，2026-09-11 用户裁决）
  register(CONNECTION_ACTION.editLabel, ({ connection }) => {
    if (connection) deps.handleEditConnectionLabel(connection.id)
  })
  register(CONNECTION_ACTION.remove, ({ connection }) => {
    if (connection) deps.handleRemoveConnections([connection.id])
  })
}
