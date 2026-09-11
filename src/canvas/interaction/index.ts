// ============================================================================
// 模块说明（中文）
// 指针交互层入口。对应开发计划书 17.4：
//   卡片拖动 / 画布平移 / 框选 / 点击与拖拽的 4px 判定，
//   一律使用原生 Pointer Events + setPointerCapture，不用任何拖拽库。
//
// 本目录当前提供（准备层 T0.11 / T0.12）：
//   · coordinates.ts        —— 画布坐标 ↔ 屏幕坐标换算（纯函数）
//   · viewportController.ts —— 视口控制器（zoom / offset 存普通字段，不进 React state）
//   · pointerGesture.ts     —— 点击 / 拖拽 4px 判定
//
// 阶段一至三在此目录继续补充：卡片拖拽、框选、连线端点、吸附计算。
// ============================================================================

export {
  MIN_ZOOM,
  MAX_ZOOM,
  WHEEL_ZOOM_SENSITIVITY,
  clampZoom,
  screenToCanvas,
  canvasToScreen,
  zoomAroundScreenPoint,
  zoomFromWheelDelta,
  distanceBetween,
} from './coordinates'
export type { Point, ViewportState, ContainerOrigin } from './coordinates'

export { ViewportController } from './viewportController'
export type { ViewportControllerOptions, Scheduler } from './viewportController'

export {
  CLICK_DRAG_THRESHOLD_PX,
  PointerGesture,
  judgeGesture,
} from './pointerGesture'
export type { GestureKind, GestureResult, PointerGestureOptions } from './pointerGesture'
