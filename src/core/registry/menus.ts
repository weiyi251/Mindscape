// ============================================================================
// 模块说明（中文）
// 菜单配置中心。对应开发计划书第十三章「准备 3：工具栏 / 右键菜单『配置驱动』」。
//
// 核心思想：菜单由**配置数组**生成，不写死在 UI 里。插件通过
// pluginCenter.registerMenuItem 追加自己的项，自动出现在菜单末尾。
//
// 本文件提供三样东西：
//   1. CORE_CARD_MENU_ITEMS      —— 核心卡片右键菜单配置（对应 5.2 的菜单清单）
//   2. CORE_PARTITION_MENU_ITEMS —— 核心分区框菜单配置（对应第六章的可重命名 / 可折叠 / 颜色）
//   3. buildCardMenuFor / buildPartitionMenuFor —— 聚合函数：
//      按目标过滤核心项（appliesTo）+ 追加插件项 + id 去重，产出最终菜单数组。
//
// 设计取舍（已与用户确认）：
//   · 卡片菜单**共用一组配置**，靠 appliesTo 按卡片类型过滤，
//     而不是每种卡片类型各维护一份数组 —— 避免同一动作在 N 个数组里重复定义。
//   · 菜单项的 action 不在本文件写业务，而是转交 actionRegistry（见该文件说明）。
//
// 实现任务：T0.10（准备层）。
// ⚠️ 本文件早已接线投产：Board 的右键菜单直接调用 buildCardMenuFor / buildPartitionMenuFor。
// ============================================================================

import type { Card, Partition } from '@/core/types'
import type { MenuContext, MenuItem } from './pluginCenter'
import { getPluginMenuItemsForCard } from './pluginCenter'
import { runAction } from './actionRegistry'

// ---------------------------------------------------------------------------
// 核心卡片菜单（5.2「卡片右键菜单」）
// ---------------------------------------------------------------------------

/** 核心卡片菜单项的动作 id 常量（供 actionRegistry 登记时引用，杜绝拼写错） */
export const CARD_ACTION = {
  openOriginal: 'card.openOriginal',
  remove: 'card.remove',
  bringToFront: 'card.bringToFront',
  sendToBack: 'card.sendToBack',
  addNote: 'card.addNote',
  editLabel: 'card.editLabel',
  connect: 'card.connect',
  copy: 'card.copy',
  /** 移动到…（2026-09-12 用户裁决：画布内切换卡片文件所属的文件夹） */
  move: 'card.move',
} as const

/**
 * 核心卡片菜单配置。
 * 顺序即 UI 显示顺序；是否显示由 appliesTo 决定（不写 appliesTo = 对所有卡片显示）。
 */
export const CORE_CARD_MENU_ITEMS: MenuItem[] = [
  {
    id: CARD_ACTION.openOriginal,
    label: '打开原图',
    // 5.2 / 第九章：图片卡片打开原图；其余类型由「双击 → 系统默认程序打开」承担
    appliesTo: (card) => card.type === 'image',
    action: (ctx) => runAction(CARD_ACTION.openOriginal, '打开原图', ctx),
  },
  {
    id: CARD_ACTION.remove,
    label: '移除',
    // 7.1：默认操作，仅移入 `_已移除`，文件仍在硬盘（永远不提供永久删除，见 7.3）
    action: (ctx) => runAction(CARD_ACTION.remove, '移除', ctx),
  },
  {
    id: CARD_ACTION.bringToFront,
    label: '置顶',
    action: (ctx) => runAction(CARD_ACTION.bringToFront, '置顶', ctx),
  },
  {
    id: CARD_ACTION.sendToBack,
    label: '置底',
    action: (ctx) => runAction(CARD_ACTION.sendToBack, '置底', ctx),
  },
  {
    id: CARD_ACTION.addNote,
    label: '加备注',
    action: (ctx) => runAction(CARD_ACTION.addNote, '加备注', ctx),
  },
  {
    id: CARD_ACTION.editLabel,
    label: '编辑标签',
    action: (ctx) => runAction(CARD_ACTION.editLabel, '编辑标签', ctx),
  },
  {
    id: CARD_ACTION.connect,
    label: '连线',
    action: (ctx) => runAction(CARD_ACTION.connect, '连线', ctx),
  },
  {
    // 2026-09-11 用户裁决「所有类型的卡片都支持复制与粘贴」：
    // 图片 / 文件复制硬盘原件（保留原始清晰度），便签克隆文字内容；
    // 随后可粘贴到同空间其他分区或位置（Ctrl+C / Ctrl+V 同效）
    id: CARD_ACTION.copy,
    label: '复制',
    action: (ctx) => runAction(CARD_ACTION.copy, '复制', ctx),
  },
  {
    // 2026-09-12 用户裁决「在画布中切换图片所在文件夹」：
    // 有硬盘文件的卡片（图片 / 文件）才谈得上「换文件夹」；便签没有文件，不显示。
    // 点击后弹出二级菜单列出全部分区与 `未分类`，物理移动文件 + 同步画布。
    id: CARD_ACTION.move,
    label: '移动到…',
    appliesTo: (card) => card.filePath !== '',
    action: (ctx) => runAction(CARD_ACTION.move, '移动到…', ctx),
  },
]

// ---------------------------------------------------------------------------
// 核心分区框菜单（第六章）
// ---------------------------------------------------------------------------

/**
 * 分区框菜单项类型。
 * 注意：17.8 只定义了卡片菜单接口（appliesTo 收 Card），分区框菜单是核心内部能力，
 * 因此这里单独定义 `appliesToPartition`，不复用卡片的 appliesTo。
 */
export interface PartitionMenuItem {
  id: string
  label: string
  appliesToPartition?: (partition: Partition) => boolean
  action: (ctx: MenuContext) => void
}

export const PARTITION_ACTION = {
  rename: 'partition.rename',
  toggleCollapse: 'partition.toggleCollapse',
  setColor: 'partition.setColor',
  paste: 'partition.paste',
} as const

export const CORE_PARTITION_MENU_ITEMS: PartitionMenuItem[] = [
  {
    id: PARTITION_ACTION.paste,
    label: '粘贴',
    // 2026-09-11 用户裁决：把已复制的卡片粘贴进该分区（图片/文件拷贝原件，便签克隆文字）。
    // 是否显示（应用内剪贴板是否为空）由上层过滤
    action: (ctx) => runAction(PARTITION_ACTION.paste, '粘贴', ctx),
  },
  {
    id: PARTITION_ACTION.rename,
    label: '重命名分区',
    // 第六章：同时修改硬盘文件夹名，须走「非法字符 / 同名冲突 / 占用检测 / 确认框」四步保护
    action: (ctx) => runAction(PARTITION_ACTION.rename, '重命名分区', ctx),
  },
  {
    id: PARTITION_ACTION.toggleCollapse,
    label: '折叠 / 展开',
    action: (ctx) => runAction(PARTITION_ACTION.toggleCollapse, '折叠 / 展开', ctx),
  },
  {
    id: PARTITION_ACTION.setColor,
    label: '指定颜色',
    action: (ctx) => runAction(PARTITION_ACTION.setColor, '指定颜色', ctx),
  },
]

// ---------------------------------------------------------------------------
// 核心连线菜单（断开连接 / 编辑标签；2026-09-11 用户裁决：连线可断开）
// ---------------------------------------------------------------------------

export const CONNECTION_ACTION = {
  editLabel: 'connection.editLabel',
  remove: 'connection.remove',
} as const

/** 连线菜单项类型（无需 appliesTo —— 连线目前只有一种） */
export interface ConnectionMenuItem {
  id: string
  label: string
  action: (ctx: MenuContext) => void
}

export const CORE_CONNECTION_MENU_ITEMS: ConnectionMenuItem[] = [
  {
    id: CONNECTION_ACTION.editLabel,
    label: '编辑标签',
    action: (ctx) => runAction(CONNECTION_ACTION.editLabel, '编辑标签', ctx),
  },
  {
    id: CONNECTION_ACTION.remove,
    label: '删除连线',
    action: (ctx) => runAction(CONNECTION_ACTION.remove, '删除连线', ctx),
  },
]

/** 取某条连线最终应显示的菜单项（与卡片 / 分区同风格：核心配置 → 聚合函数） */
export function buildConnectionMenuFor(): ConnectionMenuItem[] {
  return [...CORE_CONNECTION_MENU_ITEMS]
}

// ---------------------------------------------------------------------------
// 聚合：产出最终菜单数组
// ---------------------------------------------------------------------------

/**
 * 取某张卡片最终应显示的菜单项。
 * 顺序：核心项（按配置顺序）→ 插件项（按注册顺序）。
 * 若插件注册了与核心同 id 的项，保留核心并提示（核心优先，防止插件覆盖核心行为）。
 */
export function buildCardMenuFor(card: Card): MenuItem[] {
  const core = CORE_CARD_MENU_ITEMS.filter((item) => !item.appliesTo || item.appliesTo(card))
  const coreIds = new Set(core.map((item) => item.id))

  const plugin = getPluginMenuItemsForCard(card).filter((item) => {
    if (coreIds.has(item.id)) {
      console.warn(`[menus] 插件菜单项「${item.id}」与核心菜单项同名，已忽略插件版本。`)
      return false
    }
    return true
  })

  return [...core, ...plugin]
}

/** 取某个分区框最终应显示的菜单项（核心项 + 过滤；插件暂不支持分区菜单） */
export function buildPartitionMenuFor(partition: Partition): PartitionMenuItem[] {
  return CORE_PARTITION_MENU_ITEMS.filter(
    (item) => !item.appliesToPartition || item.appliesToPartition(partition),
  )
}
