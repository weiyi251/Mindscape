// ============================================================================
// 模块说明（中文）
// 轻量模态框。阶段一只有一个对话框（新建空间），因此不引入 radix-ui 的 Dialog，
// 用纯 Tailwind 实现约 40 行的等价能力（遮罩、居中、Esc 关闭、点击遮罩关闭）。
// 将来组件需求变多时再按 12.1 的 shadcn/ui 规范补装。
//
// ⚠️ 不使用 backdrop-filter（17.11 反模式：WebView2 下严重掉帧），
//    遮罩只用半透明纯色。
//
// 实现任务：T1.1（阶段一）。
// ============================================================================

import { useEffect } from 'react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface ModalProps {
  /** 是否显示；false 时不渲染任何内容 */
  open: boolean
  /** 标题（同时作为 aria-label） */
  title: string
  /** 关闭回调（Esc、点击遮罩、点击右上角 × 都会触发） */
  onClose: () => void
  children: ReactNode
  /** 底部操作区（通常是按钮组）；不传则不渲染该行 */
  footer?: ReactNode
  /** 内容区宽度等额外样式 */
  className?: string
}

export function Modal({ open, title, onClose, children, footer, className }: ModalProps) {
  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/25 p-4"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'w-full max-w-md rounded-lg border border-border bg-card p-5 text-card-foreground shadow-lg',
          className,
        )}
        // 阻止冒泡，避免点击面板内部也触发遮罩的关闭
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="text-base font-semibold">{title}</h2>
        <div className="mt-4 space-y-4">{children}</div>
        {footer ? <div className="mt-6 flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  )
}
