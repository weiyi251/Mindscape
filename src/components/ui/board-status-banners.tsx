// ============================================================================
// 模块说明（中文）
// 画布顶部状态提示条的**容器**（A1 / A2，2026-09-20 用户计划第 2、3 步）。
//
// 两个提示条：
//   · 外部变动（A1）：窗口重新聚焦时比对文件夹签名，不一致就提示「重新扫描 / 忽略」；
//   · 未建框文件夹（A2）：磁盘上有子文件夹却没有分区框时提示「一键生成分区框 / 暂不生成」。
//
// 为什么合成一个容器：Board.tsx 已顶到行数棘轮（架构守卫规则 1），两个提示条共用
// 同一份依赖（history / writer / onError）与同一段可见性判据，Board 侧只需一行 JSX。
//
// 窗口聚焦监听放在这里（而不是 Board）：它是提示条的固有行为（用户裁决：
// 只在重新聚焦与手动重新扫描时比对，不做常驻 watch、不做轮询），
// 加节流避免连续切窗口时反复读盘。
// ============================================================================

import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { EXTERNAL_CHANGE_TEXT } from '@/components/ui/external-change-text'
import { UnframedFoldersNotice } from '@/components/ui/unframed-folders-bar'
import type { Command } from '@/core/commands/types'
import type { ExternalChange } from '@/core/storage/dirSignature'
import { useBoardStore } from '@/core/store/boardStore'
import {
  dismissUnframedFolders,
  generatePartitionsFromFolders,
} from '@/pages/board/generatePartitionsFlow'
import {
  checkExternalChanges,
  EXTERNAL_CHECK_THROTTLE_MS,
  rescanCurrentSpace,
} from '@/pages/board/spaceLoadFlow'

export interface ExternalChangeNoticeProps {
  change: ExternalChange
  busy: boolean
  onRescan: () => void
  onDismiss: () => void
}

/** 纯展示层：只吃 props，便于静态渲染测试 */
export function ExternalChangeNotice({
  change,
  busy,
  onRescan,
  onDismiss,
}: ExternalChangeNoticeProps) {
  return (
    <div className="flex items-center gap-3 border-b border-accent/40 bg-accent/5 px-5 py-2 text-xs text-accent">
      <span className="min-w-0 flex-1 truncate">
        {EXTERNAL_CHANGE_TEXT.lead(change)}
        <span className="text-muted-foreground"> {EXTERNAL_CHANGE_TEXT.hint}</span>
      </span>
      <Button variant="outline" size="sm" disabled={busy} onClick={onRescan}>
        {busy ? EXTERNAL_CHANGE_TEXT.rescanning : EXTERNAL_CHANGE_TEXT.rescan}
      </Button>
      <Button variant="ghost" size="sm" disabled={busy} onClick={onDismiss}>
        {EXTERNAL_CHANGE_TEXT.dismiss}
      </Button>
    </div>
  )
}

export interface BoardStatusBannersProps {
  /** 撤销栈（Board 传 History 实例） */
  history: { execute: (command: Command) => Promise<void> }
  /**
   * 落盘调度（Board 传 LayoutWriter 实例）。
   * `hasPending` 是 LayoutWriter 的只读判定 —— 用来跳过「自家改动还没落盘」时的聚焦比对。
   */
  writer: { schedule: () => void; flush: () => Promise<void> | void; hasPending?: boolean }
  /** 失败提示（Board 传 setActionError） */
  onError: (message: string) => void
}

/**
 * 容器层：订阅 store 决定显示哪一条，并把两个动作接到编排层。
 * 两个提示条各自在「处理完成」后由 store 清空状态，因此会自然消失。
 */
export function BoardStatusBanners({ history, writer, onError }: BoardStatusBannersProps) {
  const status = useBoardStore((state) => state.status)
  const removedView = useBoardStore((state) => state.removedView)
  const unframed = useBoardStore((state) => state.unframedFolders)
  const change = useBoardStore((state) => state.externalChange)
  const [busy, setBusy] = useState(false)
  const lastCheckRef = useRef(0)

  const visible = status === 'ready' && !removedView

  // 窗口重新获得焦点 → 比对一次文件夹签名（A1）
  useEffect(() => {
    if (!visible) return
    const onFocus = () => {
      // 自家改动还没落盘 → 跳过本次：落盘成功后基线会刷新，否则会把自家操作
      // （拖入文件 / 移除卡片）误报成「外部变动」
      if (writer.hasPending) return
      const now = Date.now()
      if (now - lastCheckRef.current < EXTERNAL_CHECK_THROTTLE_MS) return
      lastCheckRef.current = now
      void checkExternalChanges()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [visible, writer])

  if (!visible) return null

  const handleRescan = () => {
    setBusy(true)
    void rescanCurrentSpace({ writer, onError }).finally(() => setBusy(false))
  }

  const handleGenerate = () => {
    setBusy(true)
    void generatePartitionsFromFolders({ history, writer, onError }).finally(() => setBusy(false))
  }

  return (
    <>
      {change ? (
        <ExternalChangeNotice
          change={change}
          busy={busy}
          onRescan={handleRescan}
          onDismiss={() => useBoardStore.getState().setExternalChange(null)}
        />
      ) : null}
      {unframed.length > 0 ? (
        <UnframedFoldersNotice
          names={unframed}
          busy={busy}
          onGenerate={handleGenerate}
          onDismiss={dismissUnframedFolders}
        />
      ) : null}
    </>
  )
}
