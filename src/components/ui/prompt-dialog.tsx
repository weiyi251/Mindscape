// ============================================================================
// 模块说明（中文）
// 轻量输入浮层（T3.3 备注 / T3.9 编辑标签 / T3.2 连线标签共用）。
//
// 为什么不用 window.prompt：Tauri 的 WebView2 不支持原生 prompt/confirm/alert
// （T2.6 已踩过：window.confirm 永远返回 false），一律走自研浮层。
//
// 单行（input）与多行（textarea）两种形态；Enter 提交，Esc 取消。
// ============================================================================

import { useEffect, useRef, useState } from 'react'

export interface PromptDialogState {
  title: string
  /** 初始值 */
  value: string
  /** 多行文本（备注用 textarea） */
  multiline?: boolean
  placeholder?: string
  /** 确认回调；传回 trim 后的值 */
  onConfirm: (value: string) => void
}

export function PromptDialog({ state, onClose }: { state: PromptDialogState | null; onClose: () => void }) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [draft, setDraft] = useState('')

  // state 变化时同步草稿并聚焦全选
  useEffect(() => {
    if (state) {
      setDraft(state.value)
      // 等下一帧：textarea 挂载后聚焦
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [state])

  if (!state) return null

  const submit = () => {
    onClose()
    state.onConfirm(draft.trim())
  }

  return (
    // 背景挡层：捕获一次点击关闭；不再往下传事件，避免触发画布行为
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/60"
      onPointerDown={(event) => {
        event.stopPropagation()
        onClose()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
        // Enter 提交；textarea 里 Shift+Enter 换行
        if (event.key === 'Enter' && (!state.multiline || !event.shiftKey)) {
          event.preventDefault()
          submit()
        }
      }}
    >
      <div
        className="w-80 rounded-md border border-border bg-card p-3 shadow-md"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <p className="mb-2 text-xs font-medium text-foreground">{state.title}</p>
        {state.multiline ? (
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={state.placeholder}
            rows={4}
            className="w-full resize-none rounded border border-border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary"
          />
        ) : (
          <input
            ref={(element) => {
              // input 与 textarea 复用同一个 ref 的聚焦逻辑
              ;(inputRef as unknown as { current: HTMLTextAreaElement | null }).current =
                element as unknown as HTMLTextAreaElement
            }}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={state.placeholder}
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary"
          />
        )}
        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90"
            onClick={submit}
          >
            确定
          </button>
        </div>
      </div>
    </div>
  )
}
