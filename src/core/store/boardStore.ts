// ============================================================================
// 模块说明（中文）
// 画布状态（Zustand）。对应 17.3：
//   「Zustand（低频、需要触发 React 重渲染的数据）：卡片「集合」本身
//     （增删卡片、改动 type/note）、分区框、连线」
//   —— 注意这里存的是**卡片集合**，不含拖拽中的坐标；拖拽中的 x/y 只写 DOM（见 17.3）。
//
// 阶段一职责：
//   T1.3 进入空间 → listDir → 生成卡片 → 交给 Canvas 渲染
//   T1.4 批量读取图片原始尺寸（read_image_size 只读图头），按宽高比摆好卡片
//   T1.6 读 layout.json 恢复卡片位置与视图状态；缺失/损坏时退回扫描文件夹
//
// 【缩略图已下线】（2026-09-12 用户裁决：方案 A）
//   不再生成缩略图，卡片直接加载原图（渲染走 lazyOriginal 的可见时加载）。
//
// 【资源路径不进 Zustand】
//   卡片的原图绝对路径存在 core/board/cardAssets.ts 的模块级表里，
//   原因见该文件顶部说明：它不是布局数据、不落盘、也不需要触发重渲染。
//
// 【竞态保护】
//   loadSpace 是异步的。用户快速「进入 A → 返回 → 进入 B」时，A 的请求可能后完成
//   把 B 的状态覆盖掉。这里用一个自增的 loadToken 做代数守卫：只有最后一次发起的
//   加载才允许写状态。
//
// 【落盘由谁负责】
//   本模块只维护内存态；什么时候写盘由 core/board/layoutWriter.ts 决定，
//   由画布页（pages/Board.tsx）接线。这样 store 保持纯粹、可单测。
//
// 工厂函数便于单元测试注入假 provider。
//
// 实现任务：T1.3 / T1.4 / T1.6（阶段一）。
// ============================================================================

import { create } from 'zustand'

import type {
  CanvasState,
  Card,
  Connection,
  Layout,
  Meta,
  Partition,
  RemovedEntry,
  Space,
} from '@/core/types'
import { DATA_VERSION, createEmptyLayout, parseLayout } from '@/core/types'
import { dedupeIds } from '@/core/utils/id'
import { joinPath } from '@/core/utils/paths'
import { StorageError } from '@/core/storage/StorageProvider'
import type { DirEntry, StorageProvider } from '@/core/storage/StorageProvider'
import { localStorageProvider } from '@/core/storage/LocalFolderProvider'
import { CORE_CARD_TYPE_DEFAULT_SIZE } from '@/core/registry/cardTypes'
import { createCardsFromEntries } from '@/core/board/buildCards'
import type { CardSize } from '@/core/board/buildCards'
import { cardTypeFor } from '@/core/board/imageTypes'
import { cardSizeForImage } from '@/core/board/cardSize'
import { collectImageSizes } from '@/core/board/imageSizes'
import type { ImageSizeBatchResult } from '@/core/board/imageSizes'
import { clearCardAssets, registerCardAssets } from '@/core/board/cardAssets'
import { mergeScannedWithLayout } from '@/core/board/layoutMerge'
import { DEFAULT_GRID_OPTIONS } from '@/core/board/grid'
import { PARTITION_PADDING, PARTITION_TITLE_HEIGHT, createPartitions, selectPartitionDirs } from '@/core/board/partitions'

/** 默认视图状态（无 layout 或读取失败时使用） */
const DEFAULT_CANVAS: CanvasState = { zoom: 1, offsetX: 0, offsetY: 0 }

/**
 * 扫描时相邻分区行带的垂直间隔（画布坐标）。
 * = 框内边距 × 2 + 标题条 + 视觉呼吸空间，保证两个分区框不相互贴住。
 */
const PARTITION_SCAN_GAP = PARTITION_PADDING * 2 + PARTITION_TITLE_HEIGHT + 40

export interface BoardState {
  /** 当前空间 id；null 表示未进入任何空间 */
  spaceId: string | null
  cards: Card[]
  partitions: Partition[]
  connections: Connection[]
  /**
   * 已移除记录（T2.7 起使用）。
   * 阶段一虽然不产生新记录，但**必须原样保留**，否则一次写盘就会把
   * 用户在后续版本里积累的 removed 数据抹掉。
   */
  removed: RemovedEntry[]
  /** 从 layout.json 恢复的视图状态（供 Canvas 初始化控制器） */
  canvas: CanvasState
  /**
   * 只读模式（17.6：读到 version > 1 时提示并只读）。
   * 为 true 时页面不应再写盘。
   */
  readOnly: boolean
  /**
   * 本次 loadSpace 是否修复过历史脏数据（id 撞号去重 / 脏 originalPath 回填）。
   *
   * 为 true 时上层（Board）应在加载完成后**主动落盘一次**。
   * 原因：修复只改内存，而落盘平时挂在「用户操作成功后」；
   * 一旦用户随后的操作抛错（命令不入栈、不写盘），磁盘上的坏数据会一直保留，
   * 每次进入空间都要重新修一遍，且期间的操作仍会在坏数据上出错。
   */
  needsMigration: boolean
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** 加载失败的中文原因（可直接展示） */
  error: string | null
  /** 非致命提示（缩略图失败 / 布局损坏 / 版本过高），可直接展示 */
  notices: string[]
  /**
   * 选中集合（17.3：选中集合属于「需要触发重渲染的低频数据」，进 Zustand）。
   * T2.2 单击选中 / 取消选中；T2.3 框选与多选拖动复用。
   */
  selectedIds: string[]
  /** 选中的连线（T3.2：单击连线选中，Delete 删除）。连线数量少，低频数据进 Zustand */
  selectedConnectionIds: string[]
  /** 选中的分区框（2026-09-12 用户裁决：Ctrl+V 粘贴目标 = 选中的分区；低频数据进 Zustand） */
  selectedPartitionId: string | null

  /** 设置选中集合（全量替换）。传空数组即取消选中（5.1 单击空白） */
  selectCards: (ids: string[]) => void
  /** 选中分区框（与卡片选中互斥，5.1 同一哲学）；传 null 取消 */
  selectPartition: (id: string | null) => void
  /**
   * 一次性写入多张卡片坐标（拖拽松手 / 撤销重做都走它）。
   * 只动 x / y，不触碰其他字段 —— 保持 store 更新面最小。
   */
  setCardPositions: (positions: { id: string; x: number; y: number }[]) => void
  /**
   * 一次性写入多张卡片尺寸（手柄缩放松手 / 撤销重做都走它，T2.3）。
   * 只动 w / h。
   */
  setCardSizes: (sizes: { id: string; w: number; h: number }[]) => void
  /**
   * 一次性写入多个分区框位置（拖框松手 / 撤销重做都走它，T2.5）。
   * 只动 x / y；框内卡片的位移由调用方一并写入 setCardPositions。
   */
  setPartitionPositions: (positions: { id: string; x: number; y: number }[]) => void
  /** 折叠 / 展开分区框（低频 UI 状态，直接 setState） */
  setPartitionCollapsed: (id: string, collapsed: boolean) => void
  /**
   * 分区框重命名（T2.6）：同步更新框的 name / folderPath 与框内卡片的 group。
   * groupFrom → groupTo 由命令层传入（undo 时是「新名 → 旧名」）。
   */
  renamePartition: (payload: {
    id: string
    name: string
    folderPath: string
    groupFrom: string
    groupTo: string
  }) => void
  /** 移除卡片（T2.7）：从画布消失 + removed 记录追加（文件移动由命令层完成） */
  applyRemoveCards: (payload: { cards: Card[]; entries: RemovedEntry[] }) => void
  /** 撤销移除 / 恢复（T2.7 / T2.8）：卡片放回 + removed 记录移除 */
  applyRestoreCards: (payload: { cards: Card[]; entryIds: string[] }) => void

  // ---- 阶段三（T3）：连线 / 备注 / 便签 / 拖入 / 右键菜单动作的状态落点 ----

  /** 追加卡片（新建便签 T3.4 / 拖入 T3.6 / 粘贴 T3.8 与对应命令的 undo 都走它） */
  addCards: (cards: Card[]) => void
  /** 从画布删除卡片（仅内存；文件清理由命令层负责）。addCards 的 undo 走它 */
  removeCardsLocally: (ids: string[]) => void
  /** 改备注（T3.3）。只动 note 字段 */
  updateCardNote: (id: string, note: string) => void
  /** 整体替换某张卡片的 meta（T3.9 编辑标签：meta.tags）。只动 meta 字段 */
  setCardMeta: (id: string, meta: Meta) => void
  /**
   * 一次性写入多张卡片的文件归属（2026-09-12「移动到…」功能）：
   * filePath / originalPath / group 一起更新，其余字段不动。
   * group 传 undefined 表示移出所有分区（未分类 / 空间根目录）。
   */
  setCardFileRefs: (updates: { id: string; filePath: string; originalPath: string; group: string | undefined }[]) => void
  /** 一次性写入多张卡片的 zIndex（置顶 / 置底 T3.9） */
  setCardsZIndex: (updates: { id: string; zIndex: number }[]) => void
  /** 指定分区框颜色（T3.9）。'auto' 表示回到 8 色轮换 */
  setPartitionColor: (id: string, color: string) => void
  /** 一次性写入分区框矩形（拖入框内后扩框包住新卡，T3.7）。x/y/w/h 一起更新 */
  setPartitionRects: (updates: { id: string; x: number; y: number; w: number; h: number }[]) => void
  /** 追加连线（T3.1 命令 do 与 undo 都走它） */
  addConnection: (connection: Connection) => void
  /** 批量追加连线（撤销「移除卡片」时把级联断开的连线原样放回） */
  addConnections: (connections: Connection[]) => void
  /** 删除连线（T3.2）。只动 connections，不级联其它状态 */
  removeConnections: (ids: string[]) => void
  /** 改连线标签（T3.2 双击编辑） */
  setConnectionLabel: (id: string, label: string) => void

  /** 是否处于「已移除」视图（T2.8 / 7.2） */
  removedView: boolean
  /** 已移除视图的卡片（扫描 `_已移除` 生成，id = removed 记录 id） */
  removedCards: Card[]
  /** 进入「已移除」视图：扫描 `_已移除` 目录生成灰卡（spacePath 由调用方传入） */
  loadRemovedView: (spacePath: string) => Promise<void>
  /** 离开「已移除」视图 */
  exitRemovedView: () => void

  /** 进入空间：读 layout → 扫描文件夹 → 合并 → 生成卡片 */
  loadSpace: (space: Space) => Promise<void>
  /** 离开空间：清空画布状态 */
  reset: () => void
}

/**
 * 单张卡片的初始尺寸。
 * 图片：按**原图尺寸**还原原始宽高比（read_image_size 只读图头，不解码全图）；
 * 尺寸读取失败时退回该类型的默认尺寸。
 */
function sizeForEntry(entry: DirEntry, sizes: ImageSizeBatchResult): CardSize {
  const type = cardTypeFor(entry.name)
  const info = sizes.byName.get(entry.name)
  if (type === 'image' && info) {
    return cardSizeForImage(info.width, info.height)
  }
  return CORE_CARD_TYPE_DEFAULT_SIZE[type]
}

/** 把尺寸读取失败清单收敛成一条人话提示（最多列 3 个文件名） */
function imageSizeNotice(sizes: ImageSizeBatchResult): string[] {
  if (sizes.failed.size === 0) return []

  const shown = [...sizes.failed.entries()].slice(0, 3).map(([name, reason]) => `${name}（${reason}）`)
  const more = sizes.failed.size > shown.length ? ` 等 ${sizes.failed.size} 个文件` : ''
  return [`${shown.join('；')}${more} 的图片尺寸读取失败，已按默认尺寸显示`]
}

/**
 * 读 layout.json。
 * 返回 layout、只读标志与提示；任何失败都退回空布局（不阻断进入空间）。
 */
async function readLayoutOrEmpty(
  provider: StorageProvider,
  space: Space,
): Promise<{ layout: Layout; readOnly: boolean; notices: string[] }> {
  try {
    const raw = await provider.readLayout(space.folderPath)
    const parsed = parseLayout(raw)

    if (!parsed.ok) {
      return {
        layout: createEmptyLayout(),
        readOnly: false,
        notices: [`布局数据无法识别（${parsed.error}），已改用全新布局`],
      }
    }

    const readOnly = parsed.data.version > DATA_VERSION
    const notices = readOnly
      ? [
          `该空间的布局文件由更新版本创建（version ${parsed.data.version}），` +
            '已按只读模式打开，部分数据可能无法显示',
        ]
      : []

    return { layout: parsed.data, readOnly, notices }
  } catch (error) {
    // 17.6：文件损坏时 Rust 侧已把原文件备份为 layout.json.bak，这里改用空布局继续
    if (error instanceof StorageError && error.isLayoutCorrupt) {
      return { layout: createEmptyLayout(), readOnly: false, notices: [error.message] }
    }
    return {
      layout: createEmptyLayout(),
      readOnly: false,
      notices: [
        `读取布局文件失败（${error instanceof Error ? error.message : String(error)}），已改用全新布局`,
      ],
    }
  }
}

export function createBoardStore(provider: StorageProvider = localStorageProvider) {
  /** 加载代数守卫：只有最后一次 loadSpace 允许写状态 */
  let loadToken = 0

  return create<BoardState>((set, get) => ({
    spaceId: null,
    cards: [],
    partitions: [],
    connections: [],
    removed: [],
    canvas: { ...DEFAULT_CANVAS },
    readOnly: false,
    needsMigration: false,
    status: 'idle',
    error: null,
    notices: [],
    selectedIds: [],
    selectedConnectionIds: [],
    selectedPartitionId: null,
    removedView: false,
    removedCards: [],

    selectCards(ids) {
      // 选中集合互斥（5.1）：选中卡片时取消分区选中
      set({ selectedIds: [...ids], selectedPartitionId: null })
    },

    selectPartition(id) {
      set({ selectedPartitionId: id, selectedIds: [] })
    },

    setCardPositions(positions) {
      if (positions.length === 0) return
      const byId = new Map(positions.map((position) => [position.id, position]))
      set((state) => ({
        cards: state.cards.map((card) => {
          const next = byId.get(card.id)
          return next ? { ...card, x: next.x, y: next.y } : card
        }),
      }))
    },

    setCardSizes(sizes) {
      if (sizes.length === 0) return
      const byId = new Map(sizes.map((size) => [size.id, size]))
      set((state) => ({
        cards: state.cards.map((card) => {
          const next = byId.get(card.id)
          return next ? { ...card, w: next.w, h: next.h } : card
        }),
      }))
    },

    setPartitionPositions(positions) {
      if (positions.length === 0) return
      const byId = new Map(positions.map((position) => [position.id, position]))
      set((state) => ({
        partitions: state.partitions.map((partition) => {
          const next = byId.get(partition.id)
          return next ? { ...partition, x: next.x, y: next.y } : partition
        }),
      }))
    },

    setPartitionCollapsed(id, collapsed) {
      set((state) => ({
        partitions: state.partitions.map((partition) =>
          partition.id === id ? { ...partition, collapsed } : partition,
        ),
      }))
    },

    renamePartition({ id, name, folderPath, groupFrom, groupTo }) {
      set((state) => ({
        partitions: state.partitions.map((partition) =>
          partition.id === id ? { ...partition, name, folderPath } : partition,
        ),
        cards: state.cards.map((card) =>
          card.group === groupFrom ? { ...card, group: groupTo } : card,
        ),
      }))
    },

    applyRemoveCards({ cards: removed, entries }) {
      if (removed.length === 0) return
      const removedIds = new Set(removed.map((card) => card.id))
      set((state) => ({
        cards: state.cards.filter((card) => !removedIds.has(card.id)),
        selectedIds: state.selectedIds.filter((id) => !removedIds.has(id)),
        removed: [...state.removed, ...entries],
      }))
    },

    applyRestoreCards({ cards: restored, entryIds }) {
      if (restored.length === 0 && entryIds.length === 0) return
      const entryIdSet = new Set(entryIds)
      set((state) => ({
        // 放回画布末尾（顺序无意义，位置由卡片自身的 x/y 决定）
        cards: [...state.cards, ...restored.filter((card) => !state.cards.some((item) => item.id === card.id))],
        removed: state.removed.filter((entry) => !entryIdSet.has(entry.id)),
        // 已移除视图的灰卡同步移除；否则恢复后列表仍显示这些项，
        // 且选中态残留（selectedIds 未清）→ 「没选中却带选中边框」
        removedCards: state.removedCards.filter((card) => !entryIdSet.has(card.id)),
        selectedIds: state.selectedIds.filter((id) => !entryIdSet.has(id)),
      }))
    },

    addCards(cards) {
      if (cards.length === 0) return
      set((state) => ({
        cards: [...state.cards, ...cards],
      }))
    },

    removeCardsLocally(ids) {
      if (ids.length === 0) return
      const idSet = new Set(ids)
      set((state) => ({
        cards: state.cards.filter((card) => !idSet.has(card.id)),
        selectedIds: state.selectedIds.filter((id) => !idSet.has(id)),
      }))
    },

    updateCardNote(id, note) {
      set((state) => ({
        cards: state.cards.map((card) => (card.id === id ? { ...card, note } : card)),
      }))
    },

    setCardMeta(id, meta) {
      set((state) => ({
        cards: state.cards.map((card) => (card.id === id ? { ...card, meta } : card)),
      }))
    },

    setCardFileRefs(updates) {
      if (updates.length === 0) return
      const byId = new Map(updates.map((update) => [update.id, update]))
      set((state) => ({
        cards: state.cards.map((card) => {
          const next = byId.get(card.id)
          return next
            ? { ...card, filePath: next.filePath, originalPath: next.originalPath, group: next.group }
            : card
        }),
      }))
    },

    setCardsZIndex(updates) {
      if (updates.length === 0) return
      const byId = new Map(updates.map((update) => [update.id, update.zIndex]))
      set((state) => ({
        cards: state.cards.map((card) => {
          const next = byId.get(card.id)
          return next === undefined ? card : { ...card, zIndex: next }
        }),
      }))
    },

    setPartitionColor(id, color) {
      set((state) => ({
        partitions: state.partitions.map((partition) =>
          partition.id === id ? { ...partition, color } : partition,
        ),
      }))
    },

    setPartitionRects(updates) {
      if (updates.length === 0) return
      const byId = new Map(updates.map((update) => [update.id, update]))
      set((state) => ({
        partitions: state.partitions.map((partition) => {
          const next = byId.get(partition.id)
          return next
            ? { ...partition, x: next.x, y: next.y, w: next.w, h: next.h }
            : partition
        }),
      }))
    },

    addConnection(connection) {
      set((state) => ({
        connections: [...state.connections, connection],
      }))
    },

    addConnections(connections) {
      if (connections.length === 0) return
      set((state) => ({
        connections: [...state.connections, ...connections],
      }))
    },

    removeConnections(ids) {
      if (ids.length === 0) return
      const idSet = new Set(ids)
      set((state) => ({
        connections: state.connections.filter((connection) => !idSet.has(connection.id)),
        // 选中的连线被删后，选中态一并清掉
        selectedConnectionIds: state.selectedConnectionIds.filter((id) => !idSet.has(id)),
      }))
    },

    setConnectionLabel(id, label) {
      set((state) => ({
        connections: state.connections.map((connection) =>
          connection.id === id ? { ...connection, label } : connection,
        ),
      }))
    },

    async loadRemovedView(spacePath: string) {
      set({ removedView: true, removedCards: [], selectedIds: [] })

      try {
        // 7.2：`_已移除` 里的图以灰底卡片展示。
        // 扫描限深 2（根文件 + 一层子文件夹），与移除时保留的原文件夹结构对应。
        const removedRoot = joinPath(spacePath, '_已移除')
        const rootEntries = await provider.listDir(removedRoot)
        const media: { name: string; path: string }[] = []

        for (const entry of rootEntries) {
          if (entry.isDir) {
            try {
              const children = await provider.listDir(entry.path)
              for (const child of children) {
                if (!child.isDir && !child.name.startsWith('.')) {
                  media.push({ name: `_已移除/${entry.name}/${child.name}`, path: child.path })
                }
              }
            } catch {
              // 子目录读不到就跳过
            }
          } else if (!entry.name.startsWith('.')) {
            media.push({ name: `_已移除/${entry.name}`, path: entry.path })
          }
        }

        // 只展示 removed 记录对应的文件（记录里有 originalPath，恢复才有目的地）
        const byMovedTo = new Map(get().removed.map((entry) => [entry.movedTo.replace(/\\/g, '/'), entry]))
        const targets = media.filter((item) => byMovedTo.has(item.name))

        // 批量读取原图尺寸（key = movedTo 相对路径；只读图头，不解码全图）
        const fakeEntries: DirEntry[] = targets.map((item) => ({
          name: item.name,
          path: item.path,
          isDir: false,
          size: 0,
          modifiedAt: null,
        }))
        const sizes = await collectImageSizes(fakeEntries, provider)

        if (get().removedView === false) return // 用户已退出视图，丢弃结果

        const sizeFor = (entry: DirEntry): CardSize => sizeForEntry(entry, sizes)
        // 兜底生成的灰卡 id 不能与画布卡片撞号（画布卡片此时仍在 store 中）
        const cards = createCardsFromEntries(fakeEntries, {
          sizeFor,
          existingCardIds: get().cards.map((card) => card.id),
        }).map((card) => {
          const entry = byMovedTo.get(card.filePath)
          return { ...card, id: entry?.id ?? card.id }
        })

        // 原图资源登记（原图在 _已移除 下）。
        // ⚠️ 不 clearCardAssets：已移除卡的 id 与画布卡 id 不重叠（被移除的卡不在画布），
        // 直接叠加注册 —— 退出视图后正常卡片的资源仍然有效。
        registerCardAssets(cards, spacePath)

        set({ removedCards: cards })
      } catch {
        // `_已移除` 不存在（从未移除过任何东西）→ 空视图即可
        set({ removedCards: [] })
      }
    },

    exitRemovedView() {
      set({ removedView: false, removedCards: [], selectedIds: [] })
    },

    async loadSpace(space: Space) {
      loadToken += 1
      const token = loadToken

      clearCardAssets()
      set({
        spaceId: space.id,
        status: 'loading',
        error: null,
        notices: [],
        cards: [],
        partitions: [],
        connections: [],
        removed: [],
        canvas: { ...DEFAULT_CANVAS },
        readOnly: false,
        needsMigration: false,
        selectedIds: [],
        selectedConnectionIds: [],
      })

      try {
        // 1) 先读布局（T1.6）：拿不到就退回扫描文件夹
        const { layout, readOnly, notices } = await readLayoutOrEmpty(provider, space)

        // 2) 扫描根目录，分流出「文件」（卡片）与「子文件夹」（分区框，T2.5）
        const entries = await provider.listDir(space.folderPath)
        const mediaEntries = entries.filter((entry) => !entry.isDir && !entry.name.startsWith('.'))
        const partitionDirs = selectPartitionDirs(entries)

        // 3) 扫描各子文件夹（一层）：文件名归一化为「子文件夹/文件名」相对路径，
        //    与 4.2 的 filePath 定义一致；单个文件夹读取失败只记提示、不中断
        const partitionNotices: string[] = []
        const partitionMedia: { name: string; entries: DirEntry[] }[] = []
        for (const dir of partitionDirs) {
          try {
            const children = await provider.listDir(dir.path)
            partitionMedia.push({
              name: dir.name,
              entries: children
                .filter((entry) => !entry.isDir && !entry.name.startsWith('.'))
                .map((entry) => ({ ...entry, name: `${dir.name}/${entry.name}` })),
            })
          } catch (error) {
            partitionNotices.push(
              `子文件夹「${dir.name}」读取失败（${error instanceof Error ? error.message : String(error)}），已跳过`,
            )
          }
        }

        // 4) 批量读取原图尺寸（key = 相对路径，与 card.filePath 对齐；只读图头，不解码全图）
        const allMedia = [...mediaEntries, ...partitionMedia.flatMap((item) => item.entries)]
        const sizes = await collectImageSizes(allMedia, provider)

        if (token !== loadToken) return // 已被更晚的加载取代，丢弃本次结果

        const sizeFor = (entry: DirEntry): CardSize => sizeForEntry(entry, sizes)

        // 5) 根目录卡片先铺；分区卡片各自占一条独立行带，依次往下
        //    （独立行带保证分区框的包围盒互不重叠）
        // ⚠️ 各批次共享同一 id 池（种子 = layout 既有卡片 id + removed 记录 id）：
        //    此前每批各自从 c_001 重新计数，多个分区的卡片 id 撞号落盘，
        //    按 id 的操作（置顶/置底、选中、恢复记录匹配）全部失准。
        //    removed 记录同样占用 id 空间（恢复要按 id 关联），因此也必须进池，
        //    否则扫描出的新卡片会与已移除记录撞号。
        const usedIds = [
          ...layout.cards.map((card) => card.id),
          ...layout.removed.map((entry) => entry.id),
        ]
        const rootCards = createCardsFromEntries(mediaEntries, { sizeFor, existingCardIds: usedIds })
        usedIds.push(...rootCards.map((card) => card.id))
        let cursorY = rootCards.reduce((max, card) => Math.max(max, card.y + card.h), 0)
        const scanned = [...rootCards]
        const partitionNames: string[] = []

        for (const { name, entries: children } of partitionMedia) {
          partitionNames.push(name)
          const startY =
            scanned.length > 0 ? cursorY + PARTITION_SCAN_GAP : DEFAULT_GRID_OPTIONS.startY
          const groupCards = createCardsFromEntries(children, {
            sizeFor,
            grid: { startY },
            existingCardIds: usedIds,
          }).map((card) => ({ ...card, group: name }))
          usedIds.push(...groupCards.map((card) => card.id))
          scanned.push(...groupCards)
          if (groupCards.length > 0) {
            cursorY = groupCards.reduce((max, card) => Math.max(max, card.y + card.h), startY)
          }
        }

        // 6) 合并：layout 的位置优先，文件夹里的新文件接在下方
        const merged = mergeScannedWithLayout(scanned, layout.cards)

        // 6.1) 历史脏数据回填：从「已移除」恢复过的卡片，早期版本只把 filePath 改回原位，
        //      originalPath 仍留着 `_已移除/…`。后果是复制 / 粘贴时按 originalPath 取源路径
        //      → 拼出 `_已移除/…` → 「不是文件」。这里统一归一：
        //      filePath 已经不在 `_已移除` 下，originalPath 就应与它一致。
        const isRemovedPath = (value: string): boolean =>
          value.replace(/\\/g, '/').startsWith('_已移除/')
        const normalizedCards = merged.cards.map((card) =>
          isRemovedPath(card.originalPath) && !isRemovedPath(card.filePath)
            ? { ...card, originalPath: card.filePath }
            : card,
        )
        const patchedOriginalPath = normalizedCards.some(
          (card, index) => card.originalPath !== merged.cards[index].originalPath,
        )

        // 6.5) id 去重迁移：修复历史版本落盘的重复 id（卡片 + removed 记录同一池去重，
        //      保证卡片 id 唯一、removed 记录 id 互不冲突且不与画布卡片撞号）。
        //      幂等：修复后的数据再次加载不会变化。
        const before = [...normalizedCards, ...layout.removed]
        const deduped = dedupeIds(before)
        const mergedCards = deduped.slice(0, normalizedCards.length) as Card[]
        const mergedRemoved = deduped.slice(normalizedCards.length) as RemovedEntry[]
        const idsPatched = deduped.some((item, index) => item.id !== before[index].id)

        // 7) 分区框：已有记录沿用；新子文件夹按合并后的卡片包围盒建框（第六章）
        const partitions = createPartitions(partitionNames, mergedCards, layout.partitions)

        // ⚠️ 顺序要求：资源必须先于 cards 写入，卡片渲染时才能读到原图路径
        registerCardAssets(mergedCards, space.folderPath)

        set({
          cards: mergedCards,
          partitions,
          connections: layout.connections,
          removed: mergedRemoved,
          canvas: layout.canvas,
          readOnly,
          // 修过历史数据就要求上层补一次落盘，否则修复只停留在内存
          needsMigration: idsPatched || patchedOriginalPath,
          status: 'ready',
          notices: [...notices, ...partitionNotices, ...imageSizeNotice(sizes)],
        })
      } catch (error) {
        if (token !== loadToken) return
        set({
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },

    reset() {
      loadToken += 1
      clearCardAssets()
      set({
        spaceId: null,
        cards: [],
        partitions: [],
        connections: [],
        removed: [],
        canvas: { ...DEFAULT_CANVAS },
        readOnly: false,
        needsMigration: false,
        status: 'idle',
        error: null,
        notices: [],
        selectedIds: [],
        selectedConnectionIds: [],
        selectedPartitionId: null,
        removedView: false,
        removedCards: [],
      })
    },
  }))
}

/** 应用默认实例 */
export const useBoardStore = createBoardStore()
