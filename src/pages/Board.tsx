// ============================================================================
// 模块说明（中文）
// 画布页。对应 T1.3（进空间读文件夹）+ T1.4（缩略图）+ T1.5（交互）+ T1.6（落盘）。
//
// 数据流：
//   SpaceList 点击卡片 → spacesStore.openSpace(id)
//     → currentSpaceId 变化 → App 渲染本组件
//       → boardStore.loadSpace(space)（读 layout → 扫描 → 合并 → 缩略图）
//         → Canvas 渲染 cards，并用 layout.canvas 恢复视图
//
// 落盘（17.6）：
//   · 视口/内容变化 → LayoutWriter 防抖 500ms 写盘
//   · 返回列表 / Ctrl+S / 窗口关闭前 → 强制立即落盘
//   · readOnly（layout version 过高）→ 一律不写盘
//
// ⚠️ 卡片上限（17.7）：第一版按 ≤100 张设计，超过时给出提示但不阻止。
//
// 实现任务：T1.3 / T1.4 / T1.5 / T1.6（阶段一）。
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { confirmDialog } from '@/core/utils/nativeDialogs'

import { Button } from '@/components/ui/button'
import { ContextMenu } from '@/components/ui/context-menu'
import type { ContextMenuState } from '@/components/ui/context-menu'
import { PromptDialog } from '@/components/ui/prompt-dialog'
import type { PromptDialogState } from '@/components/ui/prompt-dialog'
import { PluginDialogHost } from '@/components/ui/plugin-dialog-host'
import { SettingsPanel } from '@/components/ui/settings-panel'
import { SETTINGS_TEXT } from '@/components/ui/settingsText'
import { CardSearchPanel } from '@/components/ui/card-search'
import { ArchiveIcon, ArrowLeftIcon, MoonIcon, SettingsIcon, SunIcon } from '@/components/ui/icons'
import { Canvas } from '@/canvas/Canvas'
import type { CanvasApi } from '@/canvas/Canvas'
import { MiniMap, MINIMAP_PREF_KEY } from '@/canvas/MiniMap'
import { isDesktopRuntime } from '@/core/utils/runtime'
import { getViewportSnapshot, resetViewportSnapshot, setViewportSnapshot } from '@/canvas/viewportSnapshot'
import type { ViewportState } from '@/canvas/interaction/coordinates'
import { useBoardStore } from '@/core/store/boardStore'
import { useSpacesStore } from '@/core/store/spacesStore'
import { localStorageProvider } from '@/core/storage/LocalFolderProvider'
import { localLayoutStore } from '@/core/storage/appLayoutStore'
import { LayoutWriter } from '@/core/board/layoutWriter'
import { History } from '@/core/commands/history'
import { createMoveCardsCommand, hasMeaningfulMove } from '@/core/commands/impl/moveCards'
import type { CardMoveDelta } from '@/core/commands/impl/moveCards'
import { createResizeCardsCommand, hasMeaningfulResize } from '@/core/commands/impl/resizeCards'
import type { CardResizeDelta } from '@/core/commands/impl/resizeCards'
import {
  createMovePartitionsCommand,
  hasMeaningfulPartitionMove,
} from '@/core/commands/impl/movePartitions'
import type { PartitionMoveDelta } from '@/core/commands/impl/movePartitions'
import { createSetPartitionRectsCommand } from '@/core/commands/impl/setPartitionRects'
import { createRenamePartitionCommand } from '@/core/commands/impl/renamePartition'
import { createRemoveCardsCommand } from '@/core/commands/impl/removeCards'
import { createRestoreCardsCommand } from '@/core/commands/impl/restoreCards'
import { createSetCardsZIndexCommand, zIndexDeltasFor } from '@/core/commands/impl/setCardsZIndex'
import { createSetCardNoteCommand } from '@/core/commands/impl/setCardNote'
import { createSetCardMetaCommand } from '@/core/commands/impl/setCardMeta'
import { createSetPartitionColorCommand } from '@/core/commands/impl/setPartitionColor'
import {
  createConnectionCommand,
  createRemoveConnectionsCommand,
  createSetConnectionLabelCommand,
} from '@/core/commands/impl/connections'
import { createAddCardsCommand } from '@/core/commands/impl/addCards'
import { createMoveCardToFolderCommand, currentTopFolderOf } from '@/core/commands/impl/moveCardToFolder'
import { registerAction } from '@/core/registry/actionRegistry'
import { CARD_ACTION, PARTITION_ACTION, CONNECTION_ACTION } from '@/core/registry/menus'
import { PARTITION_TITLE_HEIGHT } from '@/core/board/partitions'
import { metaWithTags, tagsOfMeta } from '@/core/board/cardMeta'
import { useCardSearch } from '@/core/hooks/useCardSearch'
import { resolveShortcut } from '@/core/shortcuts/keys'
import { useShortcutsStore } from '@/core/store/shortcutsStore'
import { getCardOriginalPath } from '@/core/board/cardAssets'
import { setPluginBoardBridge } from '@/core/plugin/boardBridge'
import { nextCardId, nextConnectionId } from '@/core/utils/id'
import { useTheme } from '@/core/hooks/useTheme'
import { zCardSchema } from '@/core/types'
import type { Card, Connection, Partition } from '@/core/types'
import { basenameOf, dirnameOf, joinPath, relativePathOf } from '@/core/utils/paths'
import { cardSizeForImage } from '@/core/board/cardSize'
import { cardTypeFor } from '@/core/board/imageTypes'
import { setCardAsset } from '@/core/board/cardAssets'
import {
  cardWithoutEditables,
  expandedBounds,
  isCopyableCard,
  pasteFileName,
  resolveDropDestination,
} from '@/core/board/ingest'
import type { DropDestination } from '@/core/board/ingest'
import type { AddCardsSource } from '@/core/commands/impl/addCards'
import type { Point } from '@/canvas/interaction/connectionAnchor'
import { isValidFolderName } from '@/core/board/partitions'
import { readClipboardFiles, writeClipboardFiles, writeClipboardText } from '@/core/system/clipboard'
import { DATA_VERSION } from '@/core/types'
import type { Layout } from '@/core/types'
import {
  buildCardMenuItems,
  buildCardMoveItems,
  buildCanvasMenuItems,
  buildConnectionMenuItems,
  buildPartitionColorItems,
  buildPartitionMenuItems,
} from '@/pages/board/contextMenus'
import { openCreatePartitionPrompt } from '@/pages/board/createPartitionFlow'

/** 17.7：卡片数量上限提示阈值 */
const CARD_COUNT_WARNING = 100

/**
 * 新建卡片时「已用 id 全集」：**画布卡片 + 已移除记录**。
 *
 * ⚠️ 两者共用同一 id 空间 —— removed 记录按 id 与灰卡关联（恢复时要用），
 * 只把画布卡片的 id 当种子会让新卡拿到已被移除记录占用的 id；
 * 该新卡再被移除时，removed 里就出现两条同 id 记录，
 * 恢复时「按 id 匹配」会命中错误的旧记录 → 「恢复失败：不是文件」。
 */
function usedCardIds(): string[] {
  const state = useBoardStore.getState()
  return [...state.cards.map((card) => card.id), ...state.removed.map((entry) => entry.id)]
}

export function Board() {
  const spaces = useSpacesStore((state) => state.spaces)
  const currentSpaceId = useSpacesStore((state) => state.currentSpaceId)
  const closeSpace = useSpacesStore((state) => state.closeSpace)

  const cards = useBoardStore((state) => state.cards)
  const partitions = useBoardStore((state) => state.partitions)
  const canvas = useBoardStore((state) => state.canvas)
  const status = useBoardStore((state) => state.status)
  const error = useBoardStore((state) => state.error)
  const notices = useBoardStore((state) => state.notices)
  const readOnly = useBoardStore((state) => state.readOnly)
  const removed = useBoardStore((state) => state.removed)
  const selectedIds = useBoardStore((state) => state.selectedIds)
  const selectCards = useBoardStore((state) => state.selectCards)
  const selectedPartitionId = useBoardStore((state) => state.selectedPartitionId)
  const selectPartition = useBoardStore((state) => state.selectPartition)
  const setCardPositions = useBoardStore((state) => state.setCardPositions)
  const setCardSizes = useBoardStore((state) => state.setCardSizes)
  const setPartitionPositions = useBoardStore((state) => state.setPartitionPositions)
  const setPartitionCollapsed = useBoardStore((state) => state.setPartitionCollapsed)
  const removedView = useBoardStore((state) => state.removedView)
  const removedCards = useBoardStore((state) => state.removedCards)
  const loadRemovedView = useBoardStore((state) => state.loadRemovedView)
  const exitRemovedView = useBoardStore((state) => state.exitRemovedView)
  const connections = useBoardStore((state) => state.connections)
  const selectedConnectionIds = useBoardStore((state) => state.selectedConnectionIds)

  /** 撤销历史（7.4：仅本次运行期间有效；切空间时清空）。实例与 React 生命周期解耦 */
  const historyRef = useRef<History | null>(null)
  if (!historyRef.current) historyRef.current = new History()
  const history = historyRef.current

  /** 落盘失败提示（中文，可直接展示） */
  const [saveError, setSaveError] = useState<string | null>(null)

  /** 画布操作失败提示（改名 / 移除 / 恢复共用，中文可直接展示） */
  const [actionError, setActionError] = useState<string | null>(null)

  /** 大批量文件操作进度（T2.10 三级保护第三档：>50 张时展示） */
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(
    null,
  )

  // ---- 阶段三（T3）：右键菜单 / 输入浮层 / 挂起连线 ----

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [prompt, setPrompt] = useState<PromptDialogState | null>(null)
  /** 挂起连线模式的源卡 id（菜单「连线」触发；null = 未挂起） */
  const [pendingConnectFrom, setPendingConnectFrom] = useState<string | null>(null)
  /** 画布 API（屏幕 → 画布换算），拖入落点 / 新建便签定位用 */
  const canvasApiRef = useRef<CanvasApi | null>(null)

  /** 应用内卡片剪贴板（2026-09-11 用户裁决「所有类型的卡片都支持复制与粘贴」）。
   *  存已复制的卡片快照；粘贴时图片 / 文件都从原件拷贝（保留清晰度），便签克隆文字。
   *  仅应用内有效（系统剪贴板写文件需要额外插件，8.2 的截图粘贴不受影响）。 */
  const [copiedCards, setCopiedCards] = useState<Card[]>([])

  /** 设置面板显隐（2026-09-12：外观 / 已移除视图 / 检查更新统一收纳） */
  const [settingsOpen, setSettingsOpen] = useState(false)

  /**
   * 主题状态（2026-09-11 用户裁决「深色模式」）：读取 / 切换 / 应用 / 记忆统一走 useTheme，
   * 与主界面（SpaceList）共用同一份实现 —— 两处设置面板的主题按钮行为完全一致。
   */
  const { theme, toggle: handleToggleTheme } = useTheme()

  const space = spaces.find((item) => item.id === currentSpaceId) ?? null

  // -------------------------------------------------------------------------
  // 落盘调度（T1.6）
  // -------------------------------------------------------------------------

  const writer = useMemo(
    () =>
      new LayoutWriter({
        build: (): Layout | null => {
          const snapshot = useBoardStore.getState()
          // 未进入空间 / 加载中 / 只读 → 不写盘
          if (snapshot.status !== 'ready' || snapshot.spaceId === null) return null
          if (snapshot.readOnly) return null

          return {
            version: DATA_VERSION,
            canvas: getViewportSnapshot(),
            cards: snapshot.cards,
            partitions: snapshot.partitions,
            connections: snapshot.connections,
            removed: snapshot.removed,
            extensions: {},
          }
        },
        write: async (json) => {
          const target = useSpacesStore.getState().getCurrentSpace()
          if (!target) return
          // P1-2：布局写进软件目录（layouts\<空间 id>.json），空间文件夹零新增文件
          await localLayoutStore.write(target.id, json)
        },
        onError: (message) => setSaveError(message),
        onSuccess: () => setSaveError(null),
      }),
    [],
  )

  const handleViewportChange = useCallback(
    (state: ViewportState) => {
      // 影子快照：落盘时读它取 zoom/offset（不进 React state，见 viewportSnapshot.ts）
      setViewportSnapshot(state)
      // 小地图每帧重绘（2D canvas 直画，零 React 更新）
      minimapRedrawRef.current?.()
      writer.schedule()
    },
    [writer],
  )

  // ---- 小地图（2026-09-12）：右下角概览 + 显示 / 隐藏（偏好记忆）----

  /** 小地图显示偏好：localStorage 记忆，默认显示 */
  const [minimapVisible, setMinimapVisible] = useState(() => {
    try {
      return localStorage.getItem(MINIMAP_PREF_KEY) !== 'hidden'
    } catch {
      return true
    }
  })

  const handleMinimapVisibleChange = useCallback((visible: boolean) => {
    setMinimapVisible(visible)
    try {
      localStorage.setItem(MINIMAP_PREF_KEY, visible ? 'visible' : 'hidden')
    } catch {
      // localStorage 不可用（如无痕限制）：只影响记忆，不影响本次功能
    }
  }, [])

  /** 小地图每帧重绘函数（MiniMap 挂载时登记，视口变化时直呼） */
  const minimapRedrawRef = useRef<(() => void) | null>(null)

  /** 小地图点击 / 拖拽跳转：把画布坐标变为视口中心 */
  const handleMinimapJump = useCallback((point: { x: number; y: number }) => {
    canvasApiRef.current?.centerOn(point)
  }, [])

  // ---- 画布工具栏（2026-09-12 用户裁决：顶栏操作类控件收进一条可折叠的纯图标工具栏） ----
  // 2026-09-13 用户裁决：**取消这条折叠栏**，撤销 / 重做 / 新建便签 / 恢复选中
  // 统一并入右键菜单（新建便签 → 画布空白菜单；撤销 / 重做 → 画布空白菜单；
  // 恢复选中 → 已移除视图下的卡片菜单）。键盘快捷键不受影响。

  /** 单击卡片 / 空白（5.1）：全量替换选中集合 */
  const handleSelectCards = useCallback(
    (ids: string[]) => {
      selectCards(ids)
    },
    [selectCards],
  )

  // ---- 卡片搜索（P1-3）：Ctrl+F 唤出浮层，在命中项之间循环跳转 ----
  // 状态与动作收在 useCardSearch（core/hooks），这里只注入「跳到某张卡」的动作：
  // 选中该卡并把卡片中心挪到视口中心（复用小地图的定位路径）。

  /** 搜索范围跟随当前视图：已移除视图里搜的是 removedCards（与画布展示一致） */
  const searchDocs = removedView ? removedCards : cards
  // 经 ref 转手：jumpTo 保持稳定引用，hook 内部的回调不必随卡片列表重建
  const searchDocsRef = useRef(searchDocs)
  searchDocsRef.current = searchDocs

  const handleSearchJumpTo = useCallback(
    (id: string) => {
      const target = searchDocsRef.current.find((card) => card.id === id)
      if (!target) return
      selectCards([target.id])
      canvasApiRef.current?.centerOn({ x: target.x + target.w / 2, y: target.y + target.h / 2 })
    },
    [selectCards],
  )

  const search = useCardSearch({ docs: searchDocs, jumpTo: handleSearchJumpTo })

  /**
   * 拖拽松手（T2.2）：坐标固化进 store + 一条命令入撤销栈 + 触发防抖落盘。
   * 拖动过程中没有任何 setState，这里是整次拖拽唯一一次状态更新。
   */
  const handleCommitMove = useCallback(
    (moves: CardMoveDelta[]) => {
      if (!hasMeaningfulMove(moves)) return
      const command = createMoveCardsCommand(moves, (positions) => setCardPositions(positions))
      void history.execute(command)
      writer.schedule()
    },
    [history, setCardPositions, writer],
  )

  /** 手柄缩放松手（T2.3）：尺寸固化 + 命令入撤销栈 + 防抖落盘 */
  const handleCommitResize = useCallback(
    (resizes: CardResizeDelta[]) => {
      if (!hasMeaningfulResize(resizes)) return
      const command = createResizeCardsCommand(resizes, (sizes) => setCardSizes(sizes))
      void history.execute(command)
      writer.schedule()
    },
    [history, setCardSizes, writer],
  )

  /** 拖框松手（T2.5）：框 + 框内卡片整组固化 + 一条复合命令入撤销栈 + 防抖落盘 */
  const handleCommitPartitionMove = useCallback(
    (result: { partitionId: string; from: { x: number; y: number }; to: { x: number; y: number }; cardMoves: CardMoveDelta[] }) => {
      const delta: PartitionMoveDelta = {
        partitionId: result.partitionId,
        from: result.from,
        to: result.to,
        cardMoves: result.cardMoves,
      }
      if (!hasMeaningfulPartitionMove(delta)) return
      const command = createMovePartitionsCommand(delta, ({ partitions: boxes, cards }) => {
        setPartitionPositions(boxes)
        setCardPositions(cards)
      })
      void history.execute(command)
      writer.schedule()
    },
    [history, setPartitionPositions, setCardPositions, writer],
  )

  /** 提交分区框新尺寸（拖拽边缘调整大小，2026-09-11 用户裁决）：一条命令入撤销栈 */
  const handleCommitPartitionResize = useCallback(
    (result: { partitionId: string; from: { w: number; h: number }; to: { w: number; h: number } }) => {
      const partition = useBoardStore.getState().partitions.find((item) => item.id === result.partitionId)
      if (!partition) return
      if (result.from.w === result.to.w && result.from.h === result.to.h) return
      void history.execute(
        createSetPartitionRectsCommand(
          [
            {
              id: result.partitionId,
              from: { x: partition.x, y: partition.y, w: result.from.w, h: result.from.h },
              to: { x: partition.x, y: partition.y, w: result.to.w, h: result.to.h },
            },
          ],
          (updates) => useBoardStore.getState().setPartitionRects(updates),
        ),
      )
      writer.schedule()
    },
    [history, writer],
  )

  /** 折叠 / 展开分区框（T2.5）：低频视图状态，不入撤销栈，但要落盘 */  const handleTogglePartitionCollapsed = useCallback(
    (id: string) => {
      const current = useBoardStore
        .getState()
        .partitions.find((partition) => partition.id === id)
      if (!current) return
      setPartitionCollapsed(id, !current.collapsed)
      writer.schedule()
    },
    [setPartitionCollapsed, writer],
  )

  /** 切换「已移除」视图（T2.8 / 7.2） */
  const handleToggleRemovedView = useCallback(() => {
    const snapshot = useBoardStore.getState()
    if (snapshot.removedView) {
      exitRemovedView()
      return
    }
    const space = useSpacesStore.getState().getCurrentSpace()
    if (!space) return
    void loadRemovedView(space.folderPath)
  }, [exitRemovedView, loadRemovedView])

  /** 恢复选中卡片（T2.8 / 7.2）：文件移回原位 + 卡片回到画布，undo 可逆 */
  const handleRestoreCards = useCallback(
    (ids: string[]) => {
      const snapshot = useBoardStore.getState()
      const space = useSpacesStore.getState().getCurrentSpace()
      if (!space || ids.length === 0) return

      const targets = snapshot.removedCards.filter((card) => ids.includes(card.id))
      const entries = snapshot.removed.filter((entry) => ids.includes(entry.id))
      if (targets.length === 0 || entries.length === 0) return
      setActionError(null)

      const command = createRestoreCardsCommand(targets, entries, {
        spacePath: space.folderPath,
        provider: localStorageProvider,
        applyRestore: (payload) => useBoardStore.getState().applyRestoreCards(payload),
        applyRemove: (payload) => useBoardStore.getState().applyRemoveCards(payload),
        onNotice: (message) => setActionError(message),
        // 三级性能保护（7.4 / T2.10）：>50 张走并发 + 进度
        onProgress:
          targets.length > 50
            ? (done, total) => setProgress({ done, total, label: '正在恢复' })
            : undefined,
      })

      void history
        .execute(command)
        .then(() => writer.schedule())
        .catch((error: unknown) => {
          setActionError(error instanceof Error ? error.message : String(error))
        })
        .finally(() => setProgress(null))
    },
    [history, writer],
  )

  /**
   * 分区框改名（T2.6）：第六章保护措施五步。
   * ① 非法字符 → ② 同名冲突（画布 + 硬盘）→ ④ 确认框 → ⑤ 执行（含磁盘改名）；
   * ③ 占用检测由 renameDir 失败体现（Windows 上文件夹被资源管理器/程序占用时失败）。
   */
  const handleRenamePartition = useCallback(
    async (id: string, newName: string) => {
      const snapshot = useBoardStore.getState()
      const partition = snapshot.partitions.find((item) => item.id === id)
      const space = useSpacesStore.getState().getCurrentSpace()
      if (!partition || !space) return
      if (snapshot.readOnly) {
        setActionError('布局由更新版本创建，处于只读模式，无法改名')
        return
      }

      // ① 非法字符检测
      if (!isValidFolderName(newName)) {
        setActionError(`名称「${newName}」含非法字符或为空（不可用 \\ / : * ? " < > |）`)
        return
      }
      setActionError(null)
      if (newName === partition.name) return

      // ② 同名冲突检测：画布上已有同名分区
      if (
        snapshot.partitions.some(
          (item) => item.id !== id && (item.name === newName || item.folderPath === newName),
        )
      ) {
        setActionError(`已存在名为「${newName}」的分区，换一个名字吧`)
        return
      }

      // ②（续）硬盘上已有同名文件夹
      try {
        const exists = await localStorageProvider.dirExists(joinPath(space.folderPath, newName))
        if (exists) {
          setActionError(`空间文件夹里已存在「${newName}」，换一个名字吧`)
          return
        }
      } catch (error) {
        setActionError(error instanceof Error ? error.message : String(error))
        return
      }

      // ④ 确认框（第六章原文提示）。
      // 走 nativeDialogs 统一出口：桌面端是 dialog 插件的系统弹窗（带标题与警告图标），
      // 浏览器开发态回落原生 confirm —— 环境判定收在那一处，这里不再重复。
      const message =
        `将同时重命名硬盘文件夹「${partition.name}」→「${newName}」，` +
        '可能导致外部引用（如 SketchUp 贴图路径）失效，确认？'
      const confirmed = await confirmDialog(message, '重命名分区')
      if (!confirmed) return

      // ⑤ 执行 + 记录旧名（命令的 undo 会把硬盘名一并改回去）
      try {
        await history.execute(
          createRenamePartitionCommand(
            {
              partitionId: id,
              oldName: partition.name,
              newName,
              oldFolderPath: partition.folderPath,
              newFolderPath: newName,
            },
            {
              spacePath: space.folderPath,
              provider: localStorageProvider,
              apply: (payload) => useBoardStore.getState().renamePartition(payload),
            },
          ),
        )
        writer.schedule()
      } catch (error) {
        // ③ 文件夹占用 / 其他失败：命令未入栈、状态未变
        setActionError(
          error instanceof Error
            ? `改名失败：${error.message}（文件夹可能正被占用，请关闭后重试）`
            : String(error),
        )
      }
    },
    [history, writer],
  )

  /**
   * Delete 移除选中卡片（T2.7 / 7.1）：文件 → `_已移除\原文件夹结构\`，
   * removed 记录追加；命令的 undo 会把文件移回原位（7.4）。
   */
  const handleRemoveCards = useCallback(
    (ids: string[]) => {
      const snapshot = useBoardStore.getState()
      const space = useSpacesStore.getState().getCurrentSpace()
      if (!space) return
      if (snapshot.readOnly) {
        setActionError('布局由更新版本创建，处于只读模式，无法移除卡片')
        return
      }

      const targets = snapshot.cards.filter((card) => ids.includes(card.id))
      if (targets.length === 0) return
      setActionError(null)

      const command = createRemoveCardsCommand(targets, {
        spacePath: space.folderPath,
        provider: localStorageProvider,
        applyRemove: (payload) => useBoardStore.getState().applyRemoveCards(payload),
        applyRestore: (payload) => useBoardStore.getState().applyRestoreCards(payload),
        // 级联断开连线：移除卡片时把相连的连线一并删掉，undo 时整体放回
        getConnections: () => useBoardStore.getState().connections,
        applyRemoveConnections: (ids) => useBoardStore.getState().removeConnections(ids),
        applyAddConnections: (connections) => useBoardStore.getState().addConnections(connections),
        onNotice: (message) => setActionError(message),
        // 三级性能保护（7.4 / T2.10）：>50 张走并发 + 进度
        onProgress:
          targets.length > 50
            ? (done, total) => setProgress({ done, total, label: '正在移除' })
            : undefined,
      })

      void history
        .execute(command)
        .then(() => writer.schedule())
        .catch((error: unknown) => {
          // 全部失败：命令未入栈
          setActionError(error instanceof Error ? error.message : String(error))
        })
        .finally(() => setProgress(null))
    },
    [history, writer],
  )

  // -------------------------------------------------------------------------
  // 阶段三（T3）：打开 / 连线 / 备注 / 便签 / 右键菜单
  // -------------------------------------------------------------------------

  /**
   * 拖入 / 粘贴共用的「新卡片」生成：
   * 尺寸（图片按原始宽高比）、filePath 归一、资源表登记（必须先于 addCards 渲染）。
   * 方案 A（2026-09-12）：资源表只登记原图绝对路径，不生成缩略图。
   */
  const buildIngestedCard = useCallback(
    async (params: {
      id: string
      actualAbs: string
      spacePath: string
      point: Point
      offset: number
    }): Promise<Card> => {
      const { id, actualAbs, spacePath, point, offset } = params
      const name = basenameOf(actualAbs)
      const type = cardTypeFor(name)

      let size = { w: 180, h: 96 }
      if (type === 'image') {
        try {
          const original = await localStorageProvider.readImageSize(actualAbs)
          size = cardSizeForImage(original.width, original.height)
        } catch {
          // 尺寸读不到就按默认
        }
        setCardAsset(id, { originalPath: actualAbs })
      }

      const filePath = relativePathOf(actualAbs, spacePath)
      return zCardSchema.parse({
        id,
        type,
        filePath,
        originalPath: filePath,
        x: Math.round(point.x + offset),
        y: Math.round(point.y + offset),
        w: size.w,
        h: size.h,
      })
    },
    [],
  )

  /** 拖入落盘后统一走这条：addCards 命令（undo 删副本）+ 扩框 + 落盘 */
  const commitIngestedCards = useCallback(
    async (cards: Card[], createdFiles: string[], sources: AddCardsSource[], dest: ReturnType<typeof resolveDropDestination>) => {
      await history.execute(
        createAddCardsCommand(
          { cards, createdFiles, sources },
          {
            provider: localStorageProvider,
            applyAdd: (added) => useBoardStore.getState().addCards(added),
            applyRemove: (ids) => useBoardStore.getState().removeCardsLocally(ids),
          },
        ),
      )

      // T3.7：落在分区内时把框扩到包住新卡（只扩不缩）
      if (dest.partitionId) {
        const updates: { id: string; x: number; y: number; w: number; h: number }[] = []
        const snapshot = useBoardStore.getState()
        const partition = snapshot.partitions.find((item) => item.id === dest.partitionId)
        if (partition) {
          let bounds = { x: partition.x, y: partition.y, w: partition.w, h: partition.h }
          let changed = false
          for (const card of cards) {
            const next = expandedBounds({ ...partition, ...bounds }, card)
            if (next) {
              bounds = next
              changed = true
            }
          }
          if (changed) updates.push({ id: partition.id, ...bounds })
        }
        if (updates.length > 0) useBoardStore.getState().setPartitionRects(updates)
      }

      writer.schedule()
    },
    [history, writer],
  )

  /**
   * 外部文件导入的公共执行端（2026-09-13 自拖入链路抽出，拖入与系统剪贴板粘贴共用）：
   * 逐个 copy 进空间（铁律②：原件不动）→ 建卡 → 汇总失败 → 撤销栈。
   * dest（落盘目标 + 分区归属）与 point（首卡落点）由调用方按各自规则决定——
   * 拖入看落点命中、粘贴看确定性规则（2026-09-12 用户裁决：不靠落点猜测）。
   */
  const ingestExternalFiles = useCallback(
    async (
      paths: string[],
      spacePath: string,
      dest: DropDestination,
      point: Point,
      failLabel: '拖入' | '粘贴',
    ): Promise<void> => {
      const cards: Card[] = []
      const createdFiles: string[] = []
      const sources: AddCardsSource[] = []
      const usedIds = usedCardIds()
      let offset = 0
      const failures: string[] = []

      for (const src of paths) {
        const name = basenameOf(src)
        try {
          // 图片与非图片统一走 copy_file（方案 A：复制时不再生成缩略图）
          const actualAbs = await localStorageProvider.copyFile(src, dest.destDir)

          const id = nextCardId([...usedIds, ...cards.map((card) => card.id)])
          const card = await buildIngestedCard({
            id,
            actualAbs,
            spacePath,
            point,
            offset,
          })
          // 拖入 / 粘贴到分区的卡归入该分区（T3.7）
          if (dest.groupName) card.group = dest.groupName

          usedIds.push(id)
          cards.push(card)
          createdFiles.push(actualAbs)
          sources.push({ src, destDir: dest.destDir })
          offset += 24
        } catch (error) {
          failures.push(`${name}（${error instanceof Error ? error.message : String(error)}）`)
        }
      }

      if (failures.length > 0) {
        setActionError(`以下文件${failLabel}失败：${failures.join('；')}`)
      }
      if (cards.length === 0) return

      setActionError(null)
      await commitIngestedCards(cards, createdFiles, sources, dest)
    },
    [buildIngestedCard, commitIngestedCards],
  )

  /**
   * T3.6 / T3.7 拖入文件：paths 来自 Tauri onDragDropEvent（真实路径，17.4 铁律），
   * screenPoint 是 drop 的窗口内逻辑坐标。复制模式：原件保留，副本进项目文件夹。
   */
  const handleDropFiles = useCallback(
    async (paths: string[], screenPoint: { x: number; y: number }) => {
      const api = canvasApiRef.current
      const space = useSpacesStore.getState().getCurrentSpace()
      if (!api || !space || paths.length === 0) return
      if (useBoardStore.getState().readOnly) {
        setActionError('布局由更新版本创建，处于只读模式，无法拖入文件')
        return
      }

      const point = api.screenToCanvasPoint(screenPoint.x, screenPoint.y)
      const dest = resolveDropDestination(point, useBoardStore.getState().partitions, space.folderPath)
      await ingestExternalFiles(paths, space.folderPath, dest, point, '拖入')
    },
    [ingestExternalFiles],
  )

  /** 视口中心的画布坐标（Ctrl+V 落点；与新建便签同规则） */
  const viewportCenterCanvasPoint = useCallback((): Point | null => {
    const api = canvasApiRef.current
    if (!api) return null
    const root = document.querySelector('[data-canvas-root]')
    const rect = root?.getBoundingClientRect()
    const center = rect
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    return api.screenToCanvasPoint(center.x, center.y)
  }, [])

  /**
   * 插件画布桥（2026-09-14，插件期新增；设计见 core/plugin/boardBridge.ts）。
   *
   * 为什么由本组件注册：建卡要用到「画布坐标换算 + 读图片尺寸 + 资源表 + addCards
   * 命令 + 落盘调度器」，这些能力只活在这里；而 core 层不能反向 import 上层
   * （架构守卫规则 4）—— 所以反过来由画布把能力交给插件运行时。
   * 卸载时注销，未打开空间时插件拿到 false 并自己提示，不会静默失败。
   */
  useEffect(() => {
    setPluginBoardBridge({
      currentSpacePath: () => useSpacesStore.getState().getCurrentSpace()?.folderPath ?? null,

      createCardFromFile: async (input) => {
        const space = useSpacesStore.getState().getCurrentSpace()
        if (!space || useBoardStore.getState().readOnly) return false
        const point = viewportCenterCanvasPoint()
        if (!point) return false

        // 与拖入 / 粘贴走同一条建卡路径：图片卡会读原始尺寸并登记资源表
        const card = await buildIngestedCard({
          id: nextCardId(usedCardIds()),
          actualAbs: input.absolutePath,
          spacePath: space.folderPath,
          point,
          offset: 0,
        })

        // 插件给的字段优先于推导值 —— 它比我们更知道这张卡该是什么样
        card.filePath = input.relativePath || card.filePath
        card.originalPath = card.filePath
        if (input.type) card.type = input.type
        if (input.w !== undefined && input.h !== undefined) {
          card.w = input.w
          card.h = input.h
        }
        if (input.meta) card.meta = { ...card.meta, ...input.meta }

        // 文件落在某个分区文件夹内就归该分区（与拖入 / 粘贴同规则）
        const fileDir = dirnameOf(input.absolutePath)
        const partition = useBoardStore
          .getState()
          .partitions.find((item) => item.folderPath === relativePathOf(fileDir, space.folderPath))

        const dest: DropDestination = {
          destDir: fileDir,
          partitionId: partition?.id ?? null,
          groupName: partition?.name ?? null,
        }
        if (partition) card.group = partition.name

        // undoable === false（插件现画的二进制文件）→ 只加卡不入撤销栈：
        // 撤销会删掉命令记录的文件，而 redo 没有源文件可重新复制（见 types.ts）
        if (input.undoable === false) {
          useBoardStore.getState().addCards([card])
          writer.schedule()
        } else {
          // createdFiles 传空：文件是插件写的，不属于本次命令，undo 不该删它
          await commitIngestedCards([card], [], [{ src: '', destDir: fileDir }], dest)
        }
        return true
      },
    })

    return () => setPluginBoardBridge(null)
  }, [buildIngestedCard, commitIngestedCards, viewportCenterCanvasPoint, writer])

  /**
   * Ctrl+V 粘贴的确定性落盘目标（2026-09-12 用户裁决「行为一致且可预期」；
   * 2026-09-13 用户裁决：未分组文件直接放空间主目录，不再创建「未分类」文件夹）：
   *   · 当前选中了分区框（按下分区即选中，见 Canvas）→ 该分区对应的子文件夹；
   *   · 否则 → 空间主目录（根目录）。
   * ⚠️ 不再看视口中心落在哪个分区 —— 落点猜测正是「有时未分类、有时别的文件夹」
   * 的根源；指定目标的显式路径（分区右键粘贴 / 空白右键粘贴）不走这里。
   */
  const resolvePasteDestination = useCallback((): DropDestination | null => {
    const space = useSpacesStore.getState().getCurrentSpace()
    if (!space) return null
    const snapshot = useBoardStore.getState()
    const partition = snapshot.selectedPartitionId
      ? snapshot.partitions.find((item) => item.id === snapshot.selectedPartitionId)
      : null
    if (partition) {
      return {
        destDir: joinPath(space.folderPath, partition.folderPath),
        partitionId: partition.id,
        groupName: partition.name,
      }
    }
    return {
      destDir: space.folderPath,
      partitionId: null,
      groupName: null,
    }
  }, [])

  /** T3.8 粘贴截图：剪贴板二进制 → 落盘为 粘贴-YYYYMMDD-HHmm.png → 卡片 */
  const handlePasteImage = useCallback(
    async (bytes: Uint8Array) => {
      const api = canvasApiRef.current
      const space = useSpacesStore.getState().getCurrentSpace()
      if (!api || !space) return
      if (useBoardStore.getState().readOnly) {
        setActionError('布局由更新版本创建，处于只读模式，无法粘贴')
        return
      }
      setActionError(null)

      try {
        // 落盘目标（2026-09-12 用户裁决；2026-09-13 起未分组直接落空间主目录）：
        // 选中分区 → 该分区；否则 → 空间根目录。
        // 卡片仍出现在视口中心（粘贴没有指针位置），但归哪个文件夹不再靠落点猜。
        const dest = resolvePasteDestination()
        if (!dest) return

        const point = viewportCenterCanvasPoint()
        if (!point) return

        const actualAbs = await localStorageProvider.writeFileBytes(
          dest.destDir,
          pasteFileName(new Date()),
          bytes,
        )

        const id = nextCardId(usedCardIds())
        const card = await buildIngestedCard({
          id,
          actualAbs,
          spacePath: space.folderPath,
          point,
          offset: 0,
        })
        if (dest.groupName) card.group = dest.groupName

        await commitIngestedCards([card], [actualAbs], [{ src: '', destDir: dest.destDir }], dest)
      } catch (error) {
        setActionError(`粘贴失败：${error instanceof Error ? error.message : String(error)}`)
      }
    },
    [buildIngestedCard, commitIngestedCards, resolvePasteDestination, viewportCenterCanvasPoint],
  )

  // ---- 复制 / 粘贴卡片（2026-09-11 用户裁决：三种类型全支持，同空间跨分区复制）----

  /**
   * 复制卡片（菜单 / Ctrl+C 共用）：应用内快照（粘贴回空间用）+ 系统剪贴板互通
   * （2026-09-13 用户裁决「文件优先」）。
   *   · 选区含文件卡 → 把绝对路径写入系统剪贴板（Windows CF_HDROP），
   *     资源管理器 / 桌面等外部软件 Ctrl+V 即粘贴文件；便签无磁盘文件不同步，
   *     但仍留在应用内剪贴板，可粘贴回空间；
   *   · 纯便签选区 → 写便签文本（CF_UNICODETEXT，可粘贴到记事本等）。
   * 写系统剪贴板失败不阻断应用内复制：提示即可——用户仍能粘贴回空间，
   * 但必须知道「外部粘贴不可用」（用户要求环境受限时给出明确提示）。
   */
  const handleCopyCards = useCallback(async (cards: Card[]) => {
    const copyable = cards.filter(isCopyableCard)
    if (copyable.length === 0) return
    setCopiedCards(copyable.map((card) => ({ ...card })))
    setActionError(null)

    const space = useSpacesStore.getState().getCurrentSpace()
    if (!space) return

    const filePaths = copyable
      .filter((card) => card.type !== 'note')
      .map((card) => joinPath(space.folderPath, card.originalPath || card.filePath))
    try {
      if (filePaths.length > 0) {
        await writeClipboardFiles(filePaths)
      } else {
        const text = copyable
          .filter((card) => card.type === 'note')
          .map((card) => card.note)
          .join('\n\n')
        if (text) await writeClipboardText(text)
      }
    } catch (error) {
      setActionError(
        `已在应用内复制，但写入系统剪贴板失败：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }, [])

  /**
   * 粘贴已复制的卡片到指定落点（T3.8 扩展，2026-09-11 用户裁决）：
   *   · 图片 —— 原图字节拷贝（保留清晰度）+ 新缩略图；
   *   · 文件 —— 原件拷贝（copyFile）；
   *   · 便签 —— 纯文字克隆，不产生任何文件。
   * 三种类型共用同一条 addCards 命令入撤销栈。
   */
  const pasteCards = useCallback(
    async (
      point: Point,
      destOverride?: { destDir: string; groupName: string | null; partitionId: string | null },
    ) => {
      const space = useSpacesStore.getState().getCurrentSpace()
      if (!space || copiedCards.length === 0) return
      if (useBoardStore.getState().readOnly) {
        setActionError('布局由更新版本创建，处于只读模式，无法粘贴')
        return
      }
      setActionError(null)

      const dest =
        destOverride ??
        // Ctrl+V（2026-09-12 用户裁决）：选中分区 → 该分区；否则 → 空间主目录（确定性规则）
        resolvePasteDestination()
      if (!dest) return

      const cards: Card[] = []
      const createdFiles: string[] = []
      const sources: AddCardsSource[] = []
      const usedIds = usedCardIds()
      let offset = 0
      const failures: string[] = []
      /** 依次取出不撞号的 id（usedIds 每轮都会追加，同一批粘贴内部也不会重号） */
      const takeId = () => nextCardId(usedIds)

      for (const copied of copiedCards) {
        try {
          // 便签：没有硬盘文件，直接克隆文字内容与尺寸
          if (copied.type === 'note') {
            const id = takeId()
            const note = zCardSchema.parse({
              id,
              type: 'note',
              filePath: '',
              originalPath: '',
              x: Math.round(point.x + offset),
              y: Math.round(point.y + offset),
              w: copied.w,
              h: copied.h,
              note: copied.note,
            })
            if (dest.groupName) note.group = dest.groupName

            usedIds.push(id)
            cards.push(note)
            offset += 24
            continue
          }

          // 图片 / 文件：originalPath 是相对空间文件夹的路径 → 还原成绝对路径做源
          const src = joinPath(space.folderPath, copied.originalPath || copied.filePath)
          const id = takeId()

          // 图片与非图片统一走 copy_file（方案 A：复制时不再生成缩略图）
          const actualAbs = await localStorageProvider.copyFile(src, dest.destDir)
          const card = await buildIngestedCard({
            id,
            actualAbs,
            spacePath: space.folderPath,
            point,
            offset,
          })
          if (dest.groupName) card.group = dest.groupName

          usedIds.push(id)
          // 2026-09-13 用户裁决：粘贴仅复制内容本身（图片 = 复制原图字节），
          // 原卡的备注与标签不带到新卡；尺寸位置分组等其余行为不变
          cards.push(cardWithoutEditables(card))
          createdFiles.push(actualAbs)
          sources.push({ src, destDir: dest.destDir })
          offset += 24
        } catch (error) {
          const label = copied.type === 'note' ? '便签' : basenameOf(copied.filePath)
          failures.push(`${label}（${error instanceof Error ? error.message : String(error)}）`)
        }
      }

      if (failures.length > 0) {
        setActionError(`以下内容粘贴失败：${failures.join('；')}`)
      }
      if (cards.length === 0) return

      await commitIngestedCards(cards, createdFiles, sources, {
        destDir: dest.destDir,
        groupName: dest.groupName,
        partitionId: dest.partitionId,
      })
    },
    [copiedCards, buildIngestedCard, commitIngestedCards, resolvePasteDestination],
  )

  /**
   * 系统剪贴板文件互通 · 进方向（2026-09-13 用户要求）：读系统剪贴板里的文件
   * 路径并粘贴进空间。落盘目标与 Ctrl+V 粘贴卡片同规则（resolvePasteDestination：
   * 选中分区 → 该分区，否则空间主目录，不靠落点猜测）；落点为视口中心；
   * 复用拖入的导入链路（copy 进空间，铁律②原件不动）。
   * 剪贴板上没有文件（截图 / 纯文本）时静默返回——原生 paste 事件照常处理
   * 截图（T3.8 链路不受影响）；非桌面环境 readClipboardFiles 直接返回空。
   */
  const pasteExternalFiles = useCallback(async () => {
    const paths = await readClipboardFiles()
    if (paths.length === 0) return

    const space = useSpacesStore.getState().getCurrentSpace()
    if (!space) return

    const dest = resolvePasteDestination()
    const point = viewportCenterCanvasPoint()
    if (!dest || !point) return

    await ingestExternalFiles(paths, space.folderPath, dest, point, '粘贴')
  }, [ingestExternalFiles, resolvePasteDestination, viewportCenterCanvasPoint])

  // 快捷键（Ctrl+C / Ctrl+V / Ctrl+Z / Ctrl+Shift+Z / Ctrl+S / Delete / Esc）统一在
  // 下方「快捷键派发」一处处理 —— 2026-09-13 起键位由快捷键注册中心决定，用户可改绑。
  // 这里刻意不再单独挂监听：同一事件被多个 effect 各判一遍，最容易在改绑后出现「漏判」。

  // T3.6 拖入监听：必须用 Tauri v2 的 onDragDropEvent（17.4：HTML5 drop 拿不到真实路径）。
  // 只有 drop 落下才处理；enter/over 不做高亮（第一阶段保持简单）。
  useEffect(() => {
    if (!isDesktopRuntime()) return

    let disposed = false
    let unlisten: (() => void) | null = null

    void getCurrentWebviewWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type !== 'drop') return
        const paths = event.payload.paths
        if (!paths || paths.length === 0) return
        // 物理坐标 → 窗口内逻辑坐标（WebView 缩放补偿）
        const dpr = window.devicePixelRatio || 1
        void handleDropFilesRef.current?.(paths, {
          x: event.payload.position.x / dpr,
          y: event.payload.position.y / dpr,
        })
      })
      .then((stop) => {
        if (disposed) stop()
        else unlisten = stop
      })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  /** handleDropFiles 的 ref：拖入监听只挂一次，始终调用最新实现 */
  const handleDropFilesRef = useRef<typeof handleDropFiles | null>(null)
  handleDropFilesRef.current = handleDropFiles

  // T3.8 粘贴监听：17.4 指定「前端 paste 事件 + clipboardData.items」
  useEffect(() => {
    const handler = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items
      if (!items) return
      // DataTransferItemList 没有迭代器：用索引遍历
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index]
        if (!item.type.startsWith('image/')) continue
        const file = item.getAsFile()
        if (!file) continue
        event.preventDefault()
        void file
          .arrayBuffer()
          .then((buffer: ArrayBuffer) => handlePasteImageRef.current?.(new Uint8Array(buffer)))
        return // 一份剪贴板只取第一张图
      }
    }

    window.addEventListener('paste', handler)
    return () => window.removeEventListener('paste', handler)
  }, [])

  /** handlePasteImage 的 ref：理由同上 */
  const handlePasteImageRef = useRef<typeof handlePasteImage | null>(null)
  handlePasteImageRef.current = handlePasteImage

  /**
   * 双击 / 菜单「打开原图」（T3.5 / 第九章）：
   * image 卡打开原图；file 卡用系统默认程序打开。
   * 打开失败（未关联程序等）降级为「在资源管理器中定位」并提示。
   */
  const openCardWithSystem = useCallback(
    async (card: Card) => {
      const space = useSpacesStore.getState().getCurrentSpace()
      if (!space) return
      // 便签没有文件；图片打开原图（未升级前 originalPath 也已登记）
      const absolutePath =
        card.type === 'note'
          ? ''
          : card.type === 'image'
            ? getCardOriginalPath(card.id)
            : joinPath(space.folderPath, card.filePath)
      if (absolutePath === '') {
        setActionError('便签没有关联的文件')
        return
      }

      try {
        await localStorageProvider.openWithDefault(absolutePath)
      } catch {
        try {
          await localStorageProvider.revealInExplorer(absolutePath)
          setActionError('系统未关联该文件类型的打开方式，已在资源管理器中定位')
        } catch (error) {
          setActionError(error instanceof Error ? error.message : String(error))
        }
      }
    },
    [],
  )

  /** 单击连线（T3.2）：连线与卡片选中互斥（5.1：选中集合全量替换） */
  const handleSelectConnections = useCallback((ids: string[]) => {
    useBoardStore.setState({
      selectedConnectionIds: [...ids],
      ...(ids.length > 0 ? { selectedIds: [] } : {}),
    })
  }, [])

  /** 选中分区框（2026-09-12）：Ctrl+V 粘贴目标跟随选中的分区；传 null 取消 */
  const handleSelectPartition = useCallback((id: string | null) => {
    selectPartition(id)
  }, [selectPartition])

  /** 创建连线（T3.1）：一条命令入撤销栈，undo 删除连线 */  const handleCreateConnection = useCallback(
    (fromCardId: string, toCardId: string) => {
      const snapshot = useBoardStore.getState()
      if (snapshot.readOnly) {
        setActionError('布局由更新版本创建，处于只读模式，无法连线')
        return
      }
      // 同一条连线（同 from 同 to）不重复建
      if (
        snapshot.connections.some(
          (connection) => connection.from === fromCardId && connection.to === toCardId,
        )
      ) {
        setActionError('这两张卡片之间已经有连线了')
        return
      }

      setActionError(null)
      const existingIds = snapshot.connections.map((connection) => connection.id)
      const connection: Connection = {
        id: nextConnectionId(existingIds),
        from: fromCardId,
        to: toCardId,
        label: '',
        color: 'gray',
        meta: {},
      }
      void history.execute(
        createConnectionCommand(
          connection,
          (conn) => useBoardStore.getState().addConnection(conn),
          (ids) => useBoardStore.getState().removeConnections(ids),
        ),
      )
      writer.schedule()
    },
    [history, writer],
  )

  /** 双击连线（T3.2）：浮层输入标签 */
  const handleEditConnectionLabel = useCallback(
    (id: string) => {
      const connection = useBoardStore.getState().connections.find((item) => item.id === id)
      if (!connection) return
      setPrompt({
        title: '连线标签',
        value: connection.label,
        onConfirm: (value) => {
          if (value === connection.label) return
          void history
            .execute(
              createSetConnectionLabelCommand(
                id,
                connection.label,
                value,
                (connId, label) => useBoardStore.getState().setConnectionLabel(connId, label),
              ),
            )
            .then(() => writer.schedule())
        },
      })
    },
    [history, writer],
  )

  /** 新建便签（T3.4）：在指定画布位置放一张空便签 */
  const createNoteAt = useCallback(
    (x: number, y: number) => {
      const snapshot = useBoardStore.getState()
      if (snapshot.readOnly) {
        setActionError('布局由更新版本创建，处于只读模式，无法新建便签')
        return
      }
      setActionError(null)

      const id = nextCardId(usedCardIds())
      const note = zCardSchema.parse({
        id,
        type: 'note',
        filePath: '',
        originalPath: '',
        x: Math.round(x),
        y: Math.round(y),
        w: 200,
        h: 160,
      })

      void history
        .execute(
          createAddCardsCommand(
            { cards: [note], createdFiles: [], sources: [] },
            {
              provider: localStorageProvider,
              applyAdd: (cards) => useBoardStore.getState().addCards(cards),
              applyRemove: (ids) => useBoardStore.getState().removeCardsLocally(ids),
            },
          ),
        )
        .then(() => writer.schedule())
    },
    [history, writer],
  )

  /** 双击便签（T3.4）：浮层编辑内容，提交走 setCardNote 命令 */
  /**
   * 便签行内编辑结束（用户要求：双击便签直接在便签本体内编辑，替代原弹窗）。
   * Canvas 负责编辑态；这里只负责把最终草稿走既有命令链（撤销栈 + 防抖落盘）。
   * 值没变就不入栈；找不到卡片（已移除视图 / 刚被删）直接忽略。
   */
  const handleCommitNote = useCallback(
    (cardId: string, value: string) => {
      const state = useBoardStore.getState()
      const card = state.cards.find((item) => item.id === cardId)
      if (!card) return
      if (value === card.note) return
      void history
        .execute(
          createSetCardNoteCommand(
            card.id,
            card.note,
            value,
            (id, note) => useBoardStore.getState().updateCardNote(id, note),
          ),
        )
        .then(() => writer.schedule())
    },
    [history, writer],
  )

  /** 加备注 / 编辑备注（T3.3）：与便签共用 note 字段，但入口是右键菜单 */
  const handleCardNote = useCallback(
    (card: Card) => {
      setPrompt({
        title: `备注（${card.filePath || '便签'}）`,
        value: card.note,
        multiline: true,
        placeholder: '在这张卡片上写下想法…',
        onConfirm: (value) => {
          if (value === card.note) return
          void history
            .execute(
              createSetCardNoteCommand(
                card.id,
                card.note,
                value,
                (id, note) => useBoardStore.getState().updateCardNote(id, note),
              ),
            )
            .then(() => writer.schedule())
        },
      })
    },
    [history, writer],
  )

  /** 编辑标签（T3.9）：逗号分隔，存 card.meta.tags */
  const handleCardTags = useCallback(
    (card: Card) => {
      setPrompt({
        title: '编辑标签（用逗号分隔）',
        value: tagsOfMeta(card.meta).join(', '),
        placeholder: '例如：参考, 外立面, 待定',
        onConfirm: (value) => {
          const tags = value
            .split(/[,，]/)
            .map((tag) => tag.trim())
            .filter((tag) => tag !== '')
          void history
            .execute(
              createSetCardMetaCommand(
                card.id,
                card.meta,
                metaWithTags(card.meta, tags),
                (id, meta) => useBoardStore.getState().setCardMeta(id, meta),
              ),
            )
            .then(() => writer.schedule())
        },
      })
    },
    [history, writer],
  )

  /** 置顶 / 置底（T3.9）：一条命令，可撤销 */
  const handleCardZIndex = useCallback(
    (cardId: string, to: 'front' | 'back') => {
      const snapshot = useBoardStore.getState()
      const deltas = zIndexDeltasFor(
        snapshot.cards.map((card) => ({ id: card.id, zIndex: card.zIndex })),
        [cardId],
        to,
      )
      if (deltas.length === 0) return
      void history
        .execute(
          createSetCardsZIndexCommand(deltas, (updates) =>
            useBoardStore.getState().setCardsZIndex(updates),
          ),
        )
        .then(() => writer.schedule())
    },
    [history, writer],
  )

  /** 指定分区颜色（T3.9）：弹出色板二级菜单（项由 pages/board/contextMenus 组装） */
  const handlePartitionColor = useCallback(
    (partitionId: string, screen: { x: number; y: number }) => {
      const current = useBoardStore
        .getState()
        .partitions.find((partition) => partition.id === partitionId)
      if (!current) return

      // 记下改色前的值，命令的 undo 用它还原
      const previousColor = current.color
      const items = buildPartitionColorItems((color) => {
        void history
          .execute(
            createSetPartitionColorCommand(
              partitionId,
              previousColor,
              color,
              (id, next) => useBoardStore.getState().setPartitionColor(id, next),
            ),
          )
          .then(() => writer.schedule())
      })
      setContextMenu({ x: screen.x, y: screen.y, items })
    },
    [history, writer],
  )

  /**
   * 移动卡片到文件夹（2026-09-12 用户裁决「画布内切换图片所属文件夹」）：
   * 弹出二级菜单列出全部分区 + `未分类`（= 空间主目录，2026-09-13 起「未分类」
   * 不再是物理文件夹）；选定后走 moveCardToFolder 命令 ——
   * 物理文件 moveFile + 卡片 filePath / originalPath / group 更新 +
   * 目标分区扩框，undo 全部还原。文件列表与画布显示经 store 同步刷新。
   */
  const handleCardMove = useCallback(
    (card: Card, screen: { x: number; y: number }) => {
      const snapshot = useBoardStore.getState()
      const space = useSpacesStore.getState().getCurrentSpace()
      if (!space) return
      if (snapshot.readOnly) {
        setActionError('布局由更新版本创建，处于只读模式，无法移动')
        return
      }
      if (card.filePath === '') return

      const move = (
        targetFolderRel: string,
        groupName: string | undefined,
        partition: Partition | null,
      ) => {
        void history
          .execute(
            createMoveCardToFolderCommand(card, targetFolderRel, groupName, partition, {
              spacePath: space.folderPath,
              provider: localStorageProvider,
              // 资源表写入必须早于 store 更新（渲染时读快照，方案 A 裁决 6）；
              // undo 复用同一路径把原图绝对路径写回旧值
              applyUpdate: (updates) => {
                if (card.type === 'image') {
                  for (const update of updates) {
                    setCardAsset(update.id, {
                      originalPath: joinPath(space.folderPath, update.filePath),
                    })
                  }
                }
                useBoardStore.getState().setCardFileRefs(updates)
              },
              applyPartitionRects: (rects) => useBoardStore.getState().setPartitionRects(rects),
            }),
          )
          .then(() => writer.schedule())
          .catch((error: unknown) => {
            setActionError(
              error instanceof Error ? `移动失败：${error.message}` : String(error),
            )
          })
      }

      const items = buildCardMoveItems({
        partitions: snapshot.partitions,
        currentFolder: currentTopFolderOf(card.filePath),
        onMove: move,
      })

      if (items.length === 0) {
        setActionError('没有可移动到的其他文件夹')
        return
      }
      setContextMenu({ x: screen.x, y: screen.y, items })
    },
    [history, writer],
  )

  /** 删除连线（T3.2 / 断开连接）：一条命令入撤销栈，undo 原样恢复（含标签） */
  const handleRemoveConnections = useCallback(
    (ids: string[]) => {
      const snapshot = useBoardStore.getState()
      const targets = snapshot.connections.filter((connection) => ids.includes(connection.id))
      if (targets.length === 0) return
      void history
        .execute(
          createRemoveConnectionsCommand(
            targets,
            (connection) => useBoardStore.getState().addConnection(connection),
            (ids) => useBoardStore.getState().removeConnections(ids),
          ),
        )
        .then(() => writer.schedule())
    },
    [history, writer],
  )

  // ---- T3.9 菜单动作登记（一次性）：配置中心的动作 id → 本组件的真实实现 ----
  // 菜单项本身来自 menus.ts 配置中心（buildCardMenuFor / buildPartitionMenuFor），
  // 这里只负责「id → 动作」的登记，杜绝在浮层里硬编码菜单项。
  useEffect(() => {
    const register = (id: string, run: (ctx: { card?: Card; partition?: import('@/core/types').Partition; connection?: Connection }) => void) => {
      registerAction(id, (ctx) => run({ card: ctx.card, partition: ctx.partition, connection: ctx.connection }))
    }

    register(CARD_ACTION.openOriginal, ({ card }) => {
      if (card) void openCardWithSystem(card)
    })
    register(CARD_ACTION.remove, ({ card }) => {
      if (card) handleRemoveCards([card.id])
    })
    register(CARD_ACTION.bringToFront, ({ card }) => {
      if (card) handleCardZIndex(card.id, 'front')
    })
    register(CARD_ACTION.sendToBack, ({ card }) => {
      if (card) handleCardZIndex(card.id, 'back')
    })
    register(CARD_ACTION.addNote, ({ card }) => {
      if (!card) return
      // 便签：复用双击的行内编辑态（用户要求：便签编辑不再弹窗）
      if (card.type === 'note') {
        canvasApiRef.current?.beginNoteEdit(card.id)
        return
      }
      handleCardNote(card)
    })
    register(CARD_ACTION.editLabel, ({ card }) => {
      if (card) handleCardTags(card)
    })
    // 「连线」：进入挂起模式，下一张点中的卡片为目标（配合边缘拖拽，T3.1）
    register(CARD_ACTION.connect, ({ card }) => {
      if (card) setPendingConnectFrom(card.id)
    })
    // 「复制」（2026-09-11 用户裁决：三种类型全支持）：菜单 / Ctrl+C 同一实现
    register(CARD_ACTION.copy, ({ card }) => {
      if (card) void handleCopyCards([card])
    })
    // 「粘贴」：粘贴进目标分区（落点 = 分区中心），拷贝原件或克隆便签
    register(PARTITION_ACTION.paste, ({ partition }) => {
      if (!partition) return
      const spacePath = useSpacesStore.getState().getCurrentSpace()?.folderPath
      if (!spacePath) return
      const center = {
        x: partition.x + partition.w / 2,
        y:
          partition.y +
          (partition.collapsed
            ? PARTITION_TITLE_HEIGHT / 2
            : PARTITION_TITLE_HEIGHT + (partition.h - PARTITION_TITLE_HEIGHT) / 2),
      }
      void pasteCards(center, {
        destDir: joinPath(spacePath, partition.folderPath),
        groupName: partition.name,
        partitionId: partition.id,
      })
    })
    register(PARTITION_ACTION.rename, ({ partition }) => {
      if (partition) void handleRenamePartition(partition.id, partition.name)
    })
    register(PARTITION_ACTION.toggleCollapse, ({ partition }) => {
      if (partition) handleTogglePartitionCollapsed(partition.id)
    })
    // 连线菜单：编辑标签（同双击）/ 删除连线（断开连接，2026-09-11 用户裁决）
    register(CONNECTION_ACTION.editLabel, ({ connection }) => {
      if (connection) handleEditConnectionLabel(connection.id)
    })
    register(CONNECTION_ACTION.remove, ({ connection }) => {
      if (connection) handleRemoveConnections([connection.id])
    })
  }, [
    handleRemoveCards,
    handleCardZIndex,
    handleCardNote,
    handleCardTags,
    openCardWithSystem,
    handleRenamePartition,
    handleTogglePartitionCollapsed,
    handleEditConnectionLabel,
    handleRemoveConnections,
    handleCopyCards,
    pasteCards,
  ])

  /** 撤销 / 重做（T2.9 / 7.4）：命令的 undo/redo 已含文件回滚，成功后同步落盘。
   *  ⚠️ 定义位置必须早于下方右键菜单构造 —— 菜单的 deps 数组在渲染时就要求值，
   *     放到后面会命中 const 的暂时性死区（TDZ）。 */
  const handleUndo = useCallback(() => {
    void history.undo().then((ok) => {
      if (ok) writer.schedule()
    })
  }, [history, writer])

  const handleRedo = useCallback(() => {
    void history.redo().then((ok) => {
      if (ok) writer.schedule()
    })
  }, [history, writer])

  // ---- T3.9 右键菜单的弹出入口：菜单数组由 pages/board/contextMenus 组装 ----
  // 这里只负责「取上下文 + 放入浮层 state」；菜单项配置与回调映射都在那边。

  const handleCardContextMenu = useCallback(
    (card: Card, screen: { x: number; y: number }) => {
      const items = buildCardMenuItems({
        card,
        screen,
        spacePath: useSpacesStore.getState().getCurrentSpace()?.folderPath ?? '',
        removedView,
        selectedIds,
        onMove: handleCardMove,
        onRestore: handleRestoreCards,
      })
      setContextMenu({ x: screen.x, y: screen.y, items })
    },
    [handleCardMove, removedView, selectedIds, handleRestoreCards],
  )

  const handlePartitionContextMenu = useCallback(
    (partition: Partition, screen: { x: number; y: number }) => {
      const items = buildPartitionMenuItems({
        partition,
        screen,
        spacePath: useSpacesStore.getState().getCurrentSpace()?.folderPath ?? '',
        hasCopiedCards: copiedCards.length > 0,
        onSetColor: handlePartitionColor,
      })
      setContextMenu({ x: screen.x, y: screen.y, items })
    },
    [handlePartitionColor, copiedCards.length],
  )

  const handleConnectionContextMenu = useCallback(
    (connectionId: string, screen: { x: number; y: number }) => {
      const connection = useBoardStore.getState().connections.find((item) => item.id === connectionId)
      if (!connection) return
      const items = buildConnectionMenuItems({
        connection,
        spacePath: useSpacesStore.getState().getCurrentSpace()?.folderPath ?? '',
      })
      setContextMenu({ x: screen.x, y: screen.y, items })
    },
    [],
  )

  /**
   * 新建分区（2026-09-14 用户要求：空间内直接创建分区，创建后在对应空间文件夹下
   * 自动生成同名文件夹）。命名浮层、校验、查重、命令编排全在
   * pages/board/createPartitionFlow.ts —— Board 只留这一行接线（行数棘轮）。
   */
  const handleCreatePartitionAt = useCallback(
    (point: { x: number; y: number }) =>
      openCreatePartitionPrompt(point, { history, writer, setPrompt, setActionError }),
    [history, writer],
  )

  const handleCanvasContextMenu = useCallback(
    (canvasPoint: { x: number; y: number }, screen: { x: number; y: number }) => {
      const items = buildCanvasMenuItems({
        canvasPoint,
        // 插件菜单项的 action 要拿它（如色卡的默认输出目录）
        spacePath: useSpacesStore.getState().getCurrentSpace()?.folderPath ?? '',
        hasCopiedCards: copiedCards.length > 0,
        onCreateNote: createNoteAt,
        onCreatePartition: handleCreatePartitionAt,
        // 2026-09-12：右键位置就是用户显式指定的落点 —— 点在哪个分区内就归哪个
        // 分区的文件夹，点在空白归空间主目录（2026-09-13 起「未分类」不再是文件夹）
        onPaste: (point) => {
          const spacePath = useSpacesStore.getState().getCurrentSpace()?.folderPath
          if (!spacePath) return
          void pasteCards(
            point,
            resolveDropDestination(point, useBoardStore.getState().partitions, spacePath),
          )
        },
        onUndo: handleUndo,
        onRedo: handleRedo,
      })
      setContextMenu({ x: screen.x, y: screen.y, items })
    },
    [createNoteAt, handleCreatePartitionAt, copiedCards.length, pasteCards, handleUndo, handleRedo],
  )

  // Delete 删除选中的连线 / Esc 取消挂起连线：同样收进下方「快捷键派发」一处处理

  // -------------------------------------------------------------------------
  // 进入 / 离开空间
  // -------------------------------------------------------------------------

  // 只在空间 id 变化时加载：依赖里不放 space 对象，避免 spaces 更新导致重复读取文件夹
  useEffect(() => {
    if (!currentSpaceId) return
    resetViewportSnapshot()
    history.clear() // 7.4：撤销历史仅本次运行有效，切空间即清空

    const target = useSpacesStore.getState().getCurrentSpace()
    if (target) {
      void useBoardStore.getState().loadSpace(target).then(() => {
        // 本次加载修复过历史脏数据（id 撞号去重 / 脏 originalPath 回填）→ 立刻落盘一次。
        // 不落盘的话修复只停在内存：用户随后的操作一旦抛错（命令不入栈、不写盘），
        // 磁盘上的坏数据会一直保留，且期间的操作继续在坏数据上出错。
        if (useBoardStore.getState().needsMigration) void writer.flush()
      })
    }

    return () => {
      useBoardStore.getState().reset()
    }
  }, [currentSpaceId, history, writer])

  // 窗口关闭前强制落盘（17.6）
  useEffect(() => {
    if (!isDesktopRuntime()) return

    let disposed = false
    let unlisten: (() => void) | null = null

    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault()
        await writer.flush()
        await getCurrentWindow().destroy()
      })
      .then((stop) => {
        if (disposed) stop()
        else unlisten = stop
      })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [writer])

  // ---- 快捷键派发（2026-09-13 改绑支持）----
  // 板级操作一处收齐：复制 / 粘贴 / 撤销 / 重做 / 立即保存 / 移除连线 / 取消挂起连线。
  // 键位不再写死 —— resolveShortcut 按快捷键注册中心的当前绑定（含遗留组合键）派发，
  // 用户在设置面板改绑后立刻生效（同步读 getState()，不进 React 订阅）。
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const action = resolveShortcut(event, useShortcutsStore.getState().bindings)
      if (!action) return

      // Esc 取消挂起连线（T3.9 提示条里的说明）：挂在输入框守卫之前，
      // 与旧实现一致（旧版 Esc 分支没有输入框判断）
      if (action === 'canvas.escape') {
        if (pendingConnectFrom) setPendingConnectFrom(null)
        return
      }

      // 输入框里的按键不拦截（复制 / 粘贴 / 撤销在输入框里另有语义）
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return
      }

      if (action === 'edit.undo') {
        event.preventDefault()
        handleUndo()
        return
      }
      if (action === 'edit.redo') {
        event.preventDefault()
        handleRedo()
        return
      }
      if (action === 'layout.save') {
        event.preventDefault()
        void writer.flush()
        return
      }

      // 已移除视图下不提供复制 / 粘贴 / 删除
      if (removedView) return

      if (action === 'card.copy') {
        if (selectedIds.length === 0) return
        const snapshot = useBoardStore.getState()
        const picked = snapshot.cards.filter(
          (card) => selectedIds.includes(card.id) && isCopyableCard(card),
        )
        if (picked.length === 0) return
        event.preventDefault()
        void handleCopyCards(picked)
        return
      }

      if (action === 'card.paste') {
        if (copiedCards.length === 0) {
          // 应用内剪贴板为空：尝试系统剪贴板文件（2026-09-13 跨应用互通）。
          // 剪贴板上没有文件（截图 / 纯文本）时这里静默返回，
          // 原生 paste 事件照常触发截图粘贴（T3.8），因此不 preventDefault
          void pasteExternalFiles()
          return
        }
        event.preventDefault()
        const point = viewportCenterCanvasPoint()
        if (point) void pasteCards(point)
        return
      }

      // Delete 删除选中的连线（T3.2）。卡片删除由 Canvas 侧处理，二者互斥：
      // 同时选中卡片和连线时优先删卡片（视觉焦点在卡片上）
      if (action === 'card.remove') {
        if (selectedIds.length > 0 || selectedConnectionIds.length === 0) return
        event.preventDefault()
        handleRemoveConnections(selectedConnectionIds)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    removedView,
    pendingConnectFrom,
    selectedIds,
    selectedConnectionIds,
    copiedCards,
    handleCopyCards,
    pasteCards,
    pasteExternalFiles,
    viewportCenterCanvasPoint,
    handleUndo,
    handleRedo,
    handleRemoveConnections,
    writer,
  ])

  const handleBack = async () => {
    // 切空间前强制落盘，再清状态（顺序不能反：build 依赖 store 里的空间 id）
    await writer.flush()
    writer.cancel()
    resetViewportSnapshot()
    useBoardStore.getState().reset()
    closeSpace()
  }

  // -------------------------------------------------------------------------
  // 渲染
  // -------------------------------------------------------------------------

  return (
    <div className="relative flex h-full w-full flex-col bg-background">
      {/* flex-wrap：窄窗口时按钮换行而不是溢出（2026-09-12 响应式） */}
      <header className="flex flex-wrap items-center gap-3 gap-y-2 border-b border-border px-5 py-3">
        <Button variant="outline" onClick={() => void handleBack()}>
          返回列表
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-medium">{space?.name ?? '未命名空间'}</h1>
          <p className="truncate text-[11px] text-muted-foreground" title={space?.folderPath}>
            {space?.folderPath}
          </p>
        </div>
        {/* 右侧按钮组（2026-09-13 用户裁决）：显示已移除 → 切换深浅色模式 → 设置。
            三者同属「全局开关」，合并进一个 ml-auto 容器 —— 只有一个自动外边距，
            窄窗口换行时整组仍然贴右，不会出现按钮散落在行首的情况 */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {readOnly ? (
            <span className="shrink-0 rounded bg-destructive/15 px-1.5 py-0.5 text-[11px] text-destructive">
              只读
            </span>
          ) : null}
          <span className="shrink-0 rounded bg-secondary/15 px-1.5 py-0.5 text-[11px] text-secondary">
            {space?.type}
          </span>

          {/* 显示已移除（仅空间内有意义）：数量用计数徽标承载，不写成文字 */}
          <Button
            variant="outline"
            size="icon"
            className="relative shrink-0"
            title={
              removedView
                ? SETTINGS_TEXT.removedBack
                : `${SETTINGS_TEXT.removedShow}${removed.length > 0 ? `（${removed.length}）` : ''}`
            }
            aria-label={removedView ? SETTINGS_TEXT.removedBack : SETTINGS_TEXT.removedShow}
            onClick={handleToggleRemovedView}
          >
            {removedView ? <ArrowLeftIcon /> : <ArchiveIcon />}
            {!removedView && removed.length > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 min-w-[14px] rounded-full bg-primary px-0.5 text-center text-[9px] font-medium leading-[14px] text-primary-foreground">
                {removed.length}
              </span>
            ) : null}
          </Button>

          {/* 切换深浅色模式：纯图标（太阳 / 月亮二选一），按钮面上不出现文字 */}
          <Button
            variant="outline"
            size="icon"
            className="shrink-0"
            title={theme === 'dark' ? SETTINGS_TEXT.toLight : SETTINGS_TEXT.toDark}
            aria-label={theme === 'dark' ? SETTINGS_TEXT.toLight : SETTINGS_TEXT.toDark}
            onClick={handleToggleTheme}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </Button>

          {/* 设置（2026-09-13）：弹窗模式，内含「自定义快捷键」「版本更新」两页 */}
          <Button
            variant={settingsOpen ? 'default' : 'outline'}
            size="icon"
            className="shrink-0"
            title="设置（自定义快捷键 / 版本更新）"
            aria-label="设置"
            onClick={() => setSettingsOpen((value) => !value)}
          >
            <SettingsIcon />
          </Button>
        </div>
      </header>

      {/* 设置弹窗（2026-09-13 改弹窗模式）：可拖动标题栏移动、右下角缩放，
          位置尺寸记在 localStorage；不再依赖按钮位置，窄窗口也不会跑出视口 */}
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {status === 'error' ? (
        <div className="border-b border-destructive/40 bg-destructive/5 px-5 py-2 text-xs text-destructive">
          读取文件夹失败：{error}
        </div>
      ) : null}

      {notices.map((notice) => (
        <div
          key={notice}
          className="border-b border-accent/40 bg-accent/5 px-5 py-2 text-xs text-accent"
        >
          {notice}
        </div>
      ))}

      {saveError ? (
        <div className="border-b border-destructive/40 bg-destructive/5 px-5 py-2 text-xs text-destructive">
          布局保存失败：{saveError}
        </div>
      ) : null}

      {actionError ? (
        <div className="border-b border-destructive/40 bg-destructive/5 px-5 py-2 text-xs text-destructive">
          {actionError}
        </div>
      ) : null}

      {progress ? (
        <div className="border-b border-accent/40 bg-accent/5 px-5 py-2 text-xs text-accent">
          {progress.label}：{progress.done} / {progress.total}
        </div>
      ) : null}

      {status === 'ready' && cards.length > CARD_COUNT_WARNING ? (
        <div className="border-b border-accent/40 bg-accent/5 px-5 py-2 text-xs text-accent">
          卡片较多（{cards.length} 张），可能影响流畅度（17.7 建议单空间 ≤ {CARD_COUNT_WARNING} 张）
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1">
        {status === 'ready' ? (
          <>
            <Canvas
              cards={removedView ? removedCards : cards}
              partitions={removedView ? [] : partitions}
              selectedIds={selectedIds}
              initialView={canvas}
              onViewportChange={handleViewportChange}
              onSelectCards={handleSelectCards}
              onCommitMove={handleCommitMove}
              onCommitResize={handleCommitResize}
              onCommitPartitionMove={handleCommitPartitionMove}
              onCommitPartitionResize={handleCommitPartitionResize}
              onTogglePartitionCollapsed={handleTogglePartitionCollapsed}
              onRenamePartition={handleRenamePartition}
              onRemoveCards={handleRemoveCards}
              selectedPartitionId={removedView ? null : selectedPartitionId}
              onSelectPartition={handleSelectPartition}
              removedMode={removedView}
              connections={removedView ? [] : connections}
              selectedConnectionIds={selectedConnectionIds}
              onSelectConnections={handleSelectConnections}
              onEditConnectionLabel={handleEditConnectionLabel}
              onCreateConnection={handleCreateConnection}
              onCardContextMenu={handleCardContextMenu}
              onConnectionContextMenu={handleConnectionContextMenu}
              onPartitionContextMenu={handlePartitionContextMenu}
              onCanvasContextMenu={handleCanvasContextMenu}
              onOpenCard={(card) => void openCardWithSystem(card)}
              onCommitNote={handleCommitNote}
              onRequestSearch={search.openSearch}
              searchHitIds={search.hitIds}
              searchActiveId={search.activeId}
              pendingConnectFrom={pendingConnectFrom}
              registerCanvasApi={(api) => {
                canvasApiRef.current = api
              }}
            />

            {/* 搜索浮层（P1-3）：Ctrl+F 唤出。z-30 压过小地图（z-20）；定位在画布顶部居中 */}
            <CardSearchPanel
              open={search.open}
              query={search.query}
              items={search.items}
              activeIndex={search.activeIndex}
              panelClassName="left-1/2 top-3 -translate-x-1/2"
              onQueryChange={search.changeQuery}
              onStep={search.step}
              onPick={search.pick}
              onClose={search.closeSearch}
            />

            {/* 小地图（2026-09-12）：右下角概览当前位置；可收起。
                ⚠️ bottom-12：让开 Canvas 状态条复原视图按钮所在的 bottom-3 一行，
                两态（面板 / 入口按钮）都在其上方，互不遮挡 */}
            {minimapVisible ? (
              <MiniMap
                cards={cards}
                partitions={partitions}
                onJump={handleMinimapJump}
                registerRedraw={(fn) => {
                  minimapRedrawRef.current = fn
                }}
                onCollapse={() => handleMinimapVisibleChange(false)}
              />
            ) : null}
            {!minimapVisible ? (
              <button
                type="button"
                className="absolute bottom-12 right-3 z-20 flex h-7 items-center rounded-md border border-border bg-background/80 px-2 text-[11px] text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-background"
                onClick={() => handleMinimapVisibleChange(true)}
              >
                小地图
              </button>
            ) : null}
          </>
        ) : null}

        {status === 'loading' ? (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 text-sm text-muted-foreground">
            正在读取文件夹…
          </div>
        ) : null}

        {status === 'ready' && !removedView && cards.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <p className="text-sm text-muted-foreground">这个文件夹里没有可显示的文件</p>
            <p className="mt-1 text-xs text-muted-foreground">
              把图片直接放到空间文件夹里，或放到子文件夹（子文件夹会显示为分区框）
            </p>
          </div>
        ) : null}

        {status === 'ready' && removedView && removedCards.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <p className="text-sm text-muted-foreground">没有已移除的卡片</p>
            <p className="mt-1 text-xs text-muted-foreground">
              在画布上选中卡片按 Delete 移除后，会出现在这里
            </p>
          </div>
        ) : null}

        {/* T3.9 挂起连线模式提示：点中下一张卡片即完成连线 */}
        {pendingConnectFrom ? (
          <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded border border-primary/40 bg-primary/10 px-3 py-1 text-xs text-primary">
            连线中：请单击目标卡片（右键或按 Esc 取消）
          </div>
        ) : null}
      </div>

      {/* T3.9 右键菜单 / 输入浮层（菜单项一律由配置中心生成） */}
      <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />
      <PromptDialog state={prompt} onClose={() => setPrompt(null)} />
      {/* 插件自己的对话框（如「新建色卡」）：插件交出 render 函数，宿主在这里挂载 */}
      <PluginDialogHost />
    </div>
  )
}
