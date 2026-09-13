// ============================================================================
// 模块说明（中文）
// 可拖动 / 可缩放的浮窗（2026-09-13 新增，用户要求：设置面板改为可拖动调整
// 位置与大小时长的弹窗模式）。
//
// 为什么自研而不是装组件库：17.1 依赖清单是锁定的，且项目约定拖拽一律用
// **原生 Pointer Events + setPointerCapture**（禁 dnd-kit / react-rnd 之类）。
//
// 实现要点：
//   · 拖动 / 缩放期间**直写**元素的 style.left/top/width/height，不进 React state
//     —— 指针事件是高频路径，每帧 setState 会让整棵画布跟着重渲染（17.3 的精神）；
//     松手时才提交一次 state 并写偏好。
//   · 位置 / 尺寸的收敛规则（最小尺寸、视口边界）全在 floatingModalGeometry.ts
//     （纯函数 + 单测），本组件只做「读指针 → 调纯函数 → 写 style」。
//   · 不使用 backdrop-filter（17.11 反模式：WebView2 下严重掉帧）。
// ============================================================================

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'

import { cn } from '@/lib/utils'
import {
  clampRect,
  defaultModalRect,
  moveRect,
  parseModalRect,
  resizeRect,
  serializeModalRect,
} from './floatingModalGeometry'
import type { ModalRect } from './floatingModalGeometry'

export interface FloatingModalProps {
  open: boolean
  /** 标题（同时作为 aria-label） */
  title: string
  onClose: () => void
  children: ReactNode
  /** 顶部栏标题右侧的内容（分页切换等） */
  headerExtra?: ReactNode
  /** 位置尺寸偏好的 localStorage 键；不传则不记忆 */
  storageKey?: string
  /** 点击面板外是否关闭（默认 true） */
  closeOnOutsideClick?: boolean
  /** 额外样式（不参与定位：定位一律由本组件按几何模块直写） */
  className?: string
}

/** 当前视口尺寸 */
function viewportSize() {
  return { width: window.innerWidth, height: window.innerHeight }
}

/** 把矩形直写到元素样式（拖动 / 缩放 / 提交后对齐都走这里） */
function applyRect(element: HTMLElement, value: ModalRect) {
  element.style.left = `${value.x}px`
  element.style.top = `${value.y}px`
  element.style.width = `${value.width}px`
  element.style.height = `${value.height}px`
}

/** 首次渲染的矩形：偏好 → 收敛进视口；坏偏好回落默认 */
function loadInitialRect(storageKey?: string): ModalRect {
  const viewport = viewportSize()
  if (storageKey) {
    try {
      const saved = parseModalRect(localStorage.getItem(storageKey))
      if (saved) return clampRect(saved, viewport)
    } catch {
      // localStorage 不可用：直接走默认位置
    }
  }
  return defaultModalRect(viewport)
}

/** 拖动 / 缩放过程中的会话状态 */
interface PointerSession {
  startRect: ModalRect
  originX: number
  originY: number
}

export function FloatingModal({
  open,
  title,
  onClose,
  children,
  headerExtra,
  storageKey,
  closeOnOutsideClick = true,
  className,
}: FloatingModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<ModalRect>(() => loadInitialRect(storageKey))
  /** 最近一次提交的矩形（指针会话的起点也取自它） */
  const committedRef = useRef(rect)
  /** 拖动 / 缩放期间的即时矩形：优先级高于 state，用于对抗过程中的重渲染 */
  const workingRef = useRef<ModalRect | null>(null)
  const sessionRef = useRef<PointerSession | null>(null)

  // 每次渲染后把「最正确的那个矩形」写回 DOM。刻意不写依赖数组：
  // 拖动过程中若父组件恰好重渲染，也要立刻把 working 值重新贴回去，不能闪回旧位置。
  useLayoutEffect(() => {
    const element = panelRef.current
    const target = workingRef.current ?? committedRef.current
    if (element && target) applyRect(element, target)
  })

  /** 提交矩形：更新 state + 落偏好（只在指针松手时调用） */
  const commitRect = useCallback(
    (next: ModalRect) => {
      workingRef.current = null
      committedRef.current = next
      setRect(next)
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, serializeModalRect(next))
        } catch {
          // localStorage 不可用：只影响记忆，本次打开的调整照常生效
        }
      }
    },
    [storageKey],
  )

  // 窗口尺寸变化：把浮窗拉回可视区（否则会被挤出屏幕外再也点不到）
  useEffect(() => {
    if (!open) return
    const handleResize = () => {
      commitRect(clampRect(workingRef.current ?? committedRef.current, viewportSize()))
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [open, commitRect])

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  // ---- 拖动（标题栏） / 缩放（右下角手柄）----

  const beginSession = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    sessionRef.current = {
      startRect: workingRef.current ?? committedRef.current,
      originX: event.clientX,
      originY: event.clientY,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleHeaderPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const session = sessionRef.current
    if (!session) return
    const next = moveRect(
      session.startRect,
      event.clientX - session.originX,
      event.clientY - session.originY,
      viewportSize(),
    )
    workingRef.current = next
    if (panelRef.current) applyRect(panelRef.current, next)
  }

  const handleResizePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const session = sessionRef.current
    if (!session) return
    const next = resizeRect(
      session.startRect,
      session.startRect.width + (event.clientX - session.originX),
      session.startRect.height + (event.clientY - session.originY),
      viewportSize(),
    )
    workingRef.current = next
    if (panelRef.current) applyRect(panelRef.current, next)
  }

  const endSession = (event: ReactPointerEvent<HTMLElement>) => {
    if (!sessionRef.current) return
    sessionRef.current = null
    // setPointerCapture 的元素在 pointerup 后会自动释放；重复释放会抛错，故做判断
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    commitRect(workingRef.current ?? committedRef.current)
  }

  if (!open) return null

  return (
    <>
      {/* 点击面板以外关闭（透明遮罩只收点击，不挡视觉；不用 backdrop-filter） */}
      {closeOnOutsideClick ? (
        <div className="fixed inset-0 z-30" onPointerDown={onClose} />
      ) : null}

      <div
        ref={panelRef}
        data-floating-modal=""
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'fixed z-40 flex flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl',
          className,
        )}
        style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      >
        {/* 标题栏即拖动柄：interactive 的子元素各自 stopPropagation */}
        <div
          className="flex h-9 shrink-0 cursor-move select-none items-center gap-3 border-b border-border/60 px-3"
          style={{ touchAction: 'none' }}
          onPointerDown={beginSession}
          onPointerMove={handleHeaderPointerMove}
          onPointerUp={endSession}
          onPointerCancel={endSession}
        >
          <span className="shrink-0 text-[13px] font-medium text-foreground/90">{title}</span>
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">{headerExtra}</div>
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onClose}
            title="关闭"
            aria-label="关闭"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] leading-none text-foreground/60 hover:bg-foreground/10"
          >
            ✕
          </button>
        </div>

        {/* 内容区：自身滚动，撑满剩余高度 */}
        <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>

        {/* 右下角缩放手柄 */}
        <div
          className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
          style={{ touchAction: 'none' }}
          role="presentation"
          data-floating-modal-resize=""
          onPointerDown={beginSession}
          onPointerMove={handleResizePointerMove}
          onPointerUp={endSession}
          onPointerCancel={endSession}
        >
          {/* 两道斜线，纯装饰 */}
          <svg
            viewBox="0 0 16 16"
            className="h-4 w-4 text-foreground/30"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
          >
            <path d="M15 9 9 15" />
            <path d="M15 13 13 15" />
          </svg>
        </div>
      </div>
    </>
  )
}
