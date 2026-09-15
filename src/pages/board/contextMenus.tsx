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
import { UNCLASSIFIED_DIR } from '@/core/board/ingest'
import {
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
  /** 「移动到…」：展开二级文件夹选择菜单（2026-09-12 用户裁决） */
  onMove: (card: Card, screen: ScreenPoint) => void
  /** 「恢复」：把选中的卡片从「已移除」视图恢复 */
  onRestore: (ids: string[]) => void
}

/** 组装卡片右键菜单（配置中心项 + 已移除视图下的「恢复」项） */
export function buildCardMenuItems(params: CardMenuParams): ContextMenuItemData[] {
  const { card, screen, spacePath, removedView, selectedIds, onMove, onRestore } = params
  const ctx = { spacePath, card }
  const items: ContextMenuItemData[] = buildCardMenuFor(card).map((item) => ({
    id: item.id,
    label: item.label,
    danger: item.id === CARD_ACTION.remove,
    // 「移动到…」不走配置中心的 action，改为展开二级菜单
    run: item.id === CARD_ACTION.move ? () => onMove(card, screen) : () => item.action(ctx),
  }))

  // 「恢复」（2026-09-13 用户裁决）：原来挂在顶栏的可折叠工具栏上，
  // 取消工具栏后并入右键菜单；右键的卡片若在选中集合里就整批恢复
  if (removedView) {
    const targets = selectedIds.includes(card.id) ? selectedIds : [card.id]
    items.unshift({
      id: 'card.restore',
      label: targets.length > 1 ? `恢复选中的 ${targets.length} 张卡片` : '恢复此卡片',
      icon: <RestoreIcon />,
      separatorBefore: true,
      run: () => onRestore(targets),
    })
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
 * 组装「移动到…」二级文件夹菜单。
 * 「未分类」= 空间主目录（2026-09-13 用户裁决：不再是物理「未分类」文件夹）：
 * 文件已在根目录时跳过（移到原地没有意义）；旧版留在 `未分类\` 里的文件
 * 也会列出这一项 —— 用户点它即把文件移出旧文件夹、回到空间主目录。
 */
export function buildCardMoveItems(params: {
  partitions: Partition[]
  /** 卡片当前所在的最上层文件夹（相对空间根） */
  currentFolder: string
  onMove: (
    targetFolderRel: string,
    groupName: string | undefined,
    partition: Partition | null,
  ) => void
}): ContextMenuItemData[] {
  const { partitions, currentFolder, onMove } = params
  return [
    ...(currentFolder !== ''
      ? [
          {
            id: `${CARD_ACTION.move}:unclassified`,
            label: UNCLASSIFIED_DIR,
            run: () => onMove('', undefined, null),
          },
        ]
      : []),
    // 卡片当前所在分区不列（no-op）；其余分区按画布顺序列出
    ...partitions
      .filter((partition) => partition.folderPath !== currentFolder)
      .map((partition) => ({
        id: `${CARD_ACTION.move}:${partition.id}`,
        label: partition.name,
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
      run: () => item.action({ spacePath }),
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
