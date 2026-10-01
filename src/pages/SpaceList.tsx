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
//   · ⚙ 设置：挂 SettingsPanel（2026-09-13 起为**可拖动弹窗**，与空间内 Board
//     复用同一个组件；「检查更新」收在弹窗的「版本更新」页里）。
//     图标按钮一律用 aria-label / title 承载语义（无文字）。
// 2026-09-13 追加：主题切换也从面板里搬出来，变成设置左侧的太阳 / 月亮纯图标按钮
//   （与空间内顶栏保持一致的顺序与外观）。
//
// 移动端适配 M4（2026-09-21，D3 方案 A）：本页有四处碰「系统文件夹」，移动端挑不了
// （Tauri 文件夹对话框无移动端实现），一律按能力表 `folderPicker` 分叉。
// 判定与文案都收在 pages/spaceList/mobileSpaceFlow.ts（node 可单测），本文件只做接线：
//   · 新建空间：文件夹按空间名派生到应用数据目录（core/storage/mobileSpaces.ts）；
//   · 导出布局：落在 <dataDir>/Mindscape/exports/<空间名>；
//   · 导入空间：改走系统文件选择器选一个 mindscape-layout.json（M4 第一步的字节通道）；
//   · 顶栏副标题：不再提 %APPDATA%。
//
// 实现任务：T1.1 / T1.2（阶段一）。
// ============================================================================

import { useCallback, useMemo, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'

import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { PromptDialog } from '@/components/ui/prompt-dialog'
import { SettingsPanel } from '@/components/ui/settings-panel'
import { SETTINGS_TEXT } from '@/components/ui/settingsText'
import { ImportIcon, MoonIcon, PlusIcon, SettingsIcon, SunIcon } from '@/components/ui/icons'
import { SPACE_TYPE_PRESETS, parseLayout } from '@/core/types'
import type { Space } from '@/core/types'
import { useTheme } from '@/core/hooks/useTheme'
import { localStorageProvider } from '@/core/storage/LocalFolderProvider'
import { sortSpacesForList } from '@/core/storage/spacesFile'
import {
  EXPORTED_LAYOUT_FILE,
  adoptExportedLayout,
  adoptLayoutBytes,
  exportedLayoutExists,
  localLayoutStore,
  removeExportedLayout,
} from '@/core/storage/appLayoutStore'
import { alertDialog, confirmDialog } from '@/core/utils/nativeDialogs'
import { basenameOf } from '@/core/utils/paths'
import { useSpacesStore } from '@/core/store/spacesStore'
import { supportsCapability } from '@/core/system/platformCapabilities'
import { resolveMobileExportDir, resolveMobileSpaceDir, spaceDirName } from '@/core/storage/mobileSpaces'
import { ImportFilesButton } from '@/pages/board/importFilesButton'
import { itemBytes } from '@/pages/board/ingestFlow'
import type { PickedFile } from '@/pages/board/ingestFlow'
import {
  LAYOUT_FILE_ACCEPT,
  SPACE_FLOW_TEXT,
  planExportTarget,
  planSpaceFolder,
  readLayoutFileForImport,
} from '@/pages/spaceList/mobileSpaceFlow'

/** 自定义类型的哨兵值（选中它时展开输入框） */
const CUSTOM_TYPE = '__custom__'

/**
 * 把导入文件夹里的导出布局收进软件目录（P1-2）。
 * 顺序：先收内容（校验通过才落地），再问是否移除源文件夹里的那份 ——
 * 内容已经在软件目录里了，移除与否都不丢数据，所以交给用户决定（守铁律③「不静默删除」）。
 */
async function importLayoutInto(spaceId: string, sourceDir: string): Promise<void> {
  const result = await adoptExportedLayout(localStorageProvider, spaceId, sourceDir)

  if (result === 'invalid') {
    await alertDialog(SPACE_FLOW_TEXT.importedInvalid, '导入空间')
    return
  }

  const shouldRemove = await confirmDialog(
    `布局已导入到软件目录。\n\n是否从「${basenameOf(sourceDir)}」里永久删除 ${EXPORTED_LAYOUT_FILE}？` +
      '\n\n（布局内容已经保存好了，删掉不影响使用；需要时可以用「导出布局」再生成一份）',
    '导入空间',
  )
  if (!shouldRemove) return

  try {
    await removeExportedLayout(localStorageProvider, sourceDir)
  } catch (error) {
    await alertDialog(
      `移除 ${EXPORTED_LAYOUT_FILE} 失败（${error instanceof Error ? error.message : String(error)}），` +
        '可以手动删掉它，不影响已经导入的布局。',
      '导入空间',
    )
  }
}

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
  const renameSpace = useSpacesStore((state) => state.renameSpace)
  const toggleSpaceFavorite = useSpacesStore((state) => state.toggleSpaceFavorite)

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
  /** 导入空间时选中的源文件夹（里面有 mindscape-layout.json）；null 表示普通新建 */
  const [layoutSource, setLayoutSource] = useState<string | null>(null)
  /**
   * 移动端导入空间时选中的布局**字节**（M4 / D3 方案 A）。
   * 安卓的选择器给内容不给路径，所以这里存的是字节而不是文件夹；
   * 与 layoutSource 二选一（同一时刻只有一个平台分支在用）。
   */
  const [layoutBytes, setLayoutBytes] = useState<Uint8Array | null>(null)
  /** 正在重命名的空间（P1-5）；null 表示改名弹窗关闭 */
  const [renameTarget, setRenameTarget] = useState<Space | null>(null)

  const effectiveType = typeChoice === CUSTOM_TYPE ? customType.trim() : typeChoice

  /** 能不能弹系统文件夹对话框（移动端为 false）：本页四处分支都只看这一个判定 */
  const canPickFolder = supportsCapability('folderPicker')

  const resetForm = useCallback(() => {
    setName('')
    setTypeChoice(SPACE_TYPE_PRESETS[0])
    setCustomType('')
    setFolderPath('')
    setFormError(null)
    setLayoutSource(null)
    setLayoutBytes(null)
  }, [])

  const handlePickFolder = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择空间文件夹',
      })
      if (typeof selected === 'string') {
        setFolderPath(selected)
        setLayoutSource(null)
      }
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
    if (effectiveType === '') {
      setFormError('请填写自定义类型')
      return
    }

    setBusy(true)
    try {
      // 落点：桌面沿用用户挑的文件夹（没挑还是那句「请选择空间文件夹」）；
      // 移动端挑不了文件夹，按空间名派生到应用数据目录。
      // ⚠️ 派生目录可能先建出来、随后 createSpace 因重名失败 —— 那里只剩一个空文件夹，
      // 不去删它（铁律③「不静默删除」），下次同名空间正好复用。
      const planned = await planSpaceFolder(
        { canPickFolder, resolveMobileDir: resolveMobileSpaceDir },
        name,
        folderPath,
      )
      if (!planned.ok) {
        setFormError(planned.error)
        return
      }
      const created = await createSpace({ name, type: effectiveType, folderPath: planned.folderPath })
      // 导入空间：桌面收源文件夹里的那份（P1-2），移动端收选择器给到的字节（M4）
      if (layoutBytes) {
        const result = await adoptLayoutBytes(localStorageProvider, created.id, layoutBytes)
        if (result === 'invalid') await alertDialog(SPACE_FLOW_TEXT.importedInvalid, '导入空间')
      } else if (layoutSource) {
        await importLayoutInto(created.id, layoutSource)
      }
      setDialogOpen(false)
      resetForm()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }, [canPickFolder, createSpace, effectiveType, folderPath, layoutBytes, layoutSource, name, resetForm])

  const handleDelete = useCallback(
    async (id: string, spaceName: string) => {
      const confirmed = await confirmDialog(
        `确定从列表移除「${spaceName}」？\n\n只删除记录，硬盘上的文件夹与文件不会被动。`,
        '移除空间',
      )
      if (!confirmed) return
      try {
        await removeSpace(id)
      } catch (error) {
        await alertDialog(error instanceof Error ? error.message : String(error), '移除空间')
      }
    },
    [removeSpace],
  )

  /**
   * 导出布局（P1-2）：把软件目录里这个空间的布局另存为「目标文件夹\mindscape-layout.json」。
   * 导出的是**已落盘**的布局，因此从未进入过的空间没有可导出的内容。
   */
  const handleExportLayout = useCallback(async (space: Space) => {
    try {
      const raw = await localLayoutStore.read(space.id)
      if (raw === null) {
        await alertDialog(
          '这个空间还没有布局记录（可能从未进入过）。先进去摆一下，再回来导出。',
          '导出布局',
        )
        return
      }
      if (!parseLayout(raw).ok) {
        await alertDialog('这个空间的布局数据无法识别，已取消导出。', '导出布局')
        return
      }

      const target = await planExportTarget(
        {
          canPickFolder,
          pickDir: async () => {
            const chosen = await open({
              directory: true,
              multiple: false,
              title: `把「${space.name}」的布局导出到哪个文件夹`,
              defaultPath: space.folderPath,
            })
            return typeof chosen === 'string' ? chosen : null
          },
          resolveMobileExportDir,
        },
        space.name,
      )
      if (target === null) return

      const written = await localStorageProvider.writeFileBytes(
        target,
        EXPORTED_LAYOUT_FILE,
        new TextEncoder().encode(raw),
      )
      await alertDialog(
        canPickFolder ? SPACE_FLOW_TEXT.exportedDesktop(written) : SPACE_FLOW_TEXT.exportedMobile(written),
        '导出布局',
      )
    } catch (error) {
      await alertDialog(error instanceof Error ? error.message : String(error), '导出布局失败')
    }
  }, [canPickFolder])

  /**
   * 移动端「导入空间」（M4 / D3 方案 A）：系统文件选择器给的是内容字节而不是文件夹，
   * 所以这里先把布局读出来校验，再打开与桌面同一个新建弹窗（名字预填、可改）。
   * 校验失败只提示、不建空间 —— 别在列表里留下建了一半的空空间。
   */
  const handleImportPickedLayout = useCallback(async (files: PickedFile[]) => {
    const result = await readLayoutFileForImport({ readBytes: itemBytes }, files[0])
    if (!result.ok) {
      await alertDialog(result.error, '导入空间')
      return
    }
    setLayoutBytes(result.bytes)
    setLayoutSource(null)
    setFolderPath('')
    setName(result.suggestedName)
    setFormError(null)
    setDialogOpen(true)
  }, [])

  /**
   * 导入空间（P1-2）：选一个带 mindscape-layout.json 的文件夹，
   * 复用「新建空间」弹窗（名称默认取文件夹名、类型可自选），确认后才真正建空间并带上布局。
   */
  const handleImportSpace = useCallback(async () => {
    try {
      const chosen = await open({
        directory: true,
        multiple: false,
        title: `选择含 ${EXPORTED_LAYOUT_FILE} 的文件夹`,
      })
      if (typeof chosen !== 'string') return

      if (!(await exportedLayoutExists(localStorageProvider, chosen))) {
        await alertDialog(
          `这个文件夹里没有 ${EXPORTED_LAYOUT_FILE}。\n\n` +
            '它由「导出布局」生成。如果只是想把这个文件夹当成新空间，请改用 ＋ 新建空间。',
          '导入空间',
        )
        return
      }

      setFolderPath(chosen)
      setName(basenameOf(chosen))
      setFormError(null)
      setLayoutSource(chosen)
      setDialogOpen(true)
    } catch (error) {
      await alertDialog(error instanceof Error ? error.message : String(error), '导入空间')
    }
  }, [])

  /** 列表排序（P1-5）：收藏的排前面，组内按最近打开时间倒序 */
  const sortedSpaces = useMemo(() => sortSpacesForList(spaces), [spaces])

  /** 改名确认（P1-5）：校验在 store 内（与新建同一套规则），这里只负责把错误弹出来 */
  const handleRenameConfirm = useCallback(
    (value: string) => {
      const target = renameTarget
      setRenameTarget(null)
      if (!target) return
      void renameSpace(target.id, value).catch((error: unknown) => {
        void alertDialog(error instanceof Error ? error.message : String(error), '重命名空间')
      })
    },
    [renameTarget, renameSpace],
  )

  const handleToggleFavorite = useCallback(
    (space: Space) => {
      void toggleSpaceFavorite(space.id).catch((error: unknown) => {
        void alertDialog(error instanceof Error ? error.message : String(error), '收藏空间')
      })
    },
    [toggleSpaceFavorite],
  )

  return (
    <div className="relative flex h-full w-full flex-col">
      {/* flex-wrap + min-w-0：窄窗口时标题先收缩、再换行，图标按钮组不会被挤出去。
          M3（2026-09-21 移动端）：留白收到 px-4 / py-4，手机宽度下标题与图标组各占一行 */}
      <header className="glass-chip flex flex-wrap items-center justify-between gap-3 gap-y-2 border-b border-border px-4 py-4 sm:px-8 sm:py-5">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">Mindscape 脑海空间</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {canPickFolder ? SPACE_FLOW_TEXT.subtitleDesktop : SPACE_FLOW_TEXT.subtitleMobile}
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
            onClick={() => {
              setLayoutSource(null)
              setDialogOpen(true)
            }}
          >
            <PlusIcon />
          </Button>
          {/* 导入空间：桌面挑「含 mindscape-layout.json 的文件夹」；移动端挑不了文件夹，
              换成系统文件选择器直接选那个文件本身（M4 / D3 方案 A，两者都是 ImportIcon） */}
          {canPickFolder ? (
            <Button
              variant="outline"
              size="icon"
              title={`导入空间（选带 ${EXPORTED_LAYOUT_FILE} 的文件夹）`}
              aria-label="导入空间"
              onClick={() => void handleImportSpace()}
            >
              <ImportIcon />
            </Button>
          ) : (
            <ImportFilesButton
              onFiles={(files) => void handleImportPickedLayout(files)}
              title={SPACE_FLOW_TEXT.importLayoutTitle}
              label={SPACE_FLOW_TEXT.importLayoutLabel}
              accept={LAYOUT_FILE_ACCEPT}
              multiple={false}
            />
          )}
          {/* 切换深浅色模式（2026-09-13）：从设置面板搬到顶栏，纯图标（太阳 / 月亮） */}
          <Button
            variant="outline"
            size="icon"
            title={theme === 'dark' ? SETTINGS_TEXT.toLight : SETTINGS_TEXT.toDark}
            aria-label={theme === 'dark' ? SETTINGS_TEXT.toLight : SETTINGS_TEXT.toDark}
            onClick={handleToggleTheme}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </Button>
          <Button
            variant={settingsOpen ? 'default' : 'outline'}
            size="icon"
            title="设置（自定义快捷键 / 版本更新）"
            aria-label="设置"
            onClick={() => setSettingsOpen((value) => !value)}
          >
            <SettingsIcon />
          </Button>
        </div>
      </header>

      {/* 设置弹窗（2026-09-13 改弹窗模式）：可拖动标题栏移动、右下角缩放 */}
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* M3 起手机上留白收窄（px-4 与顶栏同款）：此前 main 只有桌面档 px-8，
          顶栏 16px / 卡片 32px 两套缩进并存，手机上卡片看起来整体偏右（2026-10-01 用户反馈） */}
      <main className="flex-1 overflow-auto px-4 py-4 sm:px-8 sm:py-6">
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
              {canPickFolder ? SPACE_FLOW_TEXT.emptyHintDesktop : SPACE_FLOW_TEXT.emptyHintMobile}
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
              <div className="flex items-start justify-between gap-2 max-sm:flex-wrap">
                <h2 className="min-w-0 truncate font-medium" title={space.name}>
                  {/* 收藏标记常显（P1-5）：列表靠收藏排序，标记要能看出「为什么它在前面」 */}
                  {space.favorite ? <span className="mr-1 text-primary">★</span> : null}
                  {space.name}
                </h2>
                {/* 悬停才出现的卡片操作（三轮用户反馈迭代）：悬浮层挂在**卡片外部右上角**
                    —— 右上角静止时会留背景空框遮挡标题（截图 1）→ 右下角又不够醒目；
                    现用 bottom-full 外挂到卡片上边缘之外、right-0 右对齐，与卡片本体
                    零重叠（2026-09-13 截图 3）。⚠️ 不留垂直间隙：鼠标从卡片移向按钮
                    的路径必须连续，一旦有 margin，中途离开卡片 → group-hover 失效 →
                    按钮瞬间消失、永远点不到。整体仅悬停时显示（opacity + pointer-events
                    一起切换），平时完全不可见；z-20 保证盖过上方相邻卡片（grid 有 gap-4）。
                    M3（2026-09-21 移动端）：触屏没有 hover（能力表 pointerHover），
                    四个操作在手机上永远点不到，所以紧凑档改**流内常显** —— max-sm:static
                    + w-full 让它换到标题下面一行（父行 max-sm:flex-wrap），去掉外挂浮层的
                    边框/阴影/定位；类名两套互斥出现，Tailwind 仍能扫到字面量 */}
                <div className="pointer-events-none absolute bottom-full right-0 z-20 flex items-center gap-0.5 whitespace-nowrap rounded-md border border-border bg-card/95 p-0.5 opacity-0 shadow-sm transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 max-sm:static max-sm:w-full max-sm:flex-wrap max-sm:border-0 max-sm:bg-transparent max-sm:p-0 max-sm:opacity-100 max-sm:shadow-none max-sm:pointer-events-auto">
                  <button
                    type="button"
                    aria-label={`${space.favorite ? '取消收藏' : '收藏'} ${space.name}`}
                    title={space.favorite ? '取消收藏' : '收藏（排在列表前面）'}
                    className="rounded px-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground max-sm:min-h-11 max-sm:px-2"
                    onClick={(event) => {
                      event.stopPropagation()
                      handleToggleFavorite(space)
                    }}
                  >
                    {space.favorite ? '取消收藏' : '收藏'}
                  </button>
                  <button
                    type="button"
                    aria-label={`重命名 ${space.name}`}
                    title="重命名（只改显示名，文件夹不动）"
                    className="rounded px-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground max-sm:min-h-11 max-sm:px-2"
                    onClick={(event) => {
                      event.stopPropagation()
                      setRenameTarget(space)
                    }}
                  >
                    重命名
                  </button>
                  <button
                    type="button"
                    aria-label={`导出空间布局 ${space.name}`}
                    title="把布局导出到文件夹（生成 mindscape-layout.json）"
                    className="rounded px-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground max-sm:min-h-11 max-sm:px-2"
                    onClick={(event) => {
                      event.stopPropagation()
                      void handleExportLayout(space)
                    }}
                  >
                    导出布局
                  </button>
                  <button
                    type="button"
                    aria-label={`移除空间 ${space.name}`}
                    className="rounded px-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-destructive max-sm:min-h-11 max-sm:px-2"
                    onClick={(event) => {
                      event.stopPropagation()
                      void handleDelete(space.id, space.name)
                    }}
                  >
                    移除
                  </button>
                </div>
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
        title={layoutSource ? '导入空间' : '新建空间'}
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
          {/* 移动端没有文件夹对话框，「选择…」摆出来也只会报错，直接不给（M4） */}
          {canPickFolder ? (
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
          ) : null}
          <p className="text-[11px] text-muted-foreground">
            {canPickFolder
              ? SPACE_FLOW_TEXT.folderHintDesktop
              : // 预览用的是同一个 spaceDirName：说明文字不许跟真实落点各说各话
                SPACE_FLOW_TEXT.folderHintMobile(spaceDirName(name.trim()))}
          </p>
        </div>

        {formError ? <p className="text-xs text-destructive">{formError}</p> : null}
      </Modal>

      {/* 重命名弹窗（P1-5）：Enter 提交、Esc 取消；只改显示名，绑定的文件夹不动 */}
      <PromptDialog
        state={
          renameTarget
            ? {
                title: `重命名「${renameTarget.name}」`,
                value: renameTarget.name,
                placeholder: '输入新的空间名称',
                onConfirm: handleRenameConfirm,
              }
            : null
        }
        onClose={() => setRenameTarget(null)}
      />
    </div>
  )
}
