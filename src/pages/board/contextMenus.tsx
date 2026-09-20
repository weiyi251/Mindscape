// ============================================================================
// 模块说明（中文）
// 画布右键菜单的**组装层**：把「配置中心的菜单项」+「当前上下文」翻译成
// 渲染层直接消费的 ContextMenuItemData[]。
//
// 为什么单独成文件：Board.tsx 是全项目最大的文件，插件期还要往里埋钩子
// （见 docs/插件功能实施方案.md §7 的硬前置）。菜单组装是其中最独立的一块。
//
// 设计约束：**纯函数** —— 不读 store、不碰 history/writer，所有副作用
// （移动 / 恢复 / 撤销 / 打开二级菜单）一律以回调注入。因此可在 node 环境
// 直接单测（本项目不引入 jsdom，用户裁决），不需要渲染任何 UI。
//
// 菜单项本身永远来自 core/registry/menus.ts 的配置中心，这里只做「配置项 →
// 带回调的渲染项」的翻译，**不硬编码任何菜单文案**（文案改配置中心一处即可）。
// ============================================================================

import type { ContextMenuItemData } from '@/components/ui/context-menu'
import { FolderAddIcon, NoteAddIcon, RedoIcon, RestoreIcon, UndoIcon } from '@/components/ui/icons'
import { PARTITION_PALETTE } from '@/core/board/partitions'
import { NOTE_PALETTE } from '@/core/board/noteColors'
import { lockedOfMeta } from '@/core/board/cardMeta'
import { UNCLASSIFIED_DIR } from '@/core/board/ingest'
import { ALIGN_MODES, canDistribute, DISTRIBUTE_MODES } from '@/core/geometry/align'
import type { AlignItem, AlignOperation } from '@/core/geometry/align'
import {
  ALIGN_OPERATION_LABELS,
  buildCardMenuFor,
  buildConnectionMenuFor,
  buildPartitionMenuFor,
  CARD_ACTION,
  CONNECTION_ACTION,
  PARTITION_ACTION,
} from '@/core/registry/menus'
import { formatCombo } from '@/core/shortcuts/keys'
import type { ShortcutId } from '@/core/shortcuts/keys'
import { listRegisteredCanvasMenuItems } from '@/core/registry/pluginCenter'
import { useShortcutsStore } from '@/core/store/shortcutsStore'
import type { Card, Connection, Partition } from '@/core/types'

/** 屏幕（窗口内）坐标点 */
export interface ScreenPoint {
  x: number
  y: number
}

/**
 * 右键菜单里的操作名带上当前快捷键（如「撤销（Ctrl+Z）」）。
 * 同步读 store 的当前绑定 —— 菜单是「点开时才组装」的，因此改绑后立刻反映，
 * 不需要为它挂 React 订阅。
 */
export function withShortcutLabel(text: string, id: ShortcutId): string {
  return `${text}（${formatCombo(useShortcutsStore.getState().bindings[id])}）`
}

// ---------------------------------------------------------------------------
// 卡片菜单
// ---------------------------------------------------------------------------

export interface CardMenuParams {
  card: Card
  screen: ScreenPoint
  /** 当前空间文件夹绝对路径（配置中心的部分 action 需要它） */
  spacePath: string
  removedView: boolean
  selectedIds: string[]
  /** 选中集合对应的卡片对象（多选批量移动需要 Card，2026-09-20） */
  selectedCards: Card[]
  /** 「移动到…」：展开二级文件夹选择菜单（2026-09-12 用户裁决；2026-09-20 支持批量） */
  onMove: (cards: Card[], screen: ScreenPoint) => void
  /** 「恢复」：把选中的卡片从「已移除」视图恢复 */
  onRestore: (ids: string[]) => void
  /** 「便签颜色…」：展开二级色板菜单（2026-09-15 用户需求） */
  onSetColor: (card: Card, screen: ScreenPoint) => void
  /** 「重命名文件」：弹输入浮层（2026-09-15 用户需求） */
  onRenameFile: (card: Card) => void
  /** 「彻底删除」：真删硬盘文件（仅已移除视图，2026-09-15 用户需求） */
  onDeleteForever: (ids: string[]) => void
  /**
   * 「对齐与分布…」：展开二级菜单（2026-09-20 用户计划 C3）。
   * targets 是本动作应作用的卡片集合（右键卡不在选中集合、或选中不足 2 张时该项不显示）。
   */
  onAlign: (targets: Card[], screen: ScreenPoint) => void
}

/** 组装卡片右键菜单（配置中心项 + 已移除视图下的「恢复 / 彻底删除」项） */
export function buildCardMenuItems(params: CardMenuParams): ContextMenuItemData[] {
  const { card, screen, spacePath, removedView, selectedIds, selectedCards, onMove, onRestore, onSetColor, onRenameFile, onDeleteForever, onAlign } = params
  const ctx = { spacePath, card }
  // 右键的卡片若在选中集合里 → 整批操作（2026-09-20 多选批量移动）；
  // 需要 Card 对象，故按 id 从调用方给的 selectedCards 里取（没有就退回单卡）
  const moveTargets =
    selectedIds.includes(card.id) && selectedCards.length > 1
      ? selectedCards.filter((item) => selectedIds.includes(item.id) || item.id === card.id)
      : [card]
  // 对齐与分布（2026-09-20 用户计划 C3）作用范围与批量移动同源，但至少 2 张才有意义；
  // 不足 2 张时该项直接从菜单里消失 —— 配置数组的 appliesTo 只收单张 Card，拿不到选中数
  const alignTargets = moveTargets.length > 1 ? moveTargets : []
  const items: ContextMenuItemData[] = buildCardMenuFor(card).map((item) => ({
    id: item.id,
    // 「锁定卡片」「移动到…」的标签随状态翻转（配置数组是静态的，拿不到卡片状态）
    label:
      item.id === CARD_ACTION.toggleLock
        ? lockedOfMeta(card.meta)
          ? '解锁卡片'
          : '锁定卡片'
        : item.id === CARD_ACTION.move && moveTargets.length > 1
          ? `移动 ${moveTargets.length} 张到…`
          : item.label,
    danger: item.id === CARD_ACTION.remove,
    // 「移动到…」「便签颜色…」「重命名文件」「对齐与分布…」不走配置中心的 action，
    // 改为展开二级菜单 / 弹浮层
    run:
      item.id === CARD_ACTION.move
        ? () => onMove(moveTargets, screen)
        : item.id === CARD_ACTION.setColor
          ? () => onSetColor(card, screen)
          : item.id === CARD_ACTION.renameFile
            ? () => onRenameFile(card)
            : item.id === CARD_ACTION.align
              ? () => onAlign(alignTargets, screen)
              : () => item.action(ctx),
  })).filter(
    // 已移除视图下不显示「重命名文件」：恢复入口才是主操作，改名容易与
    // 「恢复后再整理」的正常动线混淆（remove / move 不受此限，沿用既有行为）；
    // 「对齐与分布…」只对多选有意义（见上）
    (item) =>
      !(removedView && item.id === CARD_ACTION.renameFile) &&
      !(item.id === CARD_ACTION.align && alignTargets.length < 2),
  )

  // 「恢复」（2026-09-13 用户裁决）与「彻底删除」（2026-09-15 用户需求）：
  // 都只在已移除视图显示；右键的卡片若在选中集合里就整批操作。
  // 彻底删除排在「恢复」之后（次选动作，danger 标红，走原生确认框）
  if (removedView) {
    const targets = selectedIds.includes(card.id) ? selectedIds : [card.id]
    items.unshift(
      {
        id: 'card.restore',
        label: targets.length > 1 ? `恢复选中的 ${targets.length} 张卡片` : '恢复此卡片',
        icon: <RestoreIcon />,
        separatorBefore: true,
        run: () => onRestore(targets),
      },
      {
        id: 'card.deleteForever',
        label: targets.length > 1 ? `彻底删除选中的 ${targets.length} 个文件` : '彻底删除此文件',
        danger: true,
        run: () => onDeleteForever(targets),
      },
    )
  }

  return items
}

// ---------------------------------------------------------------------------
// 分区菜单
// ---------------------------------------------------------------------------

export interface PartitionMenuParams {
  partition: Partition
  screen: ScreenPoint
  spacePath: string
  /** 应用内剪贴板非空时才有「粘贴」项 */
  hasCopiedCards: boolean
  /** 「指定颜色」：展开二级色板菜单 */
  onSetColor: (partitionId: string, screen: ScreenPoint) => void
}

/** 组装分区框右键菜单 */
export function buildPartitionMenuItems(params: PartitionMenuParams): ContextMenuItemData[] {
  const { partition, screen, spacePath, hasCopiedCards, onSetColor } = params
  const ctx = { spacePath, partition }
  return (
    buildPartitionMenuFor(partition)
      // 「粘贴」只在应用内剪贴板非空时显示
      .filter((item) => item.id !== PARTITION_ACTION.paste || hasCopiedCards)
      .map((item) => ({
        id: item.id,
        label: item.label,
        // 「指定颜色」不走配置中心的 action，改为展开二级色板
        run:
          item.id === PARTITION_ACTION.setColor
            ? () => onSetColor(partition.id, screen)
            : () => item.action(ctx),
      }))
  )
}

/** 组装「指定颜色」二级色板菜单（首项为「自动」） */
export function buildPartitionColorItems(onPick: (color: string) => void): ContextMenuItemData[] {
  return [
    {
      id: `${PARTITION_ACTION.setColor}:auto`,
      label: '自动（8 色轮换）',
      run: () => onPick('auto'),
    },
    ...PARTITION_PALETTE.map((colorKey, index) => ({
      id: `${PARTITION_ACTION.setColor}:${colorKey}`,
      label: `颜色 ${index + 1}`,
      swatch: colorKey,
      run: () => onPick(colorKey),
    })),
  ]
}

/**
 * 组装「便签颜色…」二级色板菜单（2026-09-15 用户需求；首项为「默认便签纸」）。
 * 色板来自 core/board/noteColors 的 NOTE_PALETTE；首项传 null 表示回到
 * 默认便签纸（meta.noteColor 删键，见 metaWithNoteColor）。
 */
export function buildNoteColorItems(onPick: (color: string | null) => void): ContextMenuItemData[] {
  return [
    {
      id: `${CARD_ACTION.setColor}:default`,
      label: '默认便签纸',
      run: () => onPick(null),
    },
    ...NOTE_PALETTE.map((color, index) => ({
      id: `${CARD_ACTION.setColor}:${color}`,
      label: `颜色 ${index + 1}`,
      swatch: color,
      run: () => onPick(color),
    })),
  ]
}

/**
 * 组装「对齐与分布」二级菜单（2026-09-20 用户计划 C3）。
 *
 * 8 个操作分三组：横向对齐（左 / 水平居中 / 右）→ 纵向对齐（上 / 垂直居中 / 下）→
 * 等距分布（水平 / 垂直），组间画分隔线。文案统一来自配置中心的 ALIGN_OPERATION_LABELS。
 *
 * 分布需要至少 3 张**未锁定**卡（锁定卡不参与分布，理由见 core/geometry/align.ts），
 * 不满足时整组隐藏 —— 与「粘贴仅在有剪贴板内容时出现」同一处理，不摆灰项。
 * 几何计算与实际执行都不在这里（见 core/geometry/align.ts 与 alignCardsFlow.ts），
 * 本函数只负责「把操作翻成可点的菜单项」。
 */
export function buildAlignItems(params: {
  items: AlignItem[]
  onPick: (operation: AlignOperation) => void
}): ContextMenuItemData[] {
  const { items, onPick } = params
  const operations: AlignOperation[] = [
    ...ALIGN_MODES.slice(0, 3),
    ...ALIGN_MODES.slice(3),
    ...(canDistribute(items) ? DISTRIBUTE_MODES : []),
  ]
  // 纵向组首项与分布组首项之前各画一条分隔线
  const separatorIds = new Set<AlignOperation>([ALIGN_MODES[3], DISTRIBUTE_MODES[0]])

  return operations.map((operation) => ({
    id: `${CARD_ACTION.align}:${operation}`,
    label: ALIGN_OPERATION_LABELS[operation],
    separatorBefore: separatorIds.has(operation),
    run: () => onPick(operation),
  }))
}

/**
 * 组装「移动到…」二级文件夹菜单。
 * 「未分类」= 空间主目录（2026-09-13 用户裁决：不再是物理「未分类」文件夹）：
 * 文件已在根目录时跳过（移到原地没有意义）；旧版留在 `未分类\` 里的文件
 * 也会列出这一项 —— 用户点它即把文件移出旧文件夹、回到空间主目录。
 */
export function buildCardMoveItems(params: {
  partitions: Partition[]
  /** 卡片当前所在的最上层文件夹（相对空间根）；多卡时只在「全部同目录」时才给 */
  currentFolder: string
  /** 多选批量移动时的张数（>1 时菜单项标注「移到 N 张」，2026-09-20） */
  countLabel?: number
  onMove: (
    targetFolderRel: string,
    groupName: string | undefined,
    partition: Partition | null,
  ) => void
}): ContextMenuItemData[] {
  const { partitions, currentFolder, countLabel, onMove } = params
  // 批量时在名字后标注张数：「移动到『旅行』（3 张）」，避免歧义
  const withCount = (name: string) => (countLabel ? `${name}（${countLabel} 张）` : name)
  return [
    ...(currentFolder !== ''
      ? [
          {
            id: `${CARD_ACTION.move}:unclassified`,
            label: withCount(UNCLASSIFIED_DIR),
            run: () => onMove('', undefined, null),
          },
        ]
      : []),
    // 卡片当前所在分区不列（no-op）；其余分区按画布顺序列出
    ...partitions
      .filter((partition) => partition.folderPath !== currentFolder)
      .map((partition) => ({
        id: `${CARD_ACTION.move}:${partition.id}`,
        label: withCount(partition.name),
        run: () => onMove(partition.folderPath, partition.name, partition),
      })),
  ]
}

// ---------------------------------------------------------------------------
// 连线菜单
// ---------------------------------------------------------------------------

export interface ConnectionMenuParams {
  connection: Connection
  spacePath: string
}

/** 组装连线右键菜单（编辑标签 / 删除连线） */
export function buildConnectionMenuItems(params: ConnectionMenuParams): ContextMenuItemData[] {
  const { connection, spacePath } = params
  const ctx = { spacePath, connection }
  return buildConnectionMenuFor().map((item) => ({
    id: item.id,
    label: item.label,
    danger: item.id === CONNECTION_ACTION.remove,
    run: () => item.action(ctx),
  }))
}

// ---------------------------------------------------------------------------
// 画布空白菜单
// ---------------------------------------------------------------------------

export interface CanvasMenuParams {
  /** 右键位置（画布坐标），新建便签按它定位 */
  canvasPoint: ScreenPoint
  /** 当前空间文件夹绝对路径（插件菜单项的 action 需要它决定默认输出位置等） */
  spacePath: string
  hasCopiedCards: boolean
  onCreateNote: (x: number, y: number) => void
  /**
   * 「新建分区」（2026-09-14 用户要求：空间内直接创建分区）。
   * 传画布坐标（作为新框中心与落点依据），命名浮层与建目录在 Board 侧完成。
   */
  onCreatePartition: (point: ScreenPoint) => void
  /** 点在画布上的粘贴（落点由调用方按规则解析） */
  onPaste: (point: ScreenPoint) => void
  onUndo: () => void
  onRedo: () => void
}

/**
 * 组装画布空白右键菜单：新建便签 / 新建分区 / 粘贴 / 插件项 / 撤销 / 重做。
 * 撤销、重做是 2026-09-13 取消顶栏可折叠工具栏后并入的；它们与 CARD_ACTION 一样
 * 属于核心画布动作，键位标签取快捷键注册中心的当前绑定。
 *
 * 插件项（2026-09-14 新增扩展点，见 core/registry/pluginCenter 的 CanvasMenuItem）
 * 插在「创建类动作」与「撤销类动作」之间，**即时查表**：插件启用 / 停用后
 * 菜单立刻跟着变，不需要额外的失效通知（注册表版本号只是给重渲染用的）。
 * id 加 `plugin:` 前缀，避免与核心项（canvas.createNote 等）撞键。
 */
export function buildCanvasMenuItems(params: CanvasMenuParams): ContextMenuItemData[] {
  const {
    canvasPoint,
    spacePath,
    hasCopiedCards,
    onCreateNote,
    onCreatePartition,
    onPaste,
    onUndo,
    onRedo,
  } = params

  const pluginItems: ContextMenuItemData[] = listRegisteredCanvasMenuItems().map(
    (item, index) => ({
      id: `plugin:${item.id}`,
      label: item.label,
      separatorBefore: index === 0,
      run: () => item.action({ spacePath, canvasPoint }),
    }),
  )

  return [
    {
      id: 'canvas.createNote',
      label: '新建便签',
      icon: <NoteAddIcon />,
      run: () => onCreateNote(canvasPoint.x - 100, canvasPoint.y - 20),
    },
    // 2026-09-14 用户要求：在空间内直接创建分区（右键点即新框中心），
    // 并在对应空间文件夹下自动生成同名文件夹（命令与撤销见 createPartitionFlow.ts）
    {
      id: 'canvas.createPartition',
      label: '新建分区',
      icon: <FolderAddIcon />,
      run: () => onCreatePartition(canvasPoint),
    },
    // 应用内剪贴板非空时：空白处也可直接粘贴。
    // 2026-09-12：右键位置就是用户显式指定的落点 —— 点在哪个分区内就归哪个
    // 分区的文件夹，点在空白归空间主目录（2026-09-13 起「未分类」不再是文件夹）
    ...(hasCopiedCards
      ? [{ id: 'canvas.paste', label: '粘贴', run: () => onPaste(canvasPoint) }]
      : []),
    ...pluginItems,
    {
      id: 'canvas.undo',
      label: withShortcutLabel('撤销', 'edit.undo'),
      icon: <UndoIcon />,
      separatorBefore: true,
      run: onUndo,
    },
    {
      id: 'canvas.redo',
      label: withShortcutLabel('重做', 'edit.redo'),
      icon: <RedoIcon />,
      run: onRedo,
    },
  ]
}
