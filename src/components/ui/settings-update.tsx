// ============================================================================
// 模块说明（中文）
// 设置弹窗「版本更新」页（2026-09-13 从原设置面板拆出，成为独立页面）。
//
// 更新流程全部走 updaterStore（弹窗 UpdateDialog 挂在 App 层），本页只负责
// 「发起检查 + 展示当前版本与最新版本」。页面在切到本页时才挂载，因此版本号
// 读取放在这里的 useEffect 里即可（不必再依赖「面板是否打开」）。
// ============================================================================

import { useEffect, useState } from 'react'
import { getVersion } from '@tauri-apps/api/app'
import { invoke } from '@tauri-apps/api/core'

import { Button } from './button'
import { SETTINGS_TEXT, updateStatusLine } from './settingsText'
import { useUpdaterStore } from '@/core/store/updaterStore'
import { isMobileRuntime } from '@/core/utils/runtime'

export function SettingsUpdatePage() {
  // 更新状态直接订阅共享 store（与启动静默检查 / UpdateDialog 同源，状态互不打架）
  const updateStatus = useUpdaterStore((state) => state.status)
  const updateVersion = useUpdaterStore((state) => state.version)
  const checkUpdate = useUpdaterStore((state) => state.check)

  // 当前版本号来自 Tauri（tauri.conf.json 的 version）；非桌面环境读不到就显示未知
  const [currentVersion, setCurrentVersion] = useState('')
  useEffect(() => {
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
  }, [])

  // 移动端分支：安卓侧载没有 updater 渠道（插件只在桌面装配），不渲染检查按钮，
  // 引导用户到发布页下载 APK 覆盖安装（open_release_page 走 Rust，浏览器里可走用户自己的代理）
  const [openError, setOpenError] = useState(false)
  if (isMobileRuntime()) {
    return (
      <section className="space-y-2" data-settings-update="mobile">
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
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">{SETTINGS_TEXT.updateMobileHint}</p>

        <Button
          variant="outline"
          size="sm"
          className="h-11 w-full justify-start sm:h-auto"
          onClick={() => {
            setOpenError(false)
            void invoke('open_release_page').catch(() => setOpenError(true))
          }}
        >
          {SETTINGS_TEXT.openReleasePage}
        </Button>
        {openError ? <p className="text-xs text-destructive">{SETTINGS_TEXT.openReleaseFailed}</p> : null}
      </section>
    )
  }

  return (
    <section className="space-y-2" data-settings-update="desktop">
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
  )
}
