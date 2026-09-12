// ============================================================================
// 模块说明（中文）
// 设置面板的文案常量与纯函数（2026-09-12）。
//
// ⚠️ 单独成文件的原因：settings-panel.tsx 是组件文件，react-refresh 规则要求
//   组件文件只导出组件；文案表与纯函数放这里，避免新增 lint warning。
// ============================================================================

import type { UpdateStatus } from '@/core/store/updaterStore'

/** 面板文案常量表（中文文案不散落在 JSX 里） */
export const SETTINGS_TEXT = {
  title: '设置',
  close: '关闭',
  appearanceTitle: '外观与视图',
  toLight: '切换到浅色模式',
  toDark: '切换到深色模式',
  removedShow: '显示已移除',
  removedBack: '返回画布',
  updateTitle: '检查更新',
  currentVersion: '当前版本',
  latestVersion: '最新版本',
  checkNow: '检查更新',
  unknownVersion: '未知',
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
