// ============================================================================
// 模块说明（中文）
// 「磁盘有文件夹、画布没有框」提示条（A2，2026-09-20 用户计划第 2 步）。
//
// 为什么需要它：进空间时画布只为「有卡片的子文件夹」自动建框，
// **空子文件夹**在画布上完全隐形（用户看不到、也没法往里面拖卡片）。
// 这条提示把差集摆出来，并把「一键补框」做在一次点击里。
//
// 分层说明：本组件自读 boardStore 并调用 pages/board/generatePartitionsFlow 的入口，
// 目的是让 Board.tsx 只留一行 JSX —— 该文件有行数棘轮（架构守卫规则 1）。
// 展示层（UnframedFoldersNotice）与文案拼接（unframedNamesLabel）是纯的，可静态渲染测试。
// ============================================================================

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { UNFRAMED_FOLDERS_TEXT, unframedNamesLabel } from '@/components/ui/unframed-folders-text'
import type { Command } from '@/core/commands/types'
import { useBoardStore } from '@/core/store/boardStore'
import {
  dismissUnframedFolders,
  generatePartitionsFromFolders,
} from '@/pages/board/generatePartitionsFlow'

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

export interface UnframedFoldersBarProps {
  /** 撤销栈（Board 传 History 实例） */
  history: { execute: (command: Command) => Promise<void> }
  /** 落盘调度（Board 传 LayoutWriter 实例） */
  writer: { schedule: () => void }
  /** 失败提示（Board 传 setActionError） */
  onError: (message: string) => void
}

/**
 * 容器层：自己订阅 store，只在「空间就绪 + 非已移除视图 + 确有未建框的文件夹」时出现。
 * 补框成功后 boardStore 会清空 unframedFolders，提示条自然消失。
 */
export function UnframedFoldersBar({ history, writer, onError }: UnframedFoldersBarProps) {
  const status = useBoardStore((state) => state.status)
  const removedView = useBoardStore((state) => state.removedView)
  const names = useBoardStore((state) => state.unframedFolders)
  const [busy, setBusy] = useState(false)

  if (status !== 'ready' || removedView || names.length === 0) return null

  const handleGenerate = () => {
    setBusy(true)
    void generatePartitionsFromFolders({ history, writer, onError }).finally(() => setBusy(false))
  }

  return (
    <UnframedFoldersNotice
      names={names}
      busy={busy}
      onGenerate={handleGenerate}
      onDismiss={dismissUnframedFolders}
    />
  )
}
