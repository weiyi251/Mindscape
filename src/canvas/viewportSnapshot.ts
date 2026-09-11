// ============================================================================
// 模块说明（中文）
// 视口状态的「影子快照」。对应 T1.6：layout.json 要保存 canvas 的 zoom / offset。
//
// 【为什么不让 boardStore 直接持有】
//   视口每帧都在变（17.3 铁律：不进 React state）。若塞进 Zustand，每帧都会
//   触发整棵画布子树重渲染，手感立刻崩掉。
//   这里用一个模块级的普通对象承接最新值：Canvas 每帧写入（零成本），
//   落盘时读一次即可。它不参与任何渲染。
//
// 实现任务：T1.6（阶段一）。
// ============================================================================

import type { ViewportState } from './interaction/coordinates'

const DEFAULT_VIEWPORT: ViewportState = { zoom: 1, offsetX: 0, offsetY: 0 }

let snapshot: ViewportState = { ...DEFAULT_VIEWPORT }

/** Canvas 每次视口变化时调用（已按帧合并，不会比渲染更频繁） */
export function setViewportSnapshot(state: ViewportState): void {
  snapshot = { zoom: state.zoom, offsetX: state.offsetX, offsetY: state.offsetY }
}

/** 取当前视口状态（落盘 / 切换空间时用），返回副本，调用方改不到内部状态 */
export function getViewportSnapshot(): ViewportState {
  return { ...snapshot }
}

/** 离开空间时复位，避免下一个空间误用上一个空间的视图 */
export function resetViewportSnapshot(): void {
  snapshot = { ...DEFAULT_VIEWPORT }
}
