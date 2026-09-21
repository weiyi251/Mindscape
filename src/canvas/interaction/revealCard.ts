// ============================================================================
// 模块说明（中文）
// 「把正在编辑的卡片让到键盘上方」（2026-09-21 移动端适配 M2 · 软键盘聚焦与滚动）。
//
// 问题：安卓弹出软键盘后，屏幕下半部被键盘盖住，而画布的平移量（offset）不会因此变化。
// 用户点便签进入行内编辑时，卡片很可能正好在键盘底下 —— 看得见光标在闪却看不见自己
// 在写什么。桌面无此场景（没有软键盘），所以调用方只在触屏上走这条路，桌面零变化。
//
// 做法：只改视口平移量（`panBy`），不动卡片坐标 —— 卡片位置属于文档数据，
// 为了键盘去写库会把用户的布局改掉，撤销栈也会莫名其妙多出一条。
//
// 键盘出现是滞后的（点下去 → 聚焦 → 系统弹键盘约一两百毫秒），期间可视视口高度才缩小。
// 因此除了「进入编辑时让一次」，还要在 `visualViewport` 变化时再让一次，
// 见 onVisualViewportResize（事件源注入，node 环境可单测）。
// ============================================================================

import type { ViewportState } from './coordinates'
import { safeZoom } from './coordinates'

/** 画布坐标系下的矩形（Card / Partition 都满足：x / y / w / h） */
export interface RevealTarget {
  x: number
  y: number
  w: number
  h: number
}

export interface RevealSize {
  width: number
  height: number
}

export interface RevealOptions {
  /**
   * 安全区高度占容器高度的比例。默认 0.55 —— 安卓软键盘约占半屏到 2/3 屏，
   * 留 45% 给键盘，卡片落在剩下那块的上沿附近。真机手感若偏，调这一处即可。
   */
  safeHeightRatio?: number
  /** 安全区四周余量（CSS 像素），默认 16 */
  marginPx?: number
}

/** 需要把视口平移多少才能把目标矩形带进安全区（null = 已经在安全区内，不用动） */
export interface RevealDelta {
  dx: number
  dy: number
}

const DEFAULT_SAFE_HEIGHT_RATIO = 0.55
const DEFAULT_MARGIN_PX = 16

/**
 * 纯几何：给定视口与容器尺寸，算出「让目标矩形进入键盘上方安全区」的平移增量。
 *
 * 约定：一切都在**容器坐标**（屏幕坐标减去容器左上角）里算，因为平移增量与作用点无关，
 * 这样函数不需要知道容器在屏幕上的位置（getBoundingClientRect 留给调用方）。
 */
export function panToReveal(
  viewport: ViewportState,
  size: RevealSize,
  target: RevealTarget,
  options: RevealOptions = {},
): RevealDelta | null {
  const margin = options.marginPx ?? DEFAULT_MARGIN_PX
  const ratio = options.safeHeightRatio ?? DEFAULT_SAFE_HEIGHT_RATIO
  const zoom = safeZoom(viewport.zoom)

  const boxWidth = size.width - margin * 2
  const boxHeight = size.height * ratio - margin * 2
  // 容器太小（分屏 / 还没布局完）时不做的事：让位会把画面推到负尺寸
  if (!(boxWidth > 0) || !(boxHeight > 0)) return null

  const left = target.x * zoom + viewport.offsetX
  const top = target.y * zoom + viewport.offsetY
  const width = target.w * zoom
  const height = target.h * zoom

  let dx = 0
  let dy = 0

  // 横向：越界就按越界量拉回来（不居中，避免小卡片在横拖时被甩到画面中间）
  if (left + width > margin + boxWidth) dx = margin + boxWidth - (left + width)
  else if (left < margin) dx = margin - left

  // 纵向：卡片比安全区高 → 顶部对齐（正文从键盘上方开始读）；否则落在安全区中线
  if (top < margin || top + height > margin + boxHeight) {
    const desiredTop =
      height >= boxHeight ? margin : margin + (boxHeight - Math.min(height, boxHeight)) / 2
    dy = desiredTop - top
  }

  if (dx === 0 && dy === 0) return null
  return { dx, dy }
}

/** 只要求「有平移能力 + 能读到当前视口与尺寸」，因此 fake 对象可单测 */
export interface RevealController {
  getState(): ViewportState
  getViewportSize(): RevealSize
  panBy(dx: number, dy: number): void
}

/**
 * 把一张卡片让进安全区。返回是否真的动了（调用方可据此决定要不要提示）。
 * 控制器为空（画布还没就绪）或目标不在集合里都安静退出。
 */
export function revealCard(
  controller: RevealController | null,
  target: RevealTarget | null | undefined,
  options?: RevealOptions,
): boolean {
  if (!controller || !target) return false
  const delta = panToReveal(controller.getState(), controller.getViewportSize(), target, options)
  if (!delta) return false
  controller.panBy(delta.dx, delta.dy)
  return true
}

/** visualViewport 的最小契约（node 环境可传假对象） */
export interface VisualViewportLike {
  addEventListener(type: 'resize', listener: () => void): void
  removeEventListener(type: 'resize', listener: () => void): void
}

/**
 * 订阅可视视口尺寸变化（键盘弹出 / 收起），返回退订函数。
 * 桌面 WebView2 上 `window.visualViewport` 存在但尺寸不随键盘变，
 * 所以这条订阅在桌面上是无害的空转 —— 调用方本就用平台能力表短路。
 */
export function onVisualViewportResize(
  viewport: VisualViewportLike | null | undefined,
  onResize: () => void,
): () => void {
  if (!viewport) return () => {}
  viewport.addEventListener('resize', onResize)
  return () => viewport.removeEventListener('resize', onResize)
}
