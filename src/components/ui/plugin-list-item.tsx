// ============================================================================
// 模块说明（中文）
// 设置页「插件」列表的单行组件。
//
// 纯展示 + 两个回调（主开关 / 展开详情），不含任何业务逻辑 ——
// 「能不能启用」「按钮写什么」都由 core/plugin/lifecycle.ts 的纯函数回答，
// 这样组件既薄又不用为它引入 jsdom 测试。
// ============================================================================

import { cn } from '@/lib/utils'
import { canDisable, canEnable, isActive, isProblematic } from '@/core/plugin/lifecycle'
import { PLUGIN_TEXT, pluginSubtitle } from '@/core/plugin/pluginText'
import type { PluginRecord } from '@/core/plugin/types'

export interface PluginListItemProps {
  plugin: PluginRecord
  /** 该插件有操作正在进行（按钮禁用） */
  pending: boolean
  /** 详情面板是否已展开 */
  expanded: boolean
  onToggle: (plugin: PluginRecord) => void
  onToggleDetail: (plugin: PluginRecord) => void
}

export function PluginListItem({
  plugin,
  pending,
  expanded,
  onToggle,
  onToggleDetail,
}: PluginListItemProps) {
  const active = isActive(plugin.state)
  const toggleEnabled = active ? canDisable(plugin) : canEnable(plugin)
  const problematic = isProblematic(plugin.state)

  return (
    // 窄屏：行盒加高、左右留白给到 12px、字号提一档（2026-09-28「太满」）
    <div className="rounded border border-border px-3 py-2.5 sm:px-2 sm:py-1.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground sm:text-xs">
            {plugin.name}
          </div>
          <div
            className={cn(
              'truncate text-xs sm:text-[11px]',
              problematic ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {pluginSubtitle(plugin)}
          </div>
        </div>

        <button
          type="button"
          disabled={!toggleEnabled || pending}
          onClick={() => onToggle(plugin)}
          className={cn(
            // 两个按钮在窄屏都给满 44px 触控高度（桌面回落到原来的 py-0.5）
            'flex min-h-[44px] shrink-0 items-center justify-center rounded border border-border px-3 text-xs transition-colors sm:min-h-0 sm:px-2 sm:py-0.5 sm:text-[11px]',
            toggleEnabled && !pending
              ? 'text-foreground hover:bg-muted'
              : 'cursor-default text-muted-foreground',
          )}
        >
          {active ? PLUGIN_TEXT.disable : PLUGIN_TEXT.enable}
        </button>

        <button
          type="button"
          onClick={() => onToggleDetail(plugin)}
          aria-expanded={expanded}
          className="flex min-h-[44px] shrink-0 items-center justify-center rounded px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:min-h-0 sm:px-1.5 sm:py-0.5 sm:text-[11px]"
        >
          {expanded ? '收起' : PLUGIN_TEXT.detail}
        </button>
      </div>

      {/* 不可用 / 出错时，行内直接给出中文原因，不必展开详情 */}
      {problematic && plugin.detail ? (
        <p className="mt-1.5 text-xs leading-relaxed text-destructive sm:mt-1 sm:text-[11px] sm:leading-snug">
          {plugin.detail}
        </p>
      ) : null}
    </div>
  )
}
