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
    <div className="rounded border border-border px-2 py-1.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-foreground">{plugin.name}</div>
          <div
            className={cn(
              'truncate text-[11px]',
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
            'shrink-0 rounded border border-border px-2 py-0.5 text-[11px] transition-colors',
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
          className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {expanded ? '收起' : PLUGIN_TEXT.detail}
        </button>
      </div>

      {/* 不可用 / 出错时，行内直接给出中文原因，不必展开详情 */}
      {problematic && plugin.detail ? (
        <p className="mt-1 text-[11px] leading-snug text-destructive">{plugin.detail}</p>
      ) : null}
    </div>
  )
}
