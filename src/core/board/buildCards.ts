// ============================================================================
// 模块说明（中文）
// 目录内容 → 画布卡片。对应 T1.3「进入画布：读文件夹 → 生成卡片」，
// 以及 8.3 / 第九章的文件类型分流（图片卡片 / 文件卡片）。
//
// 数据来源：StorageProvider.listDir（一层、不递归，见 17.5）。
//   子文件夹在阶段一不展开 —— 它们会在 T2.5 变成分区框。因此这里的
//   filePath 就是文件名（相对空间文件夹的路径），与 4.2 的字段定义一致。
//
// 卡片尺寸策略：
//   默认用各卡片类型的默认尺寸（T0.10 的 CORE_CARD_TYPE_DEFAULT_SIZE）；
//   T1.4 会传入 sizeFor 用图片原始宽高比覆盖。
//
// 纯函数，可单元测试（不依赖 Tauri）。
//
// 实现任务：T1.3（阶段一）。
// ============================================================================

import { zCardSchema } from '@/core/types'
import type { Card } from '@/core/types'
import { nextCardId } from '@/core/utils/id'
import { CORE_CARD_TYPE_DEFAULT_SIZE } from '@/core/registry/cardTypes'
import type { DirEntry } from '@/core/storage/StorageProvider'
import { layoutGrid } from './grid'
import type { GridOptions } from './grid'
import { cardTypeFor } from './imageTypes'

export interface CardSize {
  w: number
  h: number
}

export interface BuildCardsOptions {
  /** 每张卡片的尺寸；不传则用该卡片类型的默认尺寸 */
  sizeFor?: (entry: DirEntry, index: number) => CardSize
  /** 网格参数（起始位置 / 列数 / 间距） */
  grid?: GridOptions
  /** 已存在的卡片 id，避免新建卡片 id 冲突 */
  existingCardIds?: string[]
}

/**
 * 筛出要上画布的文件：跳过目录、跳过以 . 开头的隐藏文件。
 * 隐藏项（如 macOS 的 .DS_Store、.mindscape 目录）不是用户放进来的内容。
 */
export function selectMediaEntries(entries: DirEntry[]): DirEntry[] {
  return entries.filter((entry) => !entry.isDir && !entry.name.startsWith('.'))
}

/**
 * 从目录项生成卡片数组（已带网格位置）。
 * 顺序即 list_dir 返回顺序（Rust 侧已按名称排序，保证每次进入画布布局稳定）。
 */
export function createCardsFromEntries(entries: DirEntry[], options: BuildCardsOptions = {}): Card[] {
  const media = selectMediaEntries(entries)
  if (media.length === 0) return []

  const sizeFor =
    options.sizeFor ??
    ((entry: DirEntry): CardSize => {
      const type = cardTypeFor(entry.name)
      return CORE_CARD_TYPE_DEFAULT_SIZE[type]
    })

  const sizes = media.map((entry, index) => sizeFor(entry, index))
  const positions = layoutGrid(sizes, options.grid)

  const usedIds = [...(options.existingCardIds ?? [])]

  return media.map((entry, index) => {
    const id = nextCardId(usedIds)
    usedIds.push(id)

    return zCardSchema.parse({
      id,
      type: cardTypeFor(entry.name),
      filePath: entry.name,
      originalPath: entry.name,
      x: positions[index].x,
      y: positions[index].y,
      w: sizes[index].w,
      h: sizes[index].h,
    })
  })
}
