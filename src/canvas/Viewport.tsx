// ============================================================================
// 模块说明（中文）
// 视口组件：把「缩放 / 平移」接进 React。对应开发计划书 17.3 与 17.4。
//
// 关键设计（决定手感成败）：
//   · zoom / offset 存在 ViewportController 的普通字段里，**不进 React state**；
//   · 滚轮与平移只改 stage 元素的 `style.transform`，不触发任何重渲染；
//   · 滚轮监听必须 `{ passive: false }` + preventDefault（17.4 明确），
//     否则 WebView2 会把滚轮当成页面滚动 / 页面缩放；
//   · 平移用原生 Pointer Events + setPointerCapture（17.4：不用任何拖拽库），
//     并且只从**空白背景**起拖 —— 靠 `data-canvas-item` 属性区分卡片与背景；
//   · 平移前先过 4px 判定（5.1）：位移 ≤ 4px 视为单击，否则才平移。
//
// 实现任务：T0.11（视口底座）+ T0.12（4px 判定接入）。
// ============================================================================

import { useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { ViewportController } from './interaction/viewportController'
import { PointerGesture } from './interaction/pointerGesture'
import type { ViewportState } from './interaction/coordinates'

/** 标记「画布内容」的属性名：带此属性的元素上按下鼠标不会触发画布平移 */
export const CANVAS_ITEM_ATTR = 'data-canvas-item'

/** 标记「画布根容器（未被变换的那个）」的属性名：外部靠它拿到可见区域的尺寸 */
export const CANVAS_ROOT_ATTR = 'data-canvas-root'

export interface ViewportProps {
  /** 世界坐标系下的内容（卡片等），由调用方决定布局 */
  children?: ReactNode
  /** 视口根容器样式（尺寸由调用方控制） */
  className?: string
  /** 视口就绪回调：拿到控制器后可做坐标换算、复位视图等 */
  onReady?: (controller: ViewportController) => void
  /** 视口变化回调（已按帧合并）。⚠️ 请勿在此 setState，用 DOM 直写保持手感 */
  onChange?: (state: ViewportState) => void
  /** 是否允许左键拖空白平移（默认开） */
  panWithPointer?: boolean
  /**
   * 空白处「单击」回调（位移 ≤ 4px）。
   * ⚠️ 阶段一接入选中集合后，这里执行「取消选中」（5.1）。
   */
  onBackgroundClick?: () => void
  /**
   * 卡片上的按下事件（T2.2）：由 Canvas 的卡片拖拽控制器接管。
   * 无论控制器是否消费，卡片上按下都**不会**启动画布平移（5.1：按的位置决定行为）。
   */
  onItemPointerDown?: (event: PointerEvent) => void
  /**
   * Ctrl + 左键按在空白处（T2.3 框选）：优先于平移（5.1 两个操作都在空白处，靠修饰键区分）。
   * 未提供该回调时 Ctrl + 拖空白仍为平移。
   */
  onMarqueePointerDown?: (event: PointerEvent) => void
}

export function Viewport({
  children,
  className,
  onReady,
  onChange,
  panWithPointer = true,
  onBackgroundClick,
  onItemPointerDown,
  onMarqueePointerDown,
}: ViewportProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  // 回调存 ref：既保证事件监听只挂一次，又能始终调用到最新的父组件回调
  const onReadyRef = useRef(onReady)
  const onChangeRef = useRef(onChange)
  const onBackgroundClickRef = useRef(onBackgroundClick)
  const onItemPointerDownRef = useRef(onItemPointerDown)
  const onMarqueePointerDownRef = useRef(onMarqueePointerDown)
  onReadyRef.current = onReady
  onChangeRef.current = onChange
  onBackgroundClickRef.current = onBackgroundClick
  onItemPointerDownRef.current = onItemPointerDown
  onMarqueePointerDownRef.current = onMarqueePointerDown

  const controller = useMemo(
    () => new ViewportController({ onChange: (state) => onChangeRef.current?.(state) }),
    [],
  )

  useEffect(() => {
    const root = rootRef.current
    const stage = stageRef.current
    if (!root || !stage) return

    // ⚠️ 第二个参数必须是**未被变换的根容器**：滚轮缩放要用它取「画布容器左上角」。
    //    若传 stage（自身被 translate 过），offset 会被重复扣减，缩放中心就会漂移。
    controller.attach(stage, root)
    onReadyRef.current?.(controller)

    // ---- 滚轮缩放（passive: false 是硬性要求）----
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      controller.handleWheel(event)
    }
    root.addEventListener('wheel', handleWheel, { passive: false })

    // ---- 左键拖空白平移（带 4px 判定）----
    const gesture = new PointerGesture()
    let lastX = 0
    let lastY = 0

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      const target = event.target as HTMLElement | null

      // 卡片上的按下：交给卡片拖拽控制器（T2.2），无论是否消费都不启动平移（5.1）
      if (target?.closest(`[${CANVAS_ITEM_ATTR}]`)) {
        onItemPointerDownRef.current?.(event)
        return
      }

      // Ctrl + 空白拖 = 框选（T2.3 / 5.1），优先于平移
      if ((event.ctrlKey || event.metaKey) && onMarqueePointerDownRef.current) {
        onMarqueePointerDownRef.current(event)
        return
      }

      if (!panWithPointer) return
      if (!gesture.beginFromEvent(event)) return

      lastX = event.clientX
      lastY = event.clientY
      root.setPointerCapture(event.pointerId)
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (!gesture.isActivePointer(event.pointerId)) return

      const wasDragging = gesture.isDragging
      const point = { x: event.clientX, y: event.clientY }
      gesture.move(event.pointerId, point)

      if (!gesture.isDragging) {
        lastX = point.x
        lastY = point.y
        return
      }

      if (!wasDragging) {
        // 刚跨过 4px 阈值：补上「按下 → 当前」的完整位移，避免前 4px 的跳变
        const start = gesture.startPoint
        controller.panBy(point.x - start.x, point.y - start.y)
      } else {
        controller.panBy(point.x - lastX, point.y - lastY)
      }
      lastX = point.x
      lastY = point.y
    }

    const handlePointerUp = (event: PointerEvent) => {
      if (!gesture.isActivePointer(event.pointerId)) return

      const result = gesture.end(event.pointerId, { x: event.clientX, y: event.clientY })
      if (root.hasPointerCapture(event.pointerId)) {
        root.releasePointerCapture(event.pointerId)
      }
      if (result?.kind === 'click') {
        onBackgroundClickRef.current?.()
      }
    }

    const handlePointerCancel = (event: PointerEvent) => {
      if (!gesture.isActivePointer(event.pointerId)) return
      gesture.cancel()
      if (root.hasPointerCapture(event.pointerId)) {
        root.releasePointerCapture(event.pointerId)
      }
    }

    root.addEventListener('pointerdown', handlePointerDown)
    root.addEventListener('pointermove', handlePointerMove)
    root.addEventListener('pointerup', handlePointerUp)
    root.addEventListener('pointercancel', handlePointerCancel)

    return () => {
      root.removeEventListener('wheel', handleWheel)
      root.removeEventListener('pointerdown', handlePointerDown)
      root.removeEventListener('pointermove', handlePointerMove)
      root.removeEventListener('pointerup', handlePointerUp)
      root.removeEventListener('pointercancel', handlePointerCancel)
      controller.detach()
    }
  }, [controller, panWithPointer])

  return (
    <div
      ref={rootRef}
      {...{ [CANVAS_ROOT_ATTR]: '' }}
      className={cn('relative h-full w-full touch-none overflow-hidden bg-background', className)}
    >
      {/* stage 即「世界坐标系」的载体：它的 transform 就是 viewport 变换 */}
      <div ref={stageRef} data-canvas-stage className="absolute left-0 top-0 origin-top-left">
        {children}
      </div>
    </div>
  )
}
