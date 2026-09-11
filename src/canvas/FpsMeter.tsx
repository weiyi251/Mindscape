// ============================================================================
// 模块说明（中文）
// 帧率指示器。用于 11.2 / 11.3 / 11.4 的手感验收：「拖动/缩放/平移 60fps 不掉帧」。
//
// 实现要点（与 17.3 同一原则）：**不 setState**。
// 每帧 setState 会让 React 重渲染，反过来把帧率压下去，测量本身就成了干扰源。
// 因此这里用 requestAnimationFrame 采样，每 500ms 直接改一次 DOM textContent。
//
// 实现任务：T0.11（准备层，手感验收辅助工具）。
// ============================================================================

import { useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'

export interface FpsMeterProps {
  className?: string
  /** 采样窗口（毫秒），默认 500 */
  interval?: number
}

export function FpsMeter({ className, interval = 500 }: FpsMeterProps) {
  const labelRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    let frames = 0
    let windowStart = performance.now()
    let rafId = 0

    const tick = (now: number) => {
      frames += 1
      const elapsed = now - windowStart
      if (elapsed >= interval) {
        const fps = Math.round((frames * 1000) / elapsed)
        if (labelRef.current) {
          labelRef.current.textContent = `${fps} FPS`
          labelRef.current.dataset.fps = String(fps)
        }
        frames = 0
        windowStart = now
      }
      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [interval])

  return (
    <span ref={labelRef} className={cn('tabular-nums', className)}>
      -- FPS
    </span>
  )
}
