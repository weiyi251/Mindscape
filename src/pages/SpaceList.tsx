// ============================================================================
// 模块说明（中文）
// 空间列表页。对应 T1.1 / T1.2：
//   · 卡片式排列已建的空间（名称 / 类型 / 文件夹路径 / 最近打开时间）
//   · 新建空间：命名 + 类型选择 + 选文件夹（Tauri dialog）→ 写入 spaces.json
//   · 点击卡片进入画布（T1.3 起真正读文件夹）
//
// 数据来源是 spacesStore（Zustand），本组件不发任何 Tauri 调用，只做展示与交互。
//
// 顶栏入口（2026-09-12 用户裁决）：全部收敛成**纯图标**——
//   · ＋ 新建空间（原为带文字的按钮）；
//   · ⚙ 设置：挂 SettingsPanel，与空间内（Board）**同一个组件**，
//     功能与样式完全一致；「检查更新」（原独立按钮）随之收进面板。
//     两处的差异只有一项：「显示已移除」只对空间内有意义，主界面不传该回调 → 不渲染。
//     图标按钮一律用 aria-label / title 承载语义（无文字）。
//
// 实现任务：T1.1 / T1.2（阶段一）。
// ============================================================================

import { useCallback, useMemo, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'

import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { SettingsPanel } from '@/components/ui/settings-panel'
import { PlusIcon, SettingsIcon } from '@/components/ui/icons'
import { SPACE_TYPE_PRESETS } from '@/core/types'
import { useTheme } from '@/core/hooks/useTheme'
import { useSpacesStore } from '@/core/store/spacesStore'

/** 自定义类型的哨兵值（选中它时展开输入框） */
const CUSTOM_TYPE = '__custom__'

/** 把 `2026-09-10T11:30:00` 显示成 `2026-09-10 11:30` */
function formatTimestamp(value: string): string {
  const matched = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value)
  return matched ? `${matched[1]} ${matched[2]}` : value
}

export function SpaceList() {
  const spaces = useSpacesStore((state) => state.spaces)
  const status = useSpacesStore((state) => state.status)
  const loadError = useSpacesStore((state) => state.error)
  const corruptedNotice = useSpacesStore((state) => state.corruptedNotice)
  const createSpace = useSpacesStore((state) => state.createSpace)
  const removeSpace = useSpacesStore((state) => state.removeSpace)
  const openSpace = useSpacesStore((state) => state.openSpace)

  /** 主题（2026-09-12）：与空间内共用 useTheme，「外观」一项在主界面同样可用 */
  const { theme, toggle: handleToggleTheme } = useTheme()

  /** 设置面板显隐（2026-09-12）：与空间内同一组件，检查更新收进面板 */
  const [settingsOpen, setSettingsOpen] = useState(false)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [name, setName] = useState('')
  const [typeChoice, setTypeChoice] = useState<string>(SPACE_TYPE_PRESETS[0])
  const [customType, setCustomType] = useState('')
  const [folderPath, setFolderPath] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const effectiveType = typeChoice === CUSTOM_TYPE ? customType.trim() : typeChoice

  const resetForm = useCallback(() => {
    setName('')
    setTypeChoice(SPACE_TYPE_PRESETS[0])
    setCustomType('')
    setFolderPath('')
    setFormError(null)
  }, [])

  const handlePickFolder = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择空间文件夹',
      })
      if (typeof selected === 'string') setFolderPath(selected)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  const handleCreate = useCallback(async () => {
    setFormError(null)
    // 前端先做一次明显校验，真正的唯一性校验在 store 内（同一处规则）
    if (name.trim() === '') {
      setFormError('空间名称不能为空')
      return
    }
    if (folderPath === '') {
      setFormError('请选择空间文件夹')
      return
    }
    if (effectiveType === '') {
      setFormError('请填写自定义类型')
      return
    }

    setBusy(true)
    try {
      await createSpace({ name, type: effectiveType, folderPath })
      setDialogOpen(false)
      resetForm()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }, [createSpace, effectiveType, folderPath, name, resetForm])

  const handleDelete = useCallback(
    async (id: string, spaceName: string) => {
      const confirmed = window.confirm(
        `确定从列表移除「${spaceName}」？\n\n只删除记录，硬盘上的文件夹与文件不会被动。`,
      )
      if (!confirmed) return
      try {
        await removeSpace(id)
      } catch (error) {
        window.alert(error instanceof Error ? error.message : String(error))
      }
    },
    [removeSpace],
  )

  const sortedSpaces = useMemo(() => spaces, [spaces])

  return (
    <div className="relative flex h-full w-full flex-col bg-background">
      {/* flex-wrap + min-w-0：窄窗口时标题先收缩、再换行，图标按钮组不会被挤出去 */}
      <header className="flex flex-wrap items-center justify-between gap-3 gap-y-2 border-b border-border px-8 py-5">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">Mindscape 脑海空间</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            把文件夹变成思考空间 · 空间记录存于 %APPDATA%\Mindscape\spaces.json
          </p>
        </div>
        {/* 图标按钮组：＋ 新建空间 / ⚙ 设置（面板与空间内同一个组件，挂在按钮下沿）。
            ⚠️ ml-auto 是必需的：头部长到换行时按钮组会独占一行，没有 ml-auto 就被
            justify-content 摆到该行**左端**，锚在下沿的面板会跟着跑出视口左侧（480px 实测）
            —— 加上它以后按钮组永远贴右，面板右缘始终跟视口右侧对齐 */}
        <div className="relative ml-auto flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            title="新建空间"
            aria-label="新建空间"
            onClick={() => setDialogOpen(true)}
          >
            <PlusIcon />
          </Button>
          <Button
            variant={settingsOpen ? 'default' : 'outline'}
            size="icon"
            title="设置（主题 / 检查更新）"
            aria-label="设置"
            onClick={() => setSettingsOpen((value) => !value)}
          >
            <SettingsIcon />
          </Button>

          <SettingsPanel
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            theme={theme}
            onToggleTheme={handleToggleTheme}
            panelClassName="right-0 top-full mt-2"
          />
        </div>
      </header>

      <main className="flex-1 overflow-auto px-8 py-6">
        {corruptedNotice ? (
          <div className="mb-4 rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {corruptedNotice}
          </div>
        ) : null}

        {loadError ? (
          <div className="mb-4 rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            读取空间列表失败：{loadError}
          </div>
        ) : null}

        {status === 'loading' && spaces.length === 0 ? (
          <p className="text-sm text-muted-foreground">正在读取空间列表…</p>
        ) : null}

        {status !== 'loading' && sortedSpaces.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-20 text-center">
            <p className="text-sm text-muted-foreground">还没有空间</p>
            <p className="mt-1 text-xs text-muted-foreground">
              点右上角的 ＋ 按钮新建空间，选一个已有文件夹即可开始
            </p>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {sortedSpaces.map((space) => (
            <div
              key={space.id}
              className="group relative flex cursor-pointer flex-col rounded-lg border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
              onClick={() => {
                void openSpace(space.id)
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="truncate font-medium" title={space.name}>
                  {space.name}
                </h2>
                <button
                  type="button"
                  aria-label={`移除空间 ${space.name}`}
                  className="shrink-0 rounded px-1.5 text-xs text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-destructive group-hover:opacity-100"
                  onClick={(event) => {
                    event.stopPropagation()
                    void handleDelete(space.id, space.name)
                  }}
                >
                  移除
                </button>
              </div>

              <span className="mt-2 w-fit rounded bg-secondary/15 px-1.5 py-0.5 text-[11px] text-secondary">
                {space.type}
              </span>

              <p className="mt-3 truncate text-xs text-muted-foreground" title={space.folderPath}>
                {space.folderPath}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                最近打开 {formatTimestamp(space.lastOpenedAt)}
              </p>
            </div>
          ))}
        </div>
      </main>

      <Modal
        open={dialogOpen}
        title="新建空间"
        onClose={() => {
          if (busy) return
          setDialogOpen(false)
          resetForm()
        }}
        footer={
          <>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setDialogOpen(false)
                resetForm()
              }}
            >
              取消
            </Button>
            <Button disabled={busy} onClick={() => void handleCreate()}>
              {busy ? '创建中…' : '创建'}
            </Button>
          </>
        }
      >
        <div className="space-y-1.5">
          <label className="text-xs font-medium" htmlFor="space-name">
            空间名称
          </label>
          <input
            id="space-name"
            className="w-full rounded border border-input bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder="例如：项目A"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <span className="text-xs font-medium">空间类型</span>
          <div className="flex flex-wrap gap-1.5">
            {SPACE_TYPE_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={
                  typeChoice === preset
                    ? 'rounded border border-primary bg-primary px-2 py-1 text-xs text-primary-foreground'
                    : 'rounded border border-border px-2 py-1 text-xs hover:bg-muted'
                }
                onClick={() => setTypeChoice(preset)}
              >
                {preset}
              </button>
            ))}
            <button
              type="button"
              className={
                typeChoice === CUSTOM_TYPE
                  ? 'rounded border border-primary bg-primary px-2 py-1 text-xs text-primary-foreground'
                  : 'rounded border border-border px-2 py-1 text-xs hover:bg-muted'
              }
              onClick={() => setTypeChoice(CUSTOM_TYPE)}
            >
              自定义
            </button>
          </div>
          {typeChoice === CUSTOM_TYPE ? (
            <input
              className="w-full rounded border border-input bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="输入自定义类型"
              value={customType}
              onChange={(event) => setCustomType(event.target.value)}
            />
          ) : null}
        </div>

        <div className="space-y-1.5">
          <span className="text-xs font-medium">空间文件夹</span>
          <div className="flex items-center gap-2">
            <input
              className="min-w-0 flex-1 rounded border border-input bg-background px-2 py-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="尚未选择"
              value={folderPath}
              readOnly
              title={folderPath}
            />
            <Button variant="outline" onClick={() => void handlePickFolder()}>
              选择…
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            可以直接选已有文件夹；布局与缩略图会写进该文件夹的 .mindscape 目录，文件夹自包含
          </p>
        </div>

        {formError ? <p className="text-xs text-destructive">{formError}</p> : null}
      </Modal>
    </div>
  )
}
