// ============================================================================
// 模块说明（中文）
// 「文件夹被外部改动」提示条的文案（A1，2026-09-20 用户计划第 3 步）。
//
// 为什么与组件分文件：与 unframed-folders-text.ts 同一理由 —— 本文件只导出
// 常量与纯函数，组件文件因此只导出组件，满足 lint 的
// react-refresh/only-export-components（否则每次改文案都会让画布整页热更新失效）。
// ============================================================================

import type { ExternalChange } from '@/core/storage/dirSignature'

/** 用户可见文案常量表（集中一处便于校对） */
export const EXTERNAL_CHANGE_TEXT = {
  /** 变动说明：文件数变了给出前后数量；数量没变则是「内容 / 名称有变化」 */
  lead: (change: ExternalChange) =>
    change.prevFiles === change.files
      ? '这个空间的文件在外部被改动过（文件数量没变，名称或内容有变化）。'
      : `这个空间的文件在外部有变动：文件数量 ${change.prevFiles} → ${change.files}。`,
  /** 提示条补充说明（消失的文件会进「已移除」，不是被删掉） */
  hint: '重新扫描后，画布会按文件夹现状更新；已消失的文件会记入「已移除」视图。',
  /** 重新扫描按钮 */
  rescan: '重新扫描',
  /** 扫描中 */
  rescanning: '扫描中…',
  /** 忽略本次提示（只清标记，不动画布） */
  dismiss: '忽略',
} as const
