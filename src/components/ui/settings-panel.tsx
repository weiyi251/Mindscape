// ============================================================================
// 模块说明（中文）
// 设置面板（2026-09-12 新增）：把不常用的系统类操作统一收进一个浮层面板，
// 替代原先铺满顶栏的散装按钮 —— 外观（深浅主题）、视图（显示已移除）、
// 检查更新（显示当前版本号与最新版本号）。
//
// 两处复用（2026-09-12 用户裁决）：画布页 Board 与空间列表页 SpaceList 挂的是**同一组件**，
// 功能与样式天然一致；差异只有两处，均由 props 控制：
//   · panelClassName —— 定位（两处都挂在设置按钮的 relative 容器内，跟随按钮下沿展开）；
//   · onToggleRemovedView —— 「显示已移除」只对空间内有意义，主界面不传即不渲染该行。
//
// 复用既有设施：更新流程全部走 updaterStore（弹窗 UpdateDialog 挂在 App 层），
// 面板里只负责「发起检查 + 展示状态与版本号」；主题偏好走 core/hooks/useTheme（底层 theme.ts）。
//
// 响应式：宽度 min(288px, 视口-24px)，超高时内部滚动，小窗口不溢出。
// ============================================================================

import { useEffect, useState } from 'react'
import { getVersion } from '@tauri-apps/api/app'

import { Button } from './button'
import { SETTINGS_TEXT, updateStatusLine } from './settingsText'
import { cn } from '@/lib/utils'
import { useUpdaterStore } from '@/core/store/updaterStore'

export interface SettingsPanelProps {
  open: boolean
  onClose: () => void
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  /**
   * 面板定位类（默认贴页面右上角）。推荐把面板放进设置按钮的 `relative` 容器，
   * 传 `right-0 top-full mt-2` —— 面板跟随按钮下沿展开，头部高度 / 窗口宽度变化都不会错位。
   */
  panelClassName?: string
  /** 是否处于「已移除」视图（仅空间内使用） */
  removedView?: boolean
  /** 已移除卡片数量（仅空间内使用，用于按钮上的计数） */
  removedCount?: number
  /** 切换「已移除」视图（仅空间内使用）；不传 → 该行不渲染（主界面无此概念） */
  onToggleRemovedView?: () => void
}

export function SettingsPanel({
  open,
  onClose,
  theme,
  onToggleTheme,
  panelClassName = 'right-3 top-12',
  removedView = false,
  removedCount = 0,
  onToggleRemovedView,
}: SettingsPanelProps) {
  // 更新状态直接订阅共享 store（与启动静默检查 / UpdateDialog 同源，状态互不打架）
  const updateStatus = useUpdaterStore((s) => s.status)
  const updateVersion = useUpdaterStore((s) => s.version)
  const checkUpdate = useUpdaterStore((s) => s.check)

  // 当前版本号来自 Tauri（tauri.conf.json 的 version）；非桌面环境读不到就显示未知
  const [currentVersion, setCurrentVersion] = useState('')
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void getVersion()
      .then((value) => {
        if (!cancelled) setCurrentVersion(value)
      })
      .catch(() => {
        // 非桌面运行时：保持「未知」
      })
    return () => {
      cancelled = true
    }
  }, [open])

  if (!open) return null

  return (
    <>
      {/* 点击面板以外任意处关闭（透明遮罩不挡视觉，只收点击） */}
      <div className="fixed inset-0 z-30" onPointerDown={onClose} />

      <div
        data-settings-panel=""
        className={cn(
          'absolute z-40 flex max-h-[calc(100vh-64px)] w-72 max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-lg border border-border bg-background shadow-lg',
          panelClassName,
        )}
      >
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-border/60 px-3">
          <span className="text-[13px] font-medium text-foreground/90">{SETTINGS_TEXT.title}</span>
          <button
            type="button"
            onClick={onClose}
            title={SETTINGS_TEXT.close}
            className="flex h-5 w-5 items-center justify-center rounded text-[11px] leading-none text-foreground/60 hover:bg-foreground/10"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3">
          {/* ---- 外观与视图 ---- */}
          <section className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {SETTINGS_TEXT.appearanceTitle}
            </p>
            <Button variant="outline" size="sm" className="w-full justify-start" onClick={onToggleTheme}>
              {theme === 'dark' ? SETTINGS_TEXT.toLight : SETTINGS_TEXT.toDark}
            </Button>
            {/* 「显示已移除」只在空间内出现（主界面没有已移除卡片的概念） */}
            {onToggleRemovedView ? (
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={onToggleRemovedView}
              >
                {removedView
                  ? SETTINGS_TEXT.removedBack
                  : `${SETTINGS_TEXT.removedShow}${removedCount > 0 ? `（${removedCount}）` : ''}`}
              </Button>
            ) : null}
          </section>

          {/* ---- 检查更新 ---- */}
          <section className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {SETTINGS_TEXT.updateTitle}
            </p>
            <div className="space-y-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{SETTINGS_TEXT.currentVersion}</span>
                <span className="font-medium text-foreground/90">
                  v{currentVersion || SETTINGS_TEXT.unknownVersion}
                </span>
              </div>
              {updateStatus === 'available' && updateVersion ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{SETTINGS_TEXT.latestVersion}</span>
                  <span className="font-medium text-primary">v{updateVersion}</span>
                </div>
              ) : null}
              <div className="pt-0.5 text-muted-foreground">
                {updateStatusLine(updateStatus, updateVersion)}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start"
              // 非静默检查：结果（发现新版 / 已是最新 / 失败）都会经 UpdateDialog 明确展示
              disabled={updateStatus === 'checking' || updateStatus === 'downloading'}
              onClick={() => void checkUpdate({ silent: false })}
            >
              {SETTINGS_TEXT.checkNow}
            </Button>
          </section>
        </div>
      </div>
    </>
  )
}
