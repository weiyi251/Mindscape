// ============================================================================
// 模块说明（中文）
// 画布浮层（2026-09-21 移动端适配 M2 / M3 从 Canvas.tsx 外抽）。
//
// 两块内容：左下角状态条（卡片数 / 缩放百分比 / 帧率 / 操作提示）与右下角视图按钮。
// 之所以整块搬出 Canvas.tsx：Canvas 有 1190 行的架构棘轮（规则 1），而移动端要在
// 这里加一套与桌面完全不同的按钮（44px 点按区 + 「框选」模式开关），留在原文件里
// 塞不下。搬出来之后桌面 / 移动两套按钮集中在一个文件里，中文文案则再抽到
// canvasOverlayText.ts（fast-refresh 规则：组件文件只导出组件）。
//
// ⚠️ 缩放百分比仍走 `zoomLabelRef` 直写 textContent，不是 props —— 视口每帧都在变，
// 进 React state 会违反 17.3 的手感红线。
//
// 本组件是纯展示层：判定（是否触屏）与动作（适应 / 复位）全部由 Canvas 传入。
// ============================================================================

import type { RefObject } from 'react'

import { cn } from '@/lib/utils'
import { CANVAS_OVERLAY_TEXT } from './canvasOverlayText'
import { FpsMeter } from './FpsMeter'
import { CanvasTouchToolbar } from './CanvasTouchToolbar'

const DESKTOP_BUTTON_CLASS =
  'rounded border border-border bg-card/90 px-2 py-1 text-xs text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground'

export interface CanvasOverlayProps {
  /** 卡片总数（状态条左侧） */
  cardCount: number
  /** 缩放百分比的直写目标（见文件头的 ⚠️） */
  zoomLabelRef: RefObject<HTMLSpanElement>
  /** 触屏口径：true 时换一套短按钮与手势提示 */
  touch: boolean
  /** 「选择模式」（框选）是否开启，仅触屏渲染 */
  selectMode: boolean
  onSelectModeChange: (next: boolean) => void
  /** 缩放到全部内容 */
  onFit: () => void
  /** 复原视图 100% */
  onReset: () => void
}

export function CanvasOverlay({
  cardCount,
  zoomLabelRef,
  touch,
  selectMode,
  onSelectModeChange,
  onFit,
  onReset,
}: CanvasOverlayProps) {
  return (
    <>
      {/* 状态条：卡片数 / 缩放百分比 / 帧率 / 操作提示 */}
      <div
        className={cn(
          'pointer-events-none absolute bottom-3 left-3 flex items-center gap-3 rounded border border-border bg-card/90 px-2 py-1 text-xs text-muted-foreground shadow-sm',
          // 触屏上状态条窄屏放不下整句提示，允许换行且不遮内容
          touch && 'max-w-[calc(100%-1.5rem)] flex-wrap gap-y-1',
        )}
      >
        <span>
          {cardCount} {CANVAS_OVERLAY_TEXT.cardsCount}
        </span>
        <span className="text-border">|</span>
        <span ref={zoomLabelRef}>100%</span>
        {/* 帧率表只服务于开发期手感验收（11.2 ~ 11.4），正式构建不渲染 */}
        {import.meta.env.DEV ? (
          <>
            <span className="text-border">|</span>
            <FpsMeter />
          </>
        ) : null}
        <span className="text-border">|</span>
        <span>{touch ? CANVAS_OVERLAY_TEXT.touchHint : CANVAS_OVERLAY_TEXT.desktopHint}</span>
      </div>

      <div className="absolute bottom-3 right-3 flex items-center gap-2">
        {touch ? (
          <CanvasTouchToolbar
            selectMode={selectMode}
            onSelectModeChange={onSelectModeChange}
            onFit={onFit}
            onReset={onReset}
          />
        ) : (
          <>
            <button type="button" className={DESKTOP_BUTTON_CLASS} onClick={onFit}>
              {CANVAS_OVERLAY_TEXT.desktopFit}
            </button>
            <button type="button" className={DESKTOP_BUTTON_CLASS} onClick={onReset}>
              {CANVAS_OVERLAY_TEXT.desktopReset}
            </button>
          </>
        )}
      </div>
    </>
  )
}
