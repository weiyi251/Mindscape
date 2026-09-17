// ============================================================================
// 模块说明（中文）
// 插件画布桥的**实现**（2026-09-17 自 Board.tsx 外抽 —— Board 行数棘轮只剩 1 行，
// 桥实现约 60 行必须搬走；同批新增 createCard / updateCardContent 两个能力，
// 服务于待办卡片插件「无文件建卡 + 高度自适应提交」）。
//
// 职责边界：本文件只做「把 Board 闭包里的能力整理成 PluginBoardBridge」，
// 不碰 React（无 hooks / 无 JSX）。Board 挂载时传入依赖（视口换算、拖入链路
// 两个回调、命令历史、落盘调度器）拿到桥对象注册进 core/plugin/boardBridge。
//
// 三个建卡 / 改卡入口的分工：
//   · createCardFromFile —— 卡片对应「已存在于硬盘」的文件（色卡插件）：
//     走拖入同款路径（读图片尺寸 + 资源表登记 + addCards）。
//   · createCard         —— 卡片**不对应任何文件**（待办卡等插件自绘类型）：
//     直接组卡走 addCards（undo 只删卡，同新建便签），返回新卡 id。
//   · updateCardContent  —— 插件卡片内容提交：meta 整体替换 + 高度自适应，
//     合为一条命令入撤销栈（见 core/commands/impl/updateCardContent.ts）。
// ============================================================================

import type { Point } from '@/canvas/interaction/coordinates'
import type { DropDestination } from '@/core/board/ingest'
import type { LayoutWriter } from '@/core/board/layoutWriter'
import { createAddCardsCommand } from '@/core/commands/impl/addCards'
import type { AddCardsSource } from '@/core/commands/impl/addCards'
import type { History } from '@/core/commands/history'
import { createUpdateCardContentCommand } from '@/core/commands/impl/updateCardContent'
import type { PluginBoardBridge } from '@/core/plugin/boardBridge'
import type { CreateCardInput } from '@/core/plugin/types'
import { useBoardStore } from '@/core/store/boardStore'
import { useSpacesStore } from '@/core/store/spacesStore'
import { localStorageProvider } from '@/core/storage/LocalFolderProvider'
import { zCardSchema } from '@/core/types'
import type { Card } from '@/core/types'
import { nextCardId } from '@/core/utils/id'
import { dirnameOf, relativePathOf } from '@/core/utils/paths'

/**
 * 新建卡片时「已用 id 全集」：**画布卡片 + 已移除记录**。
 *
 * ⚠️ 两者共用同一 id 空间 —— removed 记录按 id 与灰卡关联（恢复时要用），
 * 只把画布卡片的 id 当种子会让新卡拿到已被移除记录占用的 id；
 * 该新卡再被移除时，removed 里就出现两条同 id 记录，
 * 恢复时「按 id 匹配」会命中错误的旧记录 → 「恢复失败：不是文件」。
 */
export function usedCardIds(): string[] {
  const state = useBoardStore.getState()
  return [...state.cards.map((card) => card.id), ...state.removed.map((entry) => entry.id)]
}

/** 临时诊断导出（跑完即删） */
export const __diagStore = useBoardStore

/** 组装桥所需的 Board 侧依赖（全部来自 Board.tsx 的闭包 / ref） */
export interface PluginBridgeDeps {
  /** 视口中心的画布坐标（建卡默认落点；null = 画布未挂载） */
  viewportCenterCanvasPoint: () => Point | null
  /** 拖入链路建卡（读图片原始尺寸 + 资源表登记），实现见 Board.tsx */
  buildIngestedCard: (params: {
    id: string
    actualAbs: string
    spacePath: string
    point: Point
    offset: number
  }) => Promise<Card>
  /** 拖入链路提交（addCards 命令 + 分区扩框 + 落盘），实现见 Board.tsx */
  commitIngestedCards: (
    cards: Card[],
    createdFiles: string[],
    sources: AddCardsSource[],
    dest: DropDestination,
  ) => Promise<void>
  /** 命令历史（撤销栈） */
  history: History
  /** 布局落盘调度器 */
  writer: LayoutWriter
}

/** 无文件建卡的宿主默认尺寸（与新建便签一致；插件可用 w/h 覆盖） */
const DEFAULT_PLAIN_CARD_SIZE = { w: 200, h: 160 }

/** 组装插件画布桥（Board 挂载时调用，返回值交给 setPluginBoardBridge） */
export function createPluginBoardBridge(deps: PluginBridgeDeps): PluginBoardBridge {
  return {
    currentSpacePath: () => useSpacesStore.getState().getCurrentSpace()?.folderPath ?? null,

    createCardFromFile: async (input: CreateCardInput) => {
      const space = useSpacesStore.getState().getCurrentSpace()
      if (!space || useBoardStore.getState().readOnly) return false
      const point = deps.viewportCenterCanvasPoint()
      if (!point) return false

      // 与拖入 / 粘贴走同一条建卡路径：图片卡会读原始尺寸并登记资源表
      const card = await deps.buildIngestedCard({
        id: nextCardId(usedCardIds()),
        actualAbs: input.absolutePath,
        spacePath: space.folderPath,
        point,
        offset: 0,
      })

      // 插件给的字段优先于推导值 —— 它比我们更知道这张卡该是什么样
      card.filePath = input.relativePath || card.filePath
      card.originalPath = card.filePath
      if (input.type) card.type = input.type
      if (input.w !== undefined && input.h !== undefined) {
        card.w = input.w
        card.h = input.h
      }
      if (input.meta) card.meta = { ...card.meta, ...input.meta }

      // 文件落在某个分区文件夹内就归该分区（与拖入 / 粘贴同规则）
      const fileDir = dirnameOf(input.absolutePath)
      const partition = useBoardStore
        .getState()
        .partitions.find((item) => item.folderPath === relativePathOf(fileDir, space.folderPath))

      const dest: DropDestination = {
        destDir: fileDir,
        partitionId: partition?.id ?? null,
        groupName: partition?.name ?? null,
      }
      if (partition) card.group = partition.name

      // undoable === false（插件现画的二进制文件）→ 只加卡不入撤销栈：
      // 撤销会删掉命令记录的文件，而 redo 没有源文件可重新复制（见 plugin/types.ts）
      if (input.undoable === false) {
        useBoardStore.getState().addCards([card])
        deps.writer.schedule()
      } else {
        // createdFiles 传空：文件是插件写的，不属于本次命令，undo 不该删它
        await deps.commitIngestedCards([card], [], [{ src: '', destDir: fileDir }], dest)
      }
      return true
    },

    createCard: async (input) => {
      const space = useSpacesStore.getState().getCurrentSpace()
      if (!space || useBoardStore.getState().readOnly) return null

      // 插件给定的落点优先；没给就放视口中心（画布没挂载则放弃）
      const point =
        input.x !== undefined && input.y !== undefined
          ? { x: input.x, y: input.y }
          : deps.viewportCenterCanvasPoint()
      if (!point) return null

      // 同新建便签：filePath 空串占位（无文件卡），undo 只删卡，天然可撤销
      const card = zCardSchema.parse({
        id: nextCardId(usedCardIds()),
        type: input.type,
        filePath: '',
        originalPath: '',
        x: Math.round(point.x),
        y: Math.round(point.y),
        w: input.w ?? DEFAULT_PLAIN_CARD_SIZE.w,
        h: input.h ?? DEFAULT_PLAIN_CARD_SIZE.h,
        ...(input.meta ? { meta: input.meta } : {}),
      })

      await deps.history.execute(
        createAddCardsCommand(
          { cards: [card], createdFiles: [], sources: [] },
          {
            provider: localStorageProvider,
            applyAdd: (cards) => useBoardStore.getState().addCards(cards),
            applyRemove: (ids) => useBoardStore.getState().removeCardsLocally(ids),
          },
        ),
      )
      deps.writer.schedule()
      return card.id
    },

    updateCardContent: async (input) => {
      const snapshot = useBoardStore.getState()
      if (snapshot.readOnly) return false
      const card = snapshot.cards.find((item) => item.id === input.cardId)
      if (!card) return false

      await deps.history.execute(
        createUpdateCardContentCommand(
          {
            id: input.cardId,
            width: card.w,
            fromMeta: { ...card.meta },
            toMeta: input.meta,
            fromH: card.h,
            toH: input.h ?? card.h,
          },
          {
            meta: (id, meta) => useBoardStore.getState().setCardMeta(id, meta),
            sizes: (sizes) => useBoardStore.getState().setCardSizes(sizes),
          },
        ),
      )
      deps.writer.schedule()
      return true
    },
  }
}
