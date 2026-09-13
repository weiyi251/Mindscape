// ============================================================================
// 模块说明（中文）
// 设置面板的文案常量与纯函数（2026-09-12 建立，2026-09-13 扩展）。
//
// ⚠️ 单独成文件的原因：settings-panel.tsx 等是组件文件，react-refresh 规则要求
//   组件文件只导出组件；文案表与纯函数放这里，避免新增 lint warning。
//
// 2026-09-13 变化：面板改成「可拖动弹窗 + 分页」，主题切换与「显示已移除」搬去
// 顶栏图标按钮，因此这些文案的用途从「面板里的按钮」变为「顶栏按钮的 title」。
// ============================================================================

import type { UpdateStatus } from '@/core/store/updaterStore'

/** 设置弹窗的文案常量表（中文文案不散落在 JSX 里） */
export const SETTINGS_TEXT = {
  title: '设置',
  close: '关闭',
  /* 页面名（弹窗左侧页签；新增页面在这里加一条并注册到 SETTINGS_PAGES） */
  pageShortcuts: '自定义快捷键',
  pageUpdate: '版本更新',
  pagePlugins: '插件',
  /* 顶栏图标按钮的 title / aria-label */
  toLight: '切换到浅色模式',
  toDark: '切换到深色模式',
  removedShow: '显示已移除',
  removedBack: '返回画布',
  /* 版本更新页 */
  appearanceTitle: '外观与视图',
  updateTitle: '检查更新',
  currentVersion: '当前版本',
  latestVersion: '最新版本',
  checkNow: '检查更新',
  unknownVersion: '未知',
} as const

/** 「自定义快捷键」页的文案常量表 */
export const SHORTCUTS_TEXT = {
  hint: '点击右侧组合键后按下新的按键即可改绑（Esc 取消）；「恢复默认」还原本项。',
  resetAll: '全部恢复默认',
  reset: '恢复默认',
  /** 该项已是默认绑定时的按钮提示 */
  alreadyDefault: '当前已是默认组合键',
  /** 未录制时的按钮提示 */
  recordHint: '点击后按下新的组合键',
  /** 录制中的按钮文案 */
  recording: '请按下新的组合键…（Esc 取消）',
  /** 行内冲突标记前缀 */
  conflictBadge: '冲突',
} as const

/** 检查更新区块的状态行文案（纯函数，可脱离 DOM 单测） */
export function updateStatusLine(status: UpdateStatus, version: string): string {
  switch (status) {
    case 'checking':
      return '正在检查更新…'
    case 'up-to-date':
      return '已是最新版本'
    case 'available':
      return version ? '发现新版本，可下载安装' : '发现新版本'
    case 'downloading':
      return '正在下载更新…'
    case 'ready':
      return '更新已就绪，重启应用后生效'
    case 'error':
      return '检查更新失败，可重试'
    case 'unsupported':
      return '当前环境不支持自动更新'
    default:
      return '尚未检查'
  }
}

/** 录制时撞车的提示：`Ctrl+F 已被「搜索卡片」占用，请换一个组合键` */
export function conflictHintText(comboText: string, labels: string[]): string {
  return `${comboText} 已被「${labels.join('、')}」占用，请换一个组合键`
}

/** 行内冲突标记：`与「搜索卡片」冲突` */
export function conflictRowText(labels: string[]): string {
  return `与「${labels.join('、')}」冲突`
}
