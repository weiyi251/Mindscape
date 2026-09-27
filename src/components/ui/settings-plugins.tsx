// ============================================================================
// 模块说明（中文）
// 设置面板「插件」页主体。
//
// 页面职责（对应需求「统一管理插件：查看列表、启用 / 停用、卸载、更新」）：
//   · 列表    —— 内置 + 已落盘的外部插件，含状态与来源
//   · 启停    —— 主开关；停用前弹确认（注册会立刻从界面消失）
//   · 详情    —— 展开看元信息、已注册内容、插件配置
//   · 卸载    —— 外部插件专属；确认后删除安装目录（配置保留）
//   · 更新    —— 外部插件「重新加载」：重读磁盘上的清单与入口
//   · 刷新    —— 重新扫描插件目录（用户手动放入插件后点它）
//
// 状态来自 core/store/pluginsStore（宿主 pluginHost 的订阅者），
// 本组件只负责交互编排与渲染。
// ============================================================================

import { useCallback, useEffect, useState } from 'react'

import { isActive } from '@/core/plugin/lifecycle'
import { getPluginsRootDir } from '@/core/plugin/pluginStoreFile'
import { PLUGIN_TEXT } from '@/core/plugin/pluginText'
import type { PluginRecord } from '@/core/plugin/types'
import { localStorageProvider } from '@/core/storage/LocalFolderProvider'
import { supportsCapability } from '@/core/system/platformCapabilities'
import { usePluginsStore } from '@/core/store/pluginsStore'
import { confirmDialog } from '@/core/utils/nativeDialogs'
import { isDesktopRuntime } from '@/core/utils/runtime'
import { PluginDetail } from './plugin-detail'
import { PluginListItem } from './plugin-list-item'

/** 小按钮统一样式（刷新 / 打开目录）。
 *  窄屏给满 44px 触控高度（M3 的 button.tsx 只覆盖了 Button 组件，
 *  这里的手写按钮自己满足条件；`min-h` 用 sm 挡回去，桌面高度一字不变） */
const ACTION_BUTTON =
  'flex min-h-[44px] items-center justify-center rounded border border-border px-3 text-xs text-foreground transition-colors hover:bg-muted sm:min-h-0 sm:px-2 sm:py-0.5 sm:text-[11px]'

export function SettingsPluginsPage() {
  const plugins = usePluginsStore((state) => state.plugins)
  const status = usePluginsStore((state) => state.status)
  const error = usePluginsStore((state) => state.error)
  const actionError = usePluginsStore((state) => state.actionError)
  const pendingId = usePluginsStore((state) => state.pendingId)
  const load = usePluginsStore((state) => state.load)
  const enable = usePluginsStore((state) => state.enable)
  const disable = usePluginsStore((state) => state.disable)
  const uninstall = usePluginsStore((state) => state.uninstall)
  const reload = usePluginsStore((state) => state.reload)
  const refresh = usePluginsStore((state) => state.refresh)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  /** 本地提示（打开目录失败等不属插件操作本身的错误） */
  const [notice, setNotice] = useState<string | null>(null)
  const canOpenWithSystemApp = supportsCapability('openWithSystemApp')

  useEffect(() => {
    void load()
  }, [load])

  const handleToggle = useCallback(
    async (plugin: PluginRecord) => {
      setNotice(null)
      if (isActive(plugin.state)) {
        const confirmed = await confirmDialog(
          PLUGIN_TEXT.disableMessage(plugin.name),
          PLUGIN_TEXT.disableTitle,
        )
        if (!confirmed) return
        await disable(plugin.id)
        return
      }
      await enable(plugin.id)
    },
    [disable, enable],
  )

  const handleUninstall = useCallback(
    async (plugin: PluginRecord) => {
      setNotice(null)
      const confirmed = await confirmDialog(
        PLUGIN_TEXT.uninstallMessage(plugin.name),
        PLUGIN_TEXT.uninstallTitle,
      )
      if (!confirmed) return
      await uninstall(plugin.id)
      setExpandedId(null)
    },
    [uninstall],
  )

  const handleOpenDir = useCallback(async () => {
    setNotice(null)
    if (!isDesktopRuntime()) {
      setNotice('浏览器开发态没有本地文件系统，请在桌面应用中打开插件目录。')
      return
    }
    try {
      const dir = await getPluginsRootDir()
      // 首次运行时目录可能还不存在，先幂等创建
      await localStorageProvider.createDir(dir)
      await localStorageProvider.openWithDefault(dir)
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  return (
    // 窄屏：分组之间留更大间距、正文字号从 11px 提到 12px（「太满」的一半来自这些信息密度）
    <div className="space-y-3 sm:space-y-2">
      <p className="text-xs leading-relaxed text-muted-foreground sm:text-[11px] sm:leading-snug">
        {PLUGIN_TEXT.pageHint}
      </p>

      <div className="flex flex-wrap items-center gap-2 sm:gap-2">
        <button type="button" className={ACTION_BUTTON} onClick={() => void refresh()}>
          {PLUGIN_TEXT.refresh}
        </button>
        {/* M4（2026-09-21）：插件目录在安卓既没有文件管理器可开、opener 通道也走不通
            （能力表 `openWithSystemApp` 注释里逐条列了），入口直接不给 */}
        {canOpenWithSystemApp ? (
          <button type="button" className={ACTION_BUTTON} onClick={() => void handleOpenDir()}>
            {PLUGIN_TEXT.openDir}
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs leading-relaxed text-destructive sm:px-2 sm:py-1.5 sm:text-[11px] sm:leading-snug">
          {error}
        </p>
      ) : null}
      {actionError ? (
        <p className="rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs leading-relaxed text-destructive sm:px-2 sm:py-1.5 sm:text-[11px] sm:leading-snug">
          {actionError}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground sm:px-2 sm:py-1.5 sm:text-[11px] sm:leading-snug">
          {notice}
        </p>
      ) : null}

      {status === 'loading' && plugins.length === 0 ? (
        <p className="text-xs text-muted-foreground">正在读取插件…</p>
      ) : null}

      {plugins.length === 0 && status !== 'loading' ? (
        <div className="rounded border border-border px-3 py-4 sm:px-2 sm:py-3">
          <p className="text-sm text-muted-foreground sm:text-xs">{PLUGIN_TEXT.empty}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground sm:text-[11px] sm:leading-snug">
            {PLUGIN_TEXT.emptyExternalHint}
          </p>
        </div>
      ) : null}

      <div className="space-y-2.5 sm:space-y-1.5">
        {plugins.map((plugin) => (
          <div key={plugin.id}>
            <PluginListItem
              plugin={plugin}
              pending={pendingId === plugin.id}
              expanded={expandedId === plugin.id}
              onToggle={(item) => void handleToggle(item)}
              onToggleDetail={(item) =>
                setExpandedId((current) => (current === item.id ? null : item.id))
              }
            />
            {expandedId === plugin.id ? (
              <PluginDetail
                plugin={plugin}
                pending={pendingId === plugin.id}
                onUninstall={(item) => void handleUninstall(item)}
                onReload={(item) => void reload(item.id)}
              />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}
