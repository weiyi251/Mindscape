// ============================================================================
// 模块说明（中文）
// 「批量补分区框」命令（A2，2026-09-20 用户计划第 2 步：
// 磁盘上有子文件夹、画布上却没有框时，一键把框补齐）。
//
// 【为什么不碰硬盘】这是本命令与 createPartition.ts 的关键差别：
//   createPartition 是「用户新建分区」→ 目录是我们建的，所以 do 要 createDir、
//   undo 要回收空目录（画布与硬盘一起动，7.4）。
//   本命令是「发现磁盘上已存在的文件夹并补出它的框」→ 目录本来就在，
//   用户的数据不能被我们动一下。因此：
//     do()   ：只往画布追加分区框
//     undo() ：只从画布移除这些框，**绝不删目录**
//   （目录是用户的；若这里删了，撤销一次「补框」就等于删掉用户的文件夹。）
//
// 【只加框，不改归属】命令不动卡片的 group —— 空文件夹本就没有卡片；
//   万一某框命中已有卡片（异常自愈路径），卡片仍在原 group 上，语义不变。
//
// 实现日期：2026-09-20。
// ============================================================================

import type { Command } from '../types'
import type { Partition } from '@/core/types'

export interface AddPartitionsContext {
  /** 画布批量追加分区框（boardStore.addPartitions） */
  applyAdd: (partitions: Partition[]) => void
  /** 画布批量移除分区框（boardStore.removePartitions） */
  applyRemove: (ids: string[]) => void
}

/**
 * 创建「批量补分区框」命令。
 *
 * @param partitions 由 core/board/partitions.createPartitionsForFolders 生成的框清单
 */
export function createAddPartitionsCommand(
  partitions: Partition[],
  context: AddPartitionsContext,
): Command {
  return {
    type: 'addPartitions',

    do() {
      context.applyAdd(partitions)
    },

    undo() {
      // 只撤画布上的框；磁盘目录是用户的，无论如何都不动
      context.applyRemove(partitions.map((item) => item.id))
    },
  }
}
