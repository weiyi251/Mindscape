// ============================================================================
// 模块说明（中文）
// 「移动卡片到文件夹」命令（2026-09-12 用户裁决：画布内切换图片所属文件夹）。
//
// 与「移除卡片」（removeCards.ts）同一条铁律：**视图 + 文件一起动** ——
// 物理文件 moveFile 到目标文件夹（未分类 / 某分区对应的子文件夹），
// 卡片的 filePath / originalPath / group 同步更新；undo 时文件移回原位、
// 字段原样还原（含目标分区被扩大的包围盒），不允许出现「画布显示 A 处、
// 硬盘躺在 B 处」的状态。
//
// 【重名自动加后缀】moveFile 在目标重名时会落成 `xxx_1.ext`，
// 因此 do() 必须以**实际落点**反推相对路径写入 filePath（removeCards 同款做法）。
//
// 【分区包围盒】目标分区若未包住卡片位置，按 ingest.expandedBounds 扩大（只扩不缩）；
// undo 时把分区矩形**原样还原**（记录 do 之前的矩形）。
//
// 单卡操作（菜单是逐卡触发的），不做批量；失败抛错 → 命令不入栈、状态不变。
//
// 实现日期：2026-09-12。
// ============================================================================

import type { Card, Partition } from '@/core/types'
import type { Command } from '../types'
import type { StorageProvider } from '@/core/storage/StorageProvider'
import { basenameOf, joinPath, relativePathOf } from '@/core/utils/paths'
import { expandedBounds } from '@/core/board/ingest'

/** 卡片文件归属的更新（boardStore.setCardFileRefs 的 payload） */
export interface CardFileRefUpdate {
  id: string
  filePath: string
  originalPath: string
  /** undefined = 移出所有分区（未分类 / 空间根目录） */
  group: string | undefined
}

export interface MoveCardToFolderContext {
  spacePath: string
  provider: StorageProvider
  /** do / undo 的应用：写回卡片的 filePath / originalPath / group */
  applyUpdate: (updates: CardFileRefUpdate[]) => void
  /** 目标分区包围盒变化（do 扩大 / undo 还原），走 boardStore.setPartitionRects */
  applyPartitionRects: (updates: { id: string; x: number; y: number; w: number; h: number }[]) => void
}

/**
 * 计算卡片当前所在的顶层子文件夹名（相对路径第一段；根目录文件返回 ''）。
 * 用于菜单层过滤「卡片本来就在的文件夹」（移到原地是无意义的 no-op）。
 */
export function currentTopFolderOf(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const index = normalized.indexOf('/')
  return index === -1 ? '' : normalized.slice(0, index)
}

/**
 * 创建「移动卡片到文件夹」命令。
 *
 * @param card            被移动的卡片（filePath 非空，调用方保证）
 * @param targetFolderRel 目标文件夹相对空间根的路径（如 `旅行` 或 `未分类`）
 * @param targetGroupName 目标分区名；未分类 / 空间根传 undefined
 * @param targetPartition 目标分区对象（用于扩包围盒）；未分类传 null
 */
export function createMoveCardToFolderCommand(
  card: Card,
  targetFolderRel: string,
  targetGroupName: string | undefined,
  targetPartition: Partition | null,
  context: MoveCardToFolderContext,
): Command {
  let actualAbs = ''
  /** do 之前目标分区的矩形（undo 原样还原）；分区未变化时为 null */
  let previousBounds: { id: string; x: number; y: number; w: number; h: number } | null = null

  return {
    type: 'moveCardToFolder',

    async do() {
      const srcAbs = joinPath(context.spacePath, card.filePath)
      const destAbs = joinPath(
        context.spacePath,
        joinPath(targetFolderRel, basenameOf(card.filePath)),
      )

      // 重名时 moveFile 自动加 _1 后缀 → 必须以实际落点反推相对路径
      actualAbs = await context.provider.moveFile(srcAbs, destAbs)
      const newRel = relativePathOf(actualAbs, context.spacePath)

      // 目标分区扩框（只扩不缩）；记录 do 之前的矩形供 undo 还原
      previousBounds = null
      if (targetPartition) {
        const next = expandedBounds(targetPartition, card)
        if (next) {
          previousBounds = {
            id: targetPartition.id,
            x: targetPartition.x,
            y: targetPartition.y,
            w: targetPartition.w,
            h: targetPartition.h,
          }
          context.applyPartitionRects([{ id: targetPartition.id, ...next }])
        }
      }

      context.applyUpdate([
        {
          id: card.id,
          filePath: newRel,
          originalPath: newRel,
          group: targetGroupName,
        },
      ])
    },

    async undo() {
      // 文件先回原位（字段里的旧值以 card 为准，actualAbs 只在重名改写时与 newRel 不同）
      await context.provider.moveFile(actualAbs, joinPath(context.spacePath, card.filePath))

      if (previousBounds) {
        context.applyPartitionRects([{ ...previousBounds }])
        previousBounds = null
      }

      context.applyUpdate([
        {
          id: card.id,
          filePath: card.filePath,
          originalPath: card.originalPath,
          group: card.group,
        },
      ])
    },
  }
}
