// ============================================================================
// 模块说明（中文）
// 设置页「插件」的详情面板：元信息 + 已注册内容 + 插件配置 + 卸载 / 重新加载。
//
// 与 plugin-list-item 一样是纯展示组件：可用性判定走 core/plugin/lifecycle.ts，
// 真正的动作由父组件（settings-plugins.tsx）负责（含用户确认框）。
// ============================================================================

import { cn } from '@/lib/utils'
import { canReload, canUninstall, hasNoContributions } from '@/core/plugin/lifecycle'
import {
  contributionsLine,
  PLUGIN_TEXT,
  pluginSourceLabel,
  pluginStateLabel,
} from '@/core/plugin/pluginText'
import type { PluginRecord } from '@/core/plugin/types'

export interface PluginDetailProps {
  plugin: PluginRecord
  pending: boolean
  onUninstall: (plugin: PluginRecord) => void
  onReload: (plugin: PluginRecord) => void
}

function Row({ label, value }: { label: string; value: string }) {
  // 窄屏：标签列放宽到 20（4 个字符的名最小值够用）、行高提到 24px、字号 12px
  return (
    <div className="flex gap-2 text-xs leading-6 sm:text-[11px] sm:leading-5">
      <span className="w-20 shrink-0 text-muted-foreground sm:w-16">{label}</span>
      <span className="min-w-0 flex-1 break-all text-foreground">{value}</span>
    </div>
  )
}

/** 详情里的两个操作按钮：窄屏给满 44px 触控高度（桌面回落原尺寸） */
const DETAIL_ACTION_BASE =
  'flex min-h-[44px] items-center justify-center rounded border px-3 text-xs transition-colors sm:min-h-0 sm:px-2 sm:py-0.5 sm:text-[11px]'

export function PluginDetail({ plugin, pending, onUninstall, onReload }: PluginDetailProps) {
  const contributions = contributionsLine(plugin.contributions)
  const configKeys = Object.keys(plugin.config)

  return (
    <div className="mt-2 space-y-2.5 rounded border border-border bg-muted/40 px-3 py-3 sm:mt-1 sm:px-2 sm:py-2">
      {plugin.description ? (
        <p className="text-xs leading-relaxed text-muted-foreground sm:text-[11px] sm:leading-snug">
          {plugin.description}
        </p>
      ) : null}

      <div>
        <Row label={PLUGIN_TEXT.versionLabel} value={`v${plugin.version}`} />
        <Row label={PLUGIN_TEXT.sourceLabel} value={pluginSourceLabel(plugin.source)} />
        <Row label={PLUGIN_TEXT.stateLabel} value={pluginStateLabel(plugin.state)} />
        {plugin.author ? <Row label={PLUGIN_TEXT.authorLabel} value={plugin.author} /> : null}
        {plugin.installDir ? <Row label={PLUGIN_TEXT.pathLabel} value={plugin.installDir} /> : null}
        <Row
          label={PLUGIN_TEXT.contributionsLabel}
          value={contributions || PLUGIN_TEXT.noContributions}
        />
        {configKeys.length > 0 ? (
          <Row label={PLUGIN_TEXT.configLabel} value={JSON.stringify(plugin.config)} />
        ) : (
          <Row label={PLUGIN_TEXT.configLabel} value={PLUGIN_TEXT.noConfig} />
        )}
      </div>

      {/* 出错时把完整原因放进详情（列表行里可能被截断） */}
      {plugin.detail && plugin.state !== 'active' ? (
        <p className="text-xs leading-relaxed text-destructive sm:text-[11px] sm:leading-snug">
          {plugin.detail}
        </p>
      ) : null}
      {plugin.state === 'active' && hasNoContributions(plugin.contributions) ? (
        <p className="text-xs leading-relaxed text-muted-foreground sm:text-[11px] sm:leading-snug">
          已启用（未注册任何内容）
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 pt-1 sm:pt-0.5">
        {canReload(plugin) ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => onReload(plugin)}
            className={cn(DETAIL_ACTION_BASE, 'border-border text-foreground hover:bg-muted')}
          >
            {PLUGIN_TEXT.reload}
          </button>
        ) : null}

        {canUninstall(plugin) ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => onUninstall(plugin)}
            className={cn(
              DETAIL_ACTION_BASE,
              'border-destructive/40 text-destructive hover:bg-destructive/10',
            )}
          >
            {PLUGIN_TEXT.uninstall}
          </button>
        ) : (
          <span className="text-xs leading-relaxed text-muted-foreground sm:text-[11px] sm:leading-snug">
            {PLUGIN_TEXT.builtinNotice}
          </span>
        )}
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground sm:text-[11px] sm:leading-snug">
        {plugin.source === 'external'
          ? PLUGIN_TEXT.externalVersionNote(plugin.version)
          : PLUGIN_TEXT.builtinVersionNote(plugin.version)}
      </p>
    </div>
  )
}
