// ============================================================================
// 模块说明（中文）
// 工具栏注册中心。对应开发计划书第十三章「准备 2」与「准备 3」：
// 工具栏同样由配置数组生成，插件通过 pluginCenter.registerToolbarItem 追加按钮。
//
// 本文件提供：
//   1. CORE_TOOLBAR_ITEMS —— 核心工具栏配置（仅收录文档明确提到的按钮）
//   2. buildToolbarItems() —— 聚合：核心项在前 + 插件项在后 + 同名去重
//
// 核心项来源依据（不发明文档没有的按钮）：
//   · 「显示已移除」—— 7.2 明确写"点击工具栏『显示已移除』"
//   · 「撤销 / 重做」—— 7.4 规格（快捷键 Ctrl+Z / Ctrl+Shift+Z，工具栏通常同时提供入口）
//   · 「复原视图 / 适应全部」—— 5.3 快捷键表 Ctrl+0 / Ctrl+1
//
// 动作同样转交 actionRegistry，准备层只摆按钮不写业务（见该文件说明）。
//
// 实现任务：T0.10（准备层）。
// ============================================================================

import type { ToolbarItemDef } from './pluginCenter'
import { listRegisteredToolbarItems } from './pluginCenter'
import { runAction } from './actionRegistry'

/** 工具栏分组：编辑类（左）/ 视图类（右） */
export type ToolbarGroup = 'edit' | 'view'

/** 核心工具栏项：在 17.8 的 ToolbarItemDef 之上补充分组与快捷键提示 */
export interface CoreToolbarItem extends ToolbarItemDef {
  group: ToolbarGroup
  /** 快捷键提示文案，仅用于 UI 展示（真正的按键绑定在阶段一统一处理） */
  shortcut?: string
}

export const TOOLBAR_ACTION = {
  undo: 'toolbar.undo',
  redo: 'toolbar.redo',
  resetZoom: 'toolbar.resetZoom',
  zoomToFit: 'toolbar.zoomToFit',
  showRemoved: 'toolbar.showRemoved',
} as const

export const CORE_TOOLBAR_ITEMS: CoreToolbarItem[] = [
  {
    id: TOOLBAR_ACTION.undo,
    label: '撤销',
    icon: 'undo',
    group: 'edit',
    shortcut: 'Ctrl+Z',
    action: () => runAction(TOOLBAR_ACTION.undo, '撤销'),
  },
  {
    id: TOOLBAR_ACTION.redo,
    label: '重做',
    icon: 'redo',
    group: 'edit',
    shortcut: 'Ctrl+Shift+Z',
    action: () => runAction(TOOLBAR_ACTION.redo, '重做'),
  },
  {
    id: TOOLBAR_ACTION.resetZoom,
    label: '复原视图',
    icon: 'maximize-2',
    group: 'view',
    shortcut: 'Ctrl+0',
    action: () => runAction(TOOLBAR_ACTION.resetZoom, '复原视图'),
  },
  {
    id: TOOLBAR_ACTION.zoomToFit,
    label: '适应全部',
    icon: 'scan',
    group: 'view',
    shortcut: 'Ctrl+1',
    action: () => runAction(TOOLBAR_ACTION.zoomToFit, '适应全部'),
  },
  {
    id: TOOLBAR_ACTION.showRemoved,
    label: '显示已移除',
    icon: 'eye',
    group: 'view',
    action: () => runAction(TOOLBAR_ACTION.showRemoved, '显示已移除'),
  },
]

/**
 * 取最终工具栏项：核心项（按配置顺序）+ 插件项（按注册顺序）。
 * 插件若注册与核心同 id 的项则忽略（核心优先）。
 */
export function buildToolbarItems(): ToolbarItemDef[] {
  const coreIds = new Set(CORE_TOOLBAR_ITEMS.map((item) => item.id))
  const plugin = listRegisteredToolbarItems().filter((item) => {
    if (coreIds.has(item.id)) {
      console.warn(`[toolbar] 插件工具栏项「${item.id}」与核心同名，已忽略插件版本。`)
      return false
    }
    return true
  })
  return [...CORE_TOOLBAR_ITEMS, ...plugin]
}

/** 按分组取核心工具栏项（UI 布局用） */
export function listCoreToolbarItemsByGroup(group: ToolbarGroup): CoreToolbarItem[] {
  return CORE_TOOLBAR_ITEMS.filter((item) => item.group === group)
}
