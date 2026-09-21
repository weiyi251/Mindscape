// ============================================================================
// 模块说明（中文）
// 移动端「导入文件」入口的编排层（2026-09-21 移动端适配 M4，对应
// docs/移动端适配计划.md §3 M4「文件选择器替代拖入」）。
//
// 为什么桌面有拖入、移动端必须另开一条口子：
//   1. Tauri 的 `onDragDropEvent` 只在桌面注册（移动端 WebView 的 drop 事件给不出路径），
//      能力表里对应 `dragAndDropImport: false`；
//   2. Android 的 SAF 只把文件交给应用，`<input type=file>` 交回来的是**字节**而不是
//      `/storage/...` 真路径 —— 而 Rust 的 `copy_file` 是纯 `std::fs`，读不到 content://。
//      所以落盘不能复用复制，必须走 `write_file_bytes`（重名由 Rust 侧加 `_1`）。
//
// 除了落盘这一处，其余链路与拖入/粘贴完全同构（同一个 ingestExternalItems）：
// 建卡、分区归属、逐文件失败汇总、addCards 命令（undo 删副本）、分区扩框、排程写布局。
// 字节来源没有可重放的源路径，`sources[i].src` 为空串 —— 与截图粘贴同一套约定。
//
// 落点规则沿用粘贴（2026-09-12 用户裁决：不靠落点猜测）：选中分区 → 该分区文件夹，
// 否则 → 空间主目录；卡片出现在视口中心。
//
// 分层：本文件是纯编排 + 依赖注入（node 可单测，不碰 Tauri）；
// 装配在 pages/Board.tsx，渲染在 importFilesButton.tsx。
// ============================================================================

import type { AddCardsSource } from '@/core/commands/impl/addCards'
import type { DropDestination } from '@/core/board/ingest'
import type { Card } from '@/core/types'
import type { Point } from '@/canvas/interaction/connectionAnchor'

import { INGEST_FLOW_TEXT, ingestExternalItems, itemBytes } from './ingestFlow'
import type { ExternalIngestDeps, PickedFile } from './ingestFlow'

export const IMPORT_FILES_TEXT = {
  /** 顶栏图标按钮的悬浮提示 / 读屏标签（按钮面上不写字） */
  title: '从本机选择文件加入当前空间',
  label: '导入文件',
  /** 只读模式下的拒绝提示（与拖入/粘贴同句式，见 ingestFlow.ts 的文案表） */
  readOnly: INGEST_FLOW_TEXT.readOnly('导入'),
}

/** 图片优先，其余文件类型交给系统选择器兜底（Android 上决定能挑到什么） */
export const IMPORT_FILE_ACCEPT = 'image/*,*/*'

/**
 * 从 `<input>.files` 取出选择器交来的文件。
 * FileList 没有迭代器（同 paste 事件的 DataTransferItemList），只能按索引取；
 * 用户取消选择时是 null —— 变成空数组，交给下面第一道判断静默返回。
 */
export function pickedFilesFrom(files: ArrayLike<PickedFile> | null | undefined): PickedFile[] {
  if (!files) return []
  const out: PickedFile[] = []
  for (let index = 0; index < files.length; index += 1) out.push(files[index])
  return out
}

export interface ImportFilesDeps {
  /** 当前空间的主目录；null 表示没打开空间 */
  spaceFolder: () => string | null
  readOnly: () => boolean
  /** 落盘目标（确定性规则，同粘贴：选中分区 → 该分区，否则空间主目录） */
  destination: () => DropDestination | null
  /** 首卡落点（视口中心的画布坐标） */
  dropPoint: () => Point | null
  /** 写出字节到 destDir，返回实际落盘的绝对路径（localStorageProvider.writeFileBytes） */
  writeFile: (destDir: string, fileName: string, bytes: Uint8Array) => Promise<string>
  buildCard: ExternalIngestDeps['buildCard']
  usedCardIds: () => string[]
  nextCardId: (taken: string[]) => string
  commit: (
    cards: Card[],
    createdFiles: string[],
    sources: AddCardsSource[],
    dest: DropDestination,
  ) => Promise<void>
  reportError: (message: string | null) => void
}

/**
 * 选择器交来的文件收进空间。任何前置条件不满足时**必须给一句人话**（reportError），
 * 只有「用户取消选择」这种什么都没发生的情况才静默返回。
 */
export async function importPickedFiles(
  deps: ImportFilesDeps,
  files: PickedFile[],
): Promise<void> {
  if (files.length === 0) return

  if (deps.readOnly()) {
    deps.reportError(IMPORT_FILES_TEXT.readOnly)
    return
  }
  const spacePath = deps.spaceFolder()
  if (spacePath === null) return

  const dest = deps.destination()
  const point = deps.dropPoint()
  if (!dest || !point) return

  await ingestExternalItems(
    {
      copyIn: async (item, destDir) =>
        deps.writeFile(destDir, item.name, await itemBytes(item)),
      buildCard: deps.buildCard,
      usedCardIds: deps.usedCardIds,
      nextCardId: deps.nextCardId,
      commit: deps.commit,
      reportError: deps.reportError,
    },
    files.map((file) => ({ name: file.name, file })),
    spacePath,
    dest,
    point,
    '导入',
  )
}
