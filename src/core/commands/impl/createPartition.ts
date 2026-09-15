// ============================================================================
// 模块说明（中文）
// 「新建分区」命令（2026-09-14 用户要求：在空间内直接创建分区，
// 创建后在对应空间文件夹下自动生成同名文件夹）。
//
// 与「分区框重命名」（renamePartition.ts）同一条铁律（7.4）：
// **画布与硬盘一起动** ——
//   do()   ：硬盘 createDir(空间路径/分区名) → 画布追加分区框
//   undo() ：硬盘回收空文件夹 → 画布移除分区框
//
// 【撤单顺序】undo 先动硬盘、后撤画布：硬盘一步失败就抛出，
//   撤销指针不推进、画布保持原样，用户可重试（与 renamePartition 同款）。
//
// 【只删空文件夹】undo 前先 listDir 确认目录为空才 deleteDir。
//   按命令栈顺序，能撤到本命令时，后来往框里放的卡片/移入的文件都已先被撤销，
//   目录理应为空；万一不为空（异常路径）则**保留文件夹**并如实提示，
//   绝不递归删掉用户文件。
//
// 实现日期：2026-09-14。
// ============================================================================

import type { Command } from '../types'
import type { StorageProvider } from '@/core/storage/StorageProvider'
import type { Partition } from '@/core/types'
import { joinPath } from '@/core/utils/paths'

export interface CreatePartitionContext {
  /** 空间文件夹绝对路径 */
  spacePath: string
  provider: StorageProvider
  /** 画布追加分区框（boardStore.addPartition） */
  applyAdd: (partition: Partition) => void
  /** 画布移除分区框（boardStore.removePartitions） */
  applyRemove: (ids: string[]) => void
  /** 非致命提示（中文，可直接展示）：目录非空未回收这类情况 */
  onNotice?: (message: string) => void
}

/**
 * 创建「新建分区」命令。
 *
 * @param partition 新建的分区框（由 partitions.createPartitionAt 生成，folderPath 即文件夹名）
 */
export function createCreatePartitionCommand(
  partition: Partition,
  context: CreatePartitionContext,
): Command {
  const absPath = joinPath(context.spacePath, partition.folderPath)

  return {
    type: 'createPartition',

    async do() {
      // create_dir 幂等（已存在视为成功），因此 redo 不会因文件夹尚在而失败
      await context.provider.createDir(absPath)
      context.applyAdd(partition)
    },

    async undo() {
      if (await context.provider.dirExists(absPath)) {
        const entries = await context.provider.listDir(absPath)
        if (entries.length === 0) {
          await context.provider.deleteDir(absPath)
        } else {
          context.onNotice?.(
            `分区「${partition.name}」的文件夹里还有内容，已保留该文件夹（未递归删除）`,
          )
        }
      }
      context.applyRemove([partition.id])
    },
  }
}
