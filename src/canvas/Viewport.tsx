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
//
// 移动端（2026-09-21 M2，决策 D4）：本组件是**触摸与鼠标分流的唯一路口**。
// 总闸 `touchGestures` 打开时（由调用方按平台能力表传入），`pointerType === 'touch'`
// 的整套手势（单指平移 / 双指捏合 / 长按 / 点按）交给 TouchGestureRecognizer；
// 鼠标、触控笔、以及总闸关着时的桌面触屏，**原样走老链路**，桌面行为零改动（红线 R2）。
// 分流放在这里而不是各控制器内部，因为「第二根手指落下」这种信息只有这里看得到。
// ============================================================================

import { useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { ViewportController } from './interaction/viewportController'
import { PointerGesture } from './interaction/pointerGesture'
import { TouchGestureRecognizer } from './interaction/touchGesture'
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
  /**
   * 移动端「选择模式」（M2 / 决策 D4 的兜底按钮）：触屏没有 Ctrl，
   * 打开后单指拖空白变成框选而不是平移。仅作用于触摸，鼠标路径不受影响。
   */
  selectMode?: boolean
  /**
   * 总闸（M2）：是否由手势状态机接管 `pointerType === 'touch'` 的事件。
   * 由调用方按平台能力表（touchGestures）传入 —— 桌面触屏笔记本因此保持改动前
   * 的行为（红线 R2），安卓上才走捏合 / 长按 / 选择模式这一套。
   */
  touchGestures?: boolean
  /**
   * 长按成立（M2）：参数是**按下时**的原始事件，上层据此做与右键完全相同的命中判定。
   * 触屏在 `touch-action: none` 下不保证派发 contextmenu，所以必须自己判。
   */
  onLongPress?: (event: PointerEvent) => void
  /**
   * 需要作废在途单指手势时回调（M2）：第二根手指落下转捏合、长按弹菜单，
   * 两种情况都不该让卡片拖拽 / 缩放 / 框选继续跟着这根手指跑。
   */
  onAbortPointerGestures?: () => void
  /**
   * 「这根手指交给元素自己处理」（M2）：便签正文里选字、输入框、卡片内按钮 ——
   * 返回 true 时触摸**不进入**手势状态机，于是不平移、不捏合、也不弹长按菜单。
   * 判定留在调用方（只有 Canvas 知道 data-note-editing / data-card-interactive 这些标记）。
   */
  interactiveTouch?: (element: HTMLElement) => boolean
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
  selectMode,
  touchGestures = false,
  onLongPress,
  onAbortPointerGestures,
  interactiveTouch,
}: ViewportProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  // 回调存 ref：既保证事件监听只挂一次，又能始终调用到最新的父组件回调
  const onReadyRef = useRef(onReady)
  const onChangeRef = useRef(onChange)
  const onBackgroundClickRef = useRef(onBackgroundClick)
  const onItemPointerDownRef = useRef(onItemPointerDown)
  const onMarqueePointerDownRef = useRef(onMarqueePointerDown)
  const onLongPressRef = useRef(onLongPress)
  const onAbortPointerGesturesRef = useRef(onAbortPointerGestures)
  const interactiveTouchRef = useRef(interactiveTouch)
  // selectMode 也走 ref：它是 React state，若进依赖数组会让整套监听重挂
  const selectModeRef = useRef(Boolean(selectMode))
  const touchGesturesRef = useRef(touchGestures)
  onReadyRef.current = onReady
  onChangeRef.current = onChange
  onBackgroundClickRef.current = onBackgroundClick
  onItemPointerDownRef.current = onItemPointerDown
  onMarqueePointerDownRef.current = onMarqueePointerDown
  onLongPressRef.current = onLongPress
  onAbortPointerGesturesRef.current = onAbortPointerGestures
  interactiveTouchRef.current = interactiveTouch
  selectModeRef.current = Boolean(selectMode)
  touchGesturesRef.current = touchGestures

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

    // ---- M2 触摸手势：整套状态机在 touchGesture.ts，这里只负责喂事件、执行指令 ----
    // 总闸关着时（桌面）触摸一律走下面的鼠标老链路，行为与 M2 之前完全一致（红线 R2）
    const isTouch = (event: PointerEvent) =>
      touchGesturesRef.current && event.pointerType === 'touch'
    // 按下时的原始事件要留一份：长按在几十毫秒后才成立，届时拿得到命中元素与坐标
    const touchDown = { current: null as PointerEvent | null }
    const touch = new TouchGestureRecognizer({
      onPanBy: (dx, dy) => controller.panBy(dx, dy),
      onPinchStart: () => {
        // 第二根手指落下：在途的拖卡 / 缩放 / 框选必须立刻作废，
        // 否则捏合会拖着一张卡片一起缩放（触屏上没有 Ctrl 可以放弃拖拽）。
        // 注意不能 reset() 自己 —— 那会连刚建立的捏合基准一起清掉。
        onAbortPointerGesturesRef.current?.()
      },
      onPinchFrame: (frame) => controller.applyPinch(frame),
      onLongPress: () => {
        const event = touchDown.current
        if (!event) return
        onAbortPointerGesturesRef.current?.()
        onLongPressRef.current?.(event)
      },
      onTap: () => onBackgroundClickRef.current?.(),
    })

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      const target = event.target as HTMLElement | null

      // 卡片上的按下：交给卡片拖拽控制器（T2.2），无论是否消费都不启动平移（5.1）
      const onItem = Boolean(target?.closest(`[${CANVAS_ITEM_ATTR}]`))
      if (onItem) onItemPointerDownRef.current?.(event)

      if (isTouch(event)) {
        // 元素自己处理这根手指（便签正文选字 / 输入框 / 卡片内按钮）：
        // 不进手势状态机 —— 于是不平移、不捏合、也不弹长按菜单（M2）
        if (target && interactiveTouchRef.current?.(target)) return
        // 「选择模式」下的空白触摸交给框选（D4：触屏没有 Ctrl + 拖）
        const marquee =
          !onItem && selectModeRef.current && Boolean(onMarqueePointerDownRef.current)
        if (marquee) onMarqueePointerDownRef.current?.(event)
        touchDown.current = event
        touch.pointerDown({
          pointerId: event.pointerId,
          point: { x: event.clientX, y: event.clientY },
          onItem,
          marquee,
          isPrimary: event.isPrimary,
        })
        // 空白起拖才捕获到 root：卡片上的触摸留给卡片自己的 setPointerCapture
        if (!onItem && !marquee) root.setPointerCapture(event.pointerId)
        return
      }

      if (onItem) return

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
      if (isTouch(event)) {
        touch.pointerMove(event.pointerId, { x: event.clientX, y: event.clientY })
        return
      }
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
      if (isTouch(event)) {
        touch.pointerUp(event.pointerId, { x: event.clientX, y: event.clientY })
        if (root.hasPointerCapture(event.pointerId)) {
          root.releasePointerCapture(event.pointerId)
        }
        // 现在这是 window 级监听：别一根不相干的手指抬起来就把长按的落点清掉
        if (touchDown.current?.pointerId === event.pointerId) touchDown.current = null
        return
      }
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
      if (isTouch(event)) {
        touch.pointerCancel(event.pointerId)
        if (root.hasPointerCapture(event.pointerId)) {
          root.releasePointerCapture(event.pointerId)
        }
        if (touchDown.current?.pointerId === event.pointerId) touchDown.current = null
        return
      }
      if (!gesture.isActivePointer(event.pointerId)) return
      gesture.cancel()
      if (root.hasPointerCapture(event.pointerId)) {
        root.releasePointerCapture(event.pointerId)
      }
    }

    root.addEventListener('pointerdown', handlePointerDown)
    root.addEventListener('pointermove', handlePointerMove)
    // 抬起 / 取消听 window，不听 root：只有被 root 捕获过的手指才**保证**回到 root，
    // 按在卡片上（卡片自己 setPointerCapture）或在 Viewport 的兄弟节点上松开
    //（右下角工具条、小地图）时 root 收不到，状态机里就留下一根永不抬起的幽灵手指，
    // 之后每次单指拖动都被当成捏合。事件无论如何都会冒泡到 window，
    // 未登记的 pointerId 由 `pointers.has()` 在状态机里挡掉，不会重复计数。
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)

    return () => {
      root.removeEventListener('wheel', handleWheel)
      root.removeEventListener('pointerdown', handlePointerDown)
      root.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
      controller.detach()
    }
  }, [controller, panWithPointer])

  return (
    <div
      ref={rootRef}
      {...{ [CANVAS_ROOT_ATTR]: '' }}
      className={cn('relative h-full w-full touch-none overflow-hidden', className)}
    >
      {/* stage 即「世界坐标系」的载体：它的 transform 就是 viewport 变换 */}
      <div ref={stageRef} data-canvas-stage className="absolute left-0 top-0 origin-top-left">
        {children}
      </div>
    </div>
  )
}
