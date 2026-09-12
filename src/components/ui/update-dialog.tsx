// ============================================================================
// 模块说明（中文）
// 更新提示弹窗 —— 更新流程的唯一 UI 出口，内容随 updaterStore 的状态机切换。
//
// 复用既有 Modal（遮罩 / 居中 / Esc 关闭），不新造浮层；进度条用纯 Tailwind
// 实现，遵守 17.11 的性能红线（不使用 backdrop-filter 等重特效）。
//
// 文案全部取自 UPDATE_TEXT 常量表，组件内不硬编码中文。
// ============================================================================

import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { progressRatio, UPDATE_TEXT } from '@/core/updater/updater'
import { useUpdaterStore, type UpdateStatus } from '@/core/store/updaterStore'

function statusTitle(status: UpdateStatus, version: string): string {
  switch (status) {
    case 'checking':
      return UPDATE_TEXT.checking
    case 'available':
      return `${UPDATE_TEXT.available} ${version}`
    case 'downloading':
      return UPDATE_TEXT.downloading
    case 'ready':
      return UPDATE_TEXT.readyTitle
    case 'error':
      return UPDATE_TEXT.failed
    default:
      return UPDATE_TEXT.menuEntry
  }
}

export function UpdateDialog() {
  const status = useUpdaterStore((s) => s.status)
  const version = useUpdaterStore((s) => s.version)
  const notes = useUpdaterStore((s) => s.notes)
  const errorMessage = useUpdaterStore((s) => s.errorMessage)
  const progress = useUpdaterStore((s) => s.progress)
  const dialogOpen = useUpdaterStore((s) => s.dialogOpen)
  const install = useUpdaterStore((s) => s.install)
  const restart = useUpdaterStore((s) => s.restart)
  const dismiss = useUpdaterStore((s) => s.dismiss)

  // 下载/安装过程中不允许无意关掉，避免用户以为没在更新
  const busy = status === 'checking' || status === 'downloading'
  const onClose = () => {
    if (!busy) dismiss()
  }

  const ratio = progress ? progressRatio(progress) : null

  return (
    <Modal open={dialogOpen} title={statusTitle(status, version)} onClose={onClose} footer={renderFooter()}>
      {renderBody()}
    </Modal>
  )

  function renderBody() {
    // idle 只出现在「已开窗但尚未发起检查」的极短窗口（open() 会立刻转入 checking），
    // 与 checking 归为同一显示，避免落到最后那个 ready 分支上去
    if (status === 'idle' || status === 'checking') {
      return <p className="text-sm text-muted-foreground">{UPDATE_TEXT.checking}</p>
    }

    if (status === 'up-to-date') {
      return <p className="text-sm text-muted-foreground">{UPDATE_TEXT.upToDate}</p>
    }

    if (status === 'unsupported') {
      return <p className="text-sm text-muted-foreground">{UPDATE_TEXT.unsupported}</p>
    }

    if (status === 'error') {
      return (
        <div className="space-y-2">
          <p className="text-sm text-destructive">{UPDATE_TEXT.failed}</p>
          {errorMessage ? (
            <p className="break-all text-xs text-muted-foreground">{errorMessage}</p>
          ) : null}
        </div>
      )
    }

    if (status === 'available') {
      return (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            当前版本之后发布了 {version}，更新不会影响你已有的空间与文件。
          </p>
          {notes ? (
            <div className="max-h-52 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
              {notes}
            </div>
          ) : null}
        </div>
      )
    }

    if (status === 'downloading') {
      return (
        <div className="space-y-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: ratio === null ? '30%' : `${Math.round(ratio * 100)}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {ratio === null
              ? UPDATE_TEXT.downloading
              : `${UPDATE_TEXT.downloading} ${Math.round(ratio * 100)}%`}
          </p>
        </div>
      )
    }

    // ready
    return <p className="text-sm text-muted-foreground">{UPDATE_TEXT.restartPrompt}</p>
  }

  function renderFooter() {
    if (status === 'available') {
      return (
        <>
          <Button variant="outline" size="sm" onClick={dismiss}>
            {UPDATE_TEXT.later}
          </Button>
          <Button size="sm" onClick={() => void install()}>
            {UPDATE_TEXT.confirm}
          </Button>
        </>
      )
    }

    if (status === 'ready') {
      return (
        <>
          <Button variant="outline" size="sm" onClick={dismiss}>
            {UPDATE_TEXT.later}
          </Button>
          <Button size="sm" onClick={() => void restart()}>
            {UPDATE_TEXT.restartNow}
          </Button>
        </>
      )
    }

    if (busy) return null

    return (
      <Button variant="outline" size="sm" onClick={dismiss}>
        {UPDATE_TEXT.close}
      </Button>
    )
  }
}
