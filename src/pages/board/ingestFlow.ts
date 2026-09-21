// ============================================================================
// 模块说明（中文）
// 外部文件收进空间的公共链路（2026-09-21 移动端适配 M4，从 pages/Board.tsx 外抽）。
//
// 为什么抽出来：桌面上有两条入口（拖入 onDragDropEvent、系统剪贴板粘贴）都拿到
// **真实路径**，复制用 `copy_file`；移动端（M4）新增第三条入口 —— 文件选择器拿到的是
// **字节**（`<input type=file>` / WebView 文件选择器把 SAF 的内容复制进应用缓存后交给
// 前端），只能走 `write_file_bytes`。三条入口的「建卡 → 分区归属 → 失败汇总 →
// addCards 命令」完全同构，而 Board.tsx 有 2000 行的架构棘轮（规则 1），
// 所以把循环整体搬到这一层，Board 只留装配。
//
// 铁律②（原件不动）在本层的体现：`copyIn` 只**复制 / 写出**，绝不移动或删除源文件；
// 失败按文件逐个汇总成一条提示（不是第一个错就中断）。
//
// 同批外抽的还有 buildIngestedCard（建卡本身）：它只依赖 core 的模块级导出，
// 留在 Board 里只是白占行数 —— 棘轮余量（规则 1）现在归 M4 的入口接线用。
//
// 字节来源（`bytes`）没有可重放的源路径，因此 `sources[i].src` 传空串 ——
// 与截图粘贴同一套约定（redo 时不重建文件，见 core/commands/impl/addCards.ts:24）。
//
// 中文文案集中在本文件的 INGEST_FLOW_TEXT（与 createPartitionFlow.ts / openCardFlow.ts
// 同一套做法：流程文件自带文案常量）。
// ============================================================================

import type { AddCardsSource } from '@/core/commands/impl/addCards'
import { setCardAsset } from '@/core/board/cardAssets'
import { cardSizeForImage } from '@/core/board/cardSize'
import { cardTypeFor } from '@/core/board/imageTypes'
import type { DropDestination } from '@/core/board/ingest'
import { localStorageProvider } from '@/core/storage/LocalFolderProvider'
import { zCardSchema } from '@/core/types'
import type { Card } from '@/core/types'
import { basenameOf, relativePathOf } from '@/core/utils/paths'
import type { Point } from '@/canvas/interaction/connectionAnchor'

/** 入口名（只影响提示文案：「以下文件拖入失败」/「导入失败」） */
export type IngestSourceLabel = '拖入' | '粘贴' | '导入'

export const INGEST_FLOW_TEXT = {
  /** 逐个文件汇总成一条提示（沿用拖入链路的原句式） */
  failed: (label: IngestSourceLabel, details: string): string =>
    `以下文件${label}失败：${details}`,
  readOnly: (label: IngestSourceLabel): string =>
    `布局由更新版本创建，处于只读模式，无法${label}文件`,
}

/** 多卡依次落点的错开步长（px，拖入 / 粘贴 / 导入共用） */
export const INGEST_OFFSET_STEP = 24

/**
 * 浏览器 / WebView 文件选择器交来的文件（`File` 的结构子集）。
 * 单独声明而不写 `File`：一是 node 单测环境没有 File，二是本层只用到这两个成员。
 */
export interface PickedFile {
  name: string
  arrayBuffer: () => Promise<ArrayBuffer>
}

/**
 * 一个待收进空间的外部文件。
 * 三种来源三选一：桌面拖入 / 粘贴给 `path`（真实路径），移动选择器给 `file`
 * （只有字节，读取推迟到 `itemBytes`，好让读失败也被下面的循环逐文件汇总）。
 * `name` 始终要有 —— 失败提示里显示的是它，而不是落盘后的实际路径。
 */
export interface IngestItem {
  name: string
  path?: string
  bytes?: Uint8Array
  file?: PickedFile
}

/** 取出待写出的字节：已经读过直接用，否则此刻从选择器读（读失败由调用循环汇总） */
export async function itemBytes(item: IngestItem): Promise<Uint8Array> {
  if (item.bytes) return item.bytes
  if (item.file) return new Uint8Array(await item.file.arrayBuffer())
  throw new Error('没有可写入的内容')
}

export interface ExternalIngestDeps {
  /** 把 item 收进 destDir，返回**实际落盘**的绝对路径（重名时由 Rust 侧加 `_1` 后缀） */
  copyIn: (item: IngestItem, destDir: string) => Promise<string>
  /** 生成卡片：尺寸（图片读原图宽高比）、filePath 归一、资源表登记 */
  buildCard: (params: {
    id: string
    actualAbs: string
    spacePath: string
    point: Point
    offset: number
  }) => Promise<Card>
  /** 当前已占用的卡片 id（含本次已建出的） */
  usedCardIds: () => string[]
  /** 下一个可用卡片 id */
  nextCardId: (taken: string[]) => string
  /** 落盘后统一提交：addCards 命令（undo 删副本）+ 分区扩框 + 排程写布局 */
  commit: (
    cards: Card[],
    createdFiles: string[],
    sources: AddCardsSource[],
    dest: DropDestination,
  ) => Promise<void>
  /** 失败汇总 / 成功清空错误条（Board 的 setActionError） */
  reportError: (message: string | null) => void
}

/**
 * 三条入口共用的「新卡片」生成（2026-09-21 移动端 M4 自 Board.tsx 外抽，行为一字未改）：
 * 尺寸（图片按原始宽高比）、filePath 归一、资源表登记（必须先于 addCards 渲染）。
 * 方案 A（2026-09-12）：资源表只登记原图绝对路径，不生成缩略图。
 *
 * 依赖全是 core 的模块级导出（无组件状态），所以它是一个普通函数而不是 useCallback ——
 * `ExternalIngestDeps.buildCard` 仍然可注入，单测照样给假件。
 */
export async function buildIngestedCard(params: {
  id: string
  actualAbs: string
  spacePath: string
  point: Point
  offset: number
}): Promise<Card> {
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
}

/**
 * 公共执行端：逐个 `copyIn` → `buildCard` → 分区归属 → 汇总失败 → `commit`。
 *
 * dest（落盘目标目录 + 分区归属）与 point（首卡落点）由调用方按各自入口的规则决定：
 * 拖入看落点命中、粘贴与导入看确定性规则（2026-09-12 用户裁决：不靠落点猜测）。
 */
export async function ingestExternalItems(
  deps: ExternalIngestDeps,
  items: IngestItem[],
  spacePath: string,
  dest: DropDestination,
  point: Point,
  label: IngestSourceLabel,
): Promise<void> {
  const cards: Card[] = []
  const createdFiles: string[] = []
  const sources: AddCardsSource[] = []
  const usedIds = deps.usedCardIds()
  let offset = 0
  const failures: string[] = []

  for (const item of items) {
    try {
      const actualAbs = await deps.copyIn(item, dest.destDir)
      const id = deps.nextCardId([...usedIds, ...cards.map((card) => card.id)])
      const card = await deps.buildCard({ id, actualAbs, spacePath, point, offset })
      // 拖入 / 粘贴 / 导入到分区内的卡归入该分区（T3.7）
      if (dest.groupName) card.group = dest.groupName

      usedIds.push(id)
      cards.push(card)
      createdFiles.push(actualAbs)
      // 字节来源没有可重放的源路径 → src 传空串（undo 仍删副本，redo 不重建）
      sources.push({ src: item.path ?? '', destDir: dest.destDir })
      offset += INGEST_OFFSET_STEP
    } catch (error) {
      failures.push(`${item.name}（${error instanceof Error ? error.message : String(error)}）`)
    }
  }

  if (failures.length > 0) {
    deps.reportError(INGEST_FLOW_TEXT.failed(label, failures.join('；')))
  }
  if (cards.length === 0) return

  deps.reportError(null)
  await deps.commit(cards, createdFiles, sources, dest)
}
