// ============================================================================
// 模块说明（中文）
// 移动端画布浮层工具条（2026-09-21 移动端适配 M2，决策 D4「手势优先 + 兜底按钮」）。
//
// 桌面版右下角那两个按钮（适应内容 / 复原视图）在手机上不能用：中文标签太长挤不下、
// 点按区不足 44px，括号里的快捷键提示（Ctrl+0）更是无从按起。这里给移动端一套
// 等价的紧凑按钮，外加一个桌面没有的**「框选」模式开关** —— 触屏没有 Ctrl，
// 而框选是批量选中 / 批量拖动的唯一入口，所以必须留一个按钮兜底（D4）。
//
// 本组件不做判定：是否渲染由 Canvas 按平台能力表（touchGestures）决定，
// 四个动作也全部由上层传入，这里只负责「够大的按钮 + 中文短标签」。
// 标签集中在 canvasOverlayText.ts（AGENTS.md：中文文案进常量表；同时让本文件
// 只导出组件，满足 fast-refresh 规则）。
//
// M3（2026-09-21）补「搜索」入口：桌面的搜索浮层只有 Ctrl+F 一个入口，触屏没有键盘
// 就永远打不开，因此按 D4 在这里兜一个按钮（`onSearch` 未传时不渲染）。
// ⚠️ 半透明底一律走 .glass-chip（外观系统的玻璃浮件：纯 rgba 底，**没有
// backdrop-filter**）——落到 backdrop-filter 上，17.11 明令禁止（WebView2 下严重掉帧）。
// ============================================================================

import { cn } from '@/lib/utils'
import { CANVAS_TOUCH_TOOLBAR_TEXT } from './canvasOverlayText'

const BUTTON_CLASS =
  'min-h-[44px] min-w-[56px] rounded-lg border border-border glass-chip px-3 text-sm ' +
  'text-muted-foreground'

export interface CanvasTouchToolbarProps {
  /** 「选择模式」是否开启：开启后单指拖空白 = 框选而不是平移 */
  selectMode: boolean
  onSelectModeChange: (next: boolean) => void
  /** 打开搜索浮层（桌面等价动作是 Ctrl+F）；不传则不渲染该按钮 */
  onSearch?: () => void
  /** 缩放到全部内容（与桌面 Ctrl+Alt+0 同一个动作） */
  onFit: () => void
  /** 复原视图 100%（与桌面 Ctrl+0 同一个动作） */
  onReset: () => void
}

export function CanvasTouchToolbar({
  selectMode,
  onSelectModeChange,
  onSearch,
  onFit,
  onReset,
}: CanvasTouchToolbarProps) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-pressed={selectMode}
        className={cn(
          BUTTON_CLASS,
          selectMode ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted',
        )}
        onClick={() => onSelectModeChange(!selectMode)}
      >
        {selectMode ? CANVAS_TOUCH_TOOLBAR_TEXT.selectOn : CANVAS_TOUCH_TOOLBAR_TEXT.select}
      </button>
      {onSearch ? (
        <button type="button" className={BUTTON_CLASS} onClick={onSearch}>
          {CANVAS_TOUCH_TOOLBAR_TEXT.search}
        </button>
      ) : null}
      <button type="button" className={BUTTON_CLASS} onClick={onFit}>
        {CANVAS_TOUCH_TOOLBAR_TEXT.fit}
      </button>
      <button type="button" className={BUTTON_CLASS} onClick={onReset}>
        {CANVAS_TOUCH_TOOLBAR_TEXT.reset}
      </button>
    </div>
  )
}
