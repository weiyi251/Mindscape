// ============================================================================
// 模块说明（中文）
// 分区框（子文件夹）的纯计算。对应开发计划书第六章「分区框（子文件夹）规格」：
//   · 自动生成：读文件夹时检测到子文件夹，自动建框
//   · 不显示特殊目录：`.mindscape` 和 `_已移除` 不生成框
//   · 自动包住：框的初始大小 = 包住该文件夹下所有卡片
//   · 颜色：8 色柔和自动轮换，也可手动指定
//
// 【关联方式】卡片通过 group 字段（= 分区 name）归属分区框；
//   分区框通过 folderPath（相对空间文件夹）与硬盘子文件夹对应。
//
// 【生成时机】在「卡片扫描 + layout 合并」之后调用 createPartitions：
//   已有记录的框完全沿用（位置 / 折叠 / 颜色是用户的劳动成果）；
//   新框按合并后卡片的包围盒生成 —— 首次进入时框内卡片都在网格上，
//   框刚好包住它们；后续新增文件走全画布网格，不影响已建好的框。
//
// 【8 色色板】计划书 12 章只定了「8 色柔和自动轮换 + 低透明度」，
//   具体色值在风险清单中列为待定项 —— 这里拟定一套低饱和自然色系
//   （与 12 章的米白 / 苔绿基调协调），要调只改 PARTITION_PALETTE 一处。
//
// 纯函数、无 IO 依赖，可单元测试。
// 实现任务：T2.5。
// ============================================================================

import type { Card, Partition } from '@/core/types'
import { nextPartitionId } from '@/core/utils/id'

/** 不生成分区框的特殊目录（第六章）。以 `.` 开头的隐藏目录一并排除 */
const PARTITION_RESERVED_NAMES = ['.mindscape', '_已移除'] as const

/** 文件夹名中的非法字符（第六章保护措施 ①）。与 Rust 侧 INVALID_FOLDER_CHARS 保持一致 */
const INVALID_FOLDER_CHARS = ['\\', '/', ':', '*', '?', '"', '<', '>', '|', '\0']

/**
 * 检查新文件夹名是否合法（第六章保护措施 ①）。
 * 与 Rust 侧 is_valid_folder_name 双保险：任一侧拦截都不落盘。
 */
export function isValidFolderName(name: string): boolean {
  return (
    name.trim().length > 0 &&
    name !== '.' &&
    name !== '..' &&
    !name.startsWith('.') &&
    !name.split('').some((char) => INVALID_FOLDER_CHARS.includes(char))
  )
}

/** 分区框内边距：卡片与框边缘的距离（画布坐标） */
export const PARTITION_PADDING = 24

/** 标题条高度（画布坐标）。折叠后整个框就只剩这条 */
export const PARTITION_TITLE_HEIGHT = 32

/** 分区框允许的最小宽 / 高（画布坐标）。空框也能缩到的下限 */
const MIN_PARTITION_SIZE = 120

/** 拖拽调整分区大小时，与相邻分区的最小间距（画布坐标） */
export const PARTITION_RESIZE_GAP = 8

/**
 * 拖拽调整分区框大小的约束（2026-09-11 用户裁决「分区框大小自定义」）：
 *   · minW / minH —— 布局自动适应：框至少要包住框内卡片的包围盒
 *     （含内边距与标题条），不会把卡片「框丢」；
 *   · maxW / maxH —— 不与其他元素重叠：向右 / 向下增长时，
 *     以该方向上第一个「相交范围内」的其他分区为上限，留出 GAP 间距。
 * 折叠状态下高度锁死为标题条高度。
 */
export interface PartitionResizeLimits {
  minW: number
  minH: number
  maxW: number
  maxH: number
}

export function computePartitionResizeLimits(
  partition: Pick<Partition, 'id' | 'x' | 'y' | 'w' | 'h' | 'collapsed'>,
  others: readonly Partition[],
  memberCards: readonly Pick<Card, 'x' | 'y' | 'w' | 'h'>[],
): PartitionResizeLimits {
  const box = boundingBoxOfCards(memberCards)
  const minW = Math.max(MIN_PARTITION_SIZE, box ? box.w + PARTITION_PADDING * 2 : MIN_PARTITION_SIZE)
  let minH = Math.max(
    MIN_PARTITION_SIZE,
    box ? box.h + PARTITION_TITLE_HEIGHT + PARTITION_PADDING * 2 : MIN_PARTITION_SIZE,
  )
  let maxW = Number.POSITIVE_INFINITY
  let maxH = Number.POSITIVE_INFINITY

  if (partition.collapsed) {
    // 折叠框只是标题条：高度既不能缩也不能撑
    minH = PARTITION_TITLE_HEIGHT
    maxH = PARTITION_TITLE_HEIGHT
  }

  for (const other of others) {
    if (other.id === partition.id) continue
    // 垂直范围相交 → 向右增长会撞上它；水平范围相交 → 向下增长会撞上它
    const yOverlap = other.y < partition.y + partition.h && other.y + other.h > partition.y
    const xOverlap = other.x < partition.x + partition.w && other.x + other.w > partition.x
    if (yOverlap && other.x > partition.x) {
      maxW = Math.min(maxW, other.x - PARTITION_RESIZE_GAP - partition.x)
    }
    if (xOverlap && other.y > partition.y) {
      maxH = Math.min(maxH, other.y - PARTITION_RESIZE_GAP - partition.y)
    }
  }

  // 钳制上限不得小于下限（密集布局下允许兜底重叠，但内容永远装得下）
  return {
    minW,
    minH,
    maxW: Math.max(maxW, minW),
    maxH: Math.max(maxH, minH),
  }
}

/** 8 色柔和色板（低饱和自然色系；待定项的拟定值，调整只改这里） */
export const PARTITION_PALETTE = [
  '#5A7D6A', // 苔绿（主色）
  '#6B7F99', // 雾蓝
  '#8B9B8E', // 岩灰绿（次色）
  '#A38F6B', // 沙棕
  '#97777B', // 灰玫
  '#7B8E9C', // 青灰
  '#A08F6F', // 藤黄
  '#867D9C', // 藕紫
] as const

/** 目录项最小信息（与 StorageProvider.DirEntry 的子集解耦，便于测试） */
export interface DirLike {
  name: string
  isDir: boolean
}

/**
 * 筛出要生成分区框的子文件夹：
 *   是目录 + 非 `.` 开头 + 不在保留名单（第六章）。
 * 泛型保留入参类型（DirEntry 之类的扩展字段不丢）。
 */
export function selectPartitionDirs<T extends DirLike>(entries: readonly T[]): T[] {
  return entries.filter(
    (entry) =>
      entry.isDir &&
      !entry.name.startsWith('.') &&
      !(PARTITION_RESERVED_NAMES as readonly string[]).includes(entry.name),
  )
}

/**
 * 解析分区框颜色。
 * `auto` → 按生成顺序从色板轮换取色；其余原样返回（手动指定的色值 / 色名）。
 */
export function resolvePartitionColor(color: string, autoIndex: number): string {
  if (color !== 'auto') return color
  const index =
    ((autoIndex % PARTITION_PALETTE.length) + PARTITION_PALETTE.length) % PARTITION_PALETTE.length
  return PARTITION_PALETTE[index]
}

/**
 * 包住一组卡片的矩形（第六章「自动包住」）。
 * 空数组返回 null（没有内容时不建框）。
 */
export function boundingBoxOfCards(
  cards: readonly Pick<Card, 'x' | 'y' | 'w' | 'h'>[],
): { x: number; y: number; w: number; h: number } | null {
  if (cards.length === 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const card of cards) {
    minX = Math.min(minX, card.x)
    minY = Math.min(minY, card.y)
    maxX = Math.max(maxX, card.x + card.w)
    maxY = Math.max(maxY, card.y + card.h)
  }

  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** 手动新建分区框的默认尺寸（画布坐标，高度含标题条） */
export const NEW_PARTITION_WIDTH = 360
export const NEW_PARTITION_HEIGHT = 260

/**
 * 是否为「不生成分区框」的保留目录名（`.mindscape` / `_已移除`）。
 *
 * 手动新建分区时**必须**用它拦一道：保留目录不会生成框，
 * 若允许用户建出同名分区，刷新后 `createPartitions` 扫不到它 →
 * 硬盘上有文件夹、画布上却没有框（用户会以为数据丢了）。
 */
export function isReservedPartitionName(name: string): boolean {
  return (PARTITION_RESERVED_NAMES as readonly string[]).includes(name.trim())
}

/** 新建分区名的不合格原因（文案由 UI 层映射，core 不持用户可见文案） */
export type NewPartitionNameIssue = 'empty' | 'invalid' | 'reserved' | 'duplicate'

/**
 * 校验「手动新建分区」的名称。返回 null 表示可用。
 *
 * 与第六章重命名保护①②一致，另加保留名一档；**硬盘同名冲突**需要 IO，
 * 由调用方（pages/board/createPartitionFlow.ts）在拿到本函数结果之后再查。
 */
export function checkNewPartitionName(
  name: string,
  existing: readonly Partition[],
): NewPartitionNameIssue | null {
  const trimmed = name.trim()
  if (trimmed === '') return 'empty'
  // 保留名先判：`.mindscape` 也「以 . 开头」，若不先判会落到 invalid 上，
  // 用户看到的是「含非法字符」而不是「这是系统保留名」的更有用提示
  if (isReservedPartitionName(trimmed)) return 'reserved'
  if (!isValidFolderName(trimmed)) return 'invalid'
  if (existing.some((item) => item.name === trimmed || item.folderPath === trimmed)) {
    return 'duplicate'
  }
  return null
}

/**
 * 在画布上「以 center 为中心」手动建一个空分区框（2026-09-14 用户要求：
 * 空间内直接创建分区，并在对应空间文件夹下生成同名文件夹）。
 *
 * · id 取现有分区最大值 +1（`nextPartitionId`）；
 * · 颜色按现有分区数量从 8 色板轮换（与自动建框同一套配色，避免撞色）；
 * · 尺寸用默认值（空框没有卡片包围盒可用），落点取整避免半个像素的模糊边框。
 *
 * 纯函数：不碰硬盘、不碰 store —— 落盘与状态写入由 createPartition 命令负责。
 */
export function createPartitionAt(
  name: string,
  center: { x: number; y: number },
  existing: readonly Partition[],
): Partition {
  return {
    id: nextPartitionId(existing.map((item) => item.id)),
    name,
    folderPath: name, // 一层扫描：folderPath 就是子文件夹名
    x: Math.round(center.x - NEW_PARTITION_WIDTH / 2),
    y: Math.round(center.y - NEW_PARTITION_HEIGHT / 2),
    w: NEW_PARTITION_WIDTH,
    h: NEW_PARTITION_HEIGHT,
    color: resolvePartitionColor('auto', existing.length),
    collapsed: false,
    meta: {},
  }
}

/**
 * 由「扫描到的子文件夹名 + 合并后的卡片」生成分区框清单。
 *
 * 规则：
 *   · layout 已有该 folderPath 的分区 → 完全沿用记录；
 *     文件夹已被删除（名字不在 names 里）→ 框一并丢弃
 *   · 新子文件夹 → 对 group === 名字的卡片求包围盒建框；
 *     框内没有卡片（空文件夹）→ 不建框
 *
 * @param names    本次扫描到的子文件夹名（顺序 = listDir 返回顺序）
 * @param cards    合并后的最终卡片（带 group 字段）
 * @param existing layout.partitions 里的既有分区框
 */
export function createPartitions(
  names: readonly string[],
  cards: readonly Card[],
  existing: readonly Partition[],
): Partition[] {
  const existingByPath = new Map(existing.map((item) => [item.folderPath, item]))
  const usedIds = existing.map((item) => item.id)
  const results: Partition[] = []
  let autoIndex = 0

  for (const name of names) {
    const saved = existingByPath.get(name)
    if (saved) {
      results.push(saved)
      continue
    }

    const members = cards.filter((card) => card.group === name)
    const box = boundingBoxOfCards(members)
    if (!box) continue // 空子文件夹不建框

    const id = nextPartitionId(usedIds)
    usedIds.push(id)

    results.push({
      id,
      name,
      folderPath: name, // 一层扫描：folderPath 就是子文件夹名
      x: box.x - PARTITION_PADDING,
      y: box.y - PARTITION_TITLE_HEIGHT - PARTITION_PADDING,
      w: box.w + PARTITION_PADDING * 2,
      h: box.h + PARTITION_TITLE_HEIGHT + PARTITION_PADDING * 2,
      color: resolvePartitionColor('auto', autoIndex),
      collapsed: false,
      meta: {},
    })
    autoIndex += 1
  }

  return results
}

// ---------------------------------------------------------------------------
// A2（2026-09-20 用户计划第 2 步）：磁盘有子文件夹、画布无框 → 一键补框
// ---------------------------------------------------------------------------

/** 补框时相邻新框之间的垂直间距（画布坐标），与扫描行带的间隙同一量级 */
export const FRAME_PLACEMENT_GAP = 40

/**
 * 找出「磁盘上有子文件夹、画布上却没有对应分区框」的文件夹名。
 *
 * 【为什么会出现这种不一致】`createPartitions` 对**空子文件夹**
 * （框内没有卡片 → 没有包围盒）一律不建框 —— 于是磁盘上的空文件夹
 * 在画布上完全隐形：用户看不到它，也没法把卡片拖进去。
 * A2 的做法是进入空间时把这份差集交给 UI 提示，由用户决定是否一键补框。
 *
 * 【为什么补框不碰硬盘】目录本来就存在，这是「发现」而不是「创建」；
 * 反过来，撤销补框也**绝不能删目录**（那是用户的文件夹，不是我们建的）。
 *
 * @param dirNames 磁盘上扫描到的子文件夹名（已由 selectPartitionDirs 滤过保留名 / 隐藏目录）
 * @param existing 画布上的既有分区框
 */
export function findUnframedFolders(
  dirNames: readonly string[],
  existing: readonly Partition[],
): string[] {
  const framed = new Set(existing.map((item) => item.folderPath))
  const seen = new Set<string>()
  const missing: string[] = []
  for (const name of dirNames) {
    if (framed.has(name) || seen.has(name)) continue
    seen.add(name)
    missing.push(name)
  }
  return missing
}

/** 补框入参 */
export interface MissingFrameInput {
  /** 待补框的文件夹名（磁盘上已存在；顺序即建框顺序） */
  names: readonly string[]
  /** 合并后的画布卡片：group 命中的按包围盒定框，其余只作为避让障碍 */
  cards: readonly Card[]
  /** 画布既有分区框（取号 / 配色轮换 / 避让都用它） */
  existing: readonly Partition[]
}

/**
 * 为「磁盘有目录、画布无框」的文件夹批量补框（纯函数，不碰硬盘、不碰 store）。
 *
 * 几何规则：
 *   · 该文件夹在画布上**有**归属卡片（group === name）→ 与 `createPartitions` 完全一致：
 *     框 = 卡片包围盒 + 内边距 + 标题条。正常路径下不会走到这里（有内容的文件夹
 *     进空间时已自动建框），保留它是为了「框架被外部改动抹掉」这类异常自愈；
 *   · 空文件夹（A2 的主场景）→ 用默认尺寸，并**排在所有既有元素（分区框 + 卡片）的下方**，
 *     逐个向下排开，保证不叠在既有内容上。
 *
 * id 接着既有分区递增；配色接着既有分区数量从 8 色板轮换（与自动建框同一套，避免撞色）。
 */
export function createPartitionsForFolders(input: MissingFrameInput): Partition[] {
  const { names, cards, existing } = input
  if (names.length === 0) return []

  // 避让障碍 = 既有分区框 + 全部卡片；新框统一落到它们的下缘以下
  const obstacles = [
    ...existing.map((item) => ({ x: item.x, y: item.y, w: item.w, h: item.h })),
    ...cards.map((item) => ({ x: item.x, y: item.y, w: item.w, h: item.h })),
  ]
  const occupied = boundingBoxOfCards(obstacles)
  const cursorX = occupied ? Math.round(occupied.x) : 0
  let cursorY = occupied ? Math.round(occupied.y + occupied.h + FRAME_PLACEMENT_GAP) : 0

  const usedIds = existing.map((item) => item.id)
  let autoIndex = existing.length
  const results: Partition[] = []

  for (const name of names) {
    const box = boundingBoxOfCards(cards.filter((card) => card.group === name))
    const w = box ? box.w + PARTITION_PADDING * 2 : NEW_PARTITION_WIDTH
    const h = box ? box.h + PARTITION_TITLE_HEIGHT + PARTITION_PADDING * 2 : NEW_PARTITION_HEIGHT
    const x = box ? box.x - PARTITION_PADDING : cursorX
    const y = box ? box.y - PARTITION_TITLE_HEIGHT - PARTITION_PADDING : cursorY

    const id = nextPartitionId(usedIds)
    usedIds.push(id)
    results.push({
      id,
      name,
      folderPath: name, // 一层扫描：folderPath 就是子文件夹名
      x,
      y,
      w,
      h,
      color: resolvePartitionColor('auto', autoIndex),
      collapsed: false,
      meta: {},
    })
    autoIndex += 1

    // 只有空框才占位（有卡片的框落在内容上，不占用下方排布游标）
    if (!box) cursorY += h + FRAME_PLACEMENT_GAP
  }

  return results
}
