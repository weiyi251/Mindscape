// ============================================================================
// 模块说明（中文）
// 插件系统的中文文案常量与纯函数（状态标签、来源标签、贡献摘要行）。
//
// 单独成文件的原因与 settingsText.ts 相同：文案集中一处便于校对，
// 且组件文件只导出组件（满足 react-refresh 规则）；纯函数放这里可在
// node 环境直接单测。
// ============================================================================

import type { PluginContributions, PluginRecord, PluginSource, PluginState } from './types'

/** 插件页 / 插件详情的文案常量表 */
export const PLUGIN_TEXT = {
  /* 页面与区块标题 */
  pageTitle: '插件',
  pageHint: '插件可新增卡片类型、右键菜单项与画布菜单项。停用后立即从界面消失，卡片数据不受影响。',
  installedSection: '已安装',
  empty: '还没有发现任何插件',
  emptyExternalHint: '把插件文件夹放到插件目录后点「刷新」即可发现。',
  /* 区块按钮 */
  refresh: '刷新',
  openDir: '打开插件目录',
  /* 单行控件 */
  enable: '启用',
  disable: '停用',
  detail: '详情',
  uninstall: '卸载',
  reload: '重新加载',
  retry: '重试',
  /* 详情面板 */
  versionLabel: '版本',
  authorLabel: '作者',
  sourceLabel: '来源',
  stateLabel: '状态',
  pathLabel: '安装目录',
  contributionsLabel: '已注册内容',
  configLabel: '插件配置',
  noConfig: '此插件没有可配置项',
  noContributions: '此插件没有注册任何内容',
  /* 贡献种类 */
  contributeCardTypes: '卡片类型',
  contributeMenuItems: '卡片菜单项',
  contributeCanvasMenuItems: '画布菜单项',
  contributeToolbarItems: '工具栏项',
  contributeHooks: '生命周期钩子',
  /* 确认弹窗 */
  uninstallTitle: '卸载插件',
  uninstallMessage: (name: string) => `确定卸载「${name}」吗？会删除它的安装文件夹，插件数据（配置）将保留。`,
  disableTitle: '停用插件',
  disableMessage: (name: string) => `停用「${name}」后，它提供的卡片类型与菜单项会立即从界面消失（已有卡片数据不受影响）。`,
  /* 失败 */
  loadFailedTitle: '插件加载失败',
  actionFailedTitle: '操作失败',
  /* 其他 */
  builtinNotice: '内置插件随应用一起发布，只能停用，不能卸载。',
  externalVersionNote: (version: string) => `外部插件：把新版文件夹内容替换到安装目录后点「重新加载」，当前版本 ${version}。`,
  builtinVersionNote: (version: string) => `内置插件随应用更新，当前版本 ${version}。`,
} as const

/** 状态 → 中文标签 */
export function pluginStateLabel(state: PluginState): string {
  switch (state) {
    case 'discovered':
      return '待校验'
    case 'invalid':
      return '不可用'
    case 'installed':
      return '已安装'
    case 'active':
      return '已启用'
    case 'inactive':
      return '已停用'
    case 'error':
      return '出错'
    default:
      return '未知'
  }
}

/** 来源 → 中文标签 */
export function pluginSourceLabel(source: PluginSource): string {
  return source === 'builtin' ? '内置' : '外部'
}

/** 贡献摘要行，如「卡片类型 1 · 画布菜单项 1 · 生命周期钩子 1」 */
export function contributionsLine(contributions: PluginContributions): string {
  const parts: string[] = []
  const push = (count: number, label: string) => {
    if (count > 0) parts.push(`${label} ${count}`)
  }
  push(contributions.cardTypes, PLUGIN_TEXT.contributeCardTypes)
  push(contributions.menuItems, PLUGIN_TEXT.contributeMenuItems)
  push(contributions.canvasMenuItems, PLUGIN_TEXT.contributeCanvasMenuItems)
  push(contributions.toolbarItems, PLUGIN_TEXT.contributeToolbarItems)
  push(contributions.hooks, PLUGIN_TEXT.contributeHooks)
  return parts.join(' · ')
}

/** 列表行的副标题：`内置 · v1.0.0 · 已启用` */
export function pluginSubtitle(plugin: PluginRecord): string {
  return `${pluginSourceLabel(plugin.source)} · v${plugin.version} · ${pluginStateLabel(plugin.state)}`
}
