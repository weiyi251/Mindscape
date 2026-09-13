// ============================================================================
// 模块说明（中文）
// 插件生命周期判定的**纯函数层**（方案 §2.3 六态状态机）。
//
// 为什么单独成文件：设置页的按钮可用性、主开关文案、禁用/卸载的拦截提示
// 全都要问同样几个问题（能不能启用 / 能不能卸载）。把这些判定从组件里抽出来，
// 一来可以在 node 环境直接单测（本项目不引入 jsdom），二来组件只剩渲染。
//
// 与 pluginHost 的分工：本文件只回答「允不允许」，真正的动作在 pluginHost。
// ============================================================================

import type { PluginContributions, PluginRecord, PluginState } from './types'

/** 是否处于「已启用」状态（注册已生效） */
export function isActive(state: PluginState): boolean {
  return state === 'active'
}

/**
 * 能否启用。
 * 可重试 error（上次激活抛错的插件，用户修好文件后点「重试」）；
 * invalid 不可启用（清单就不过关）；active 已是启用态。
 */
export function canEnable(plugin: PluginRecord): boolean {
  return plugin.state === 'installed' || plugin.state === 'inactive' || plugin.state === 'error'
}

/** 能否停用 */
export function canDisable(plugin: PluginRecord): boolean {
  return plugin.state === 'active'
}

/**
 * 能否卸载。
 * 内置插件随应用打包，卸载无从谈起（只能禁用）——方案 §1 的边界。
 */
export function canUninstall(plugin: PluginRecord): boolean {
  return plugin.source === 'external'
}

/**
 * 能否「重新加载」（外部插件专属）。
 * 语义：重新读取安装目录里的 manifest.json 与入口文件（用户替换文件后点它生效）。
 * 内置插件的版本随应用走，故返回 false。
 */
export function canReload(plugin: PluginRecord): boolean {
  return plugin.source === 'external'
}

/** 主开关按钮文案（不可用时由 UI 置灰，文案仍要正确） */
export function toggleLabel(plugin: PluginRecord): string {
  return isActive(plugin.state) ? '停用' : '启用'
}

/** 是否处在需要用户关注的异常状态 */
export function isProblematic(state: PluginState): boolean {
  return state === 'invalid' || state === 'error'
}

/** 贡献摘要是否为空（设置页「此插件未注册任何卡片类型 / 菜单」判断） */
export function hasNoContributions(contributions: PluginContributions): boolean {
  return (
    contributions.cardTypes === 0 &&
    contributions.menuItems === 0 &&
    contributions.canvasMenuItems === 0 &&
    contributions.toolbarItems === 0 &&
    contributions.hooks === 0
  )
}
