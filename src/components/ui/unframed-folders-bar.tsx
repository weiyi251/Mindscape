// ============================================================================
// 模块说明（中文）
// 「磁盘有文件夹、画布没有框」提示条的**展示层**（A2，2026-09-20 用户计划第 2 步）。
//
// 为什么需要它：进空间时画布只为「有卡片的子文件夹」自动建框，
// **空子文件夹**在画布上完全隐形（用户看不到、也没法往里面拖卡片）。
// 这条提示把差集摆出来，并把「一键补框」做在一次点击里。
//
// 分层：本文件只导出**纯展示组件**（吃 props、不读 store），便于静态渲染测试；
//   容器（订阅 store + 组依赖 + 调编排）在 board-status-banners.tsx —— 两个提示条
//   共用一个容器，Board.tsx 因此只留一行 JSX（该文件有行数棘轮，架构守卫规则 1）。
// ============================================================================

import { Button } from '@/components/ui/button'
import { UNFRAMED_FOLDERS_TEXT, unframedNamesLabel } from '@/components/ui/unframed-folders-text'

export interface UnframedFoldersNoticeProps {
  names: readonly string[]
  busy: boolean
  onGenerate: () => void
  onDismiss: () => void
}

/** 纯展示层：只吃 props，便于静态渲染测试 */
export function UnframedFoldersNotice({
  names,
  busy,
  onGenerate,
  onDismiss,
}: UnframedFoldersNoticeProps) {
  return (
    <div className="flex items-center gap-3 border-b border-accent/40 bg-accent/5 px-5 py-2 text-xs text-accent">
      <span className="min-w-0 flex-1 truncate">
        {UNFRAMED_FOLDERS_TEXT.lead(names.length)}
        {unframedNamesLabel(names)}
      </span>
      <Button variant="outline" size="sm" disabled={busy} onClick={onGenerate}>
        {busy ? UNFRAMED_FOLDERS_TEXT.generating : UNFRAMED_FOLDERS_TEXT.generate}
      </Button>
      <Button variant="ghost" size="sm" disabled={busy} onClick={onDismiss}>
        {UNFRAMED_FOLDERS_TEXT.dismiss}
      </Button>
    </div>
  )
}
