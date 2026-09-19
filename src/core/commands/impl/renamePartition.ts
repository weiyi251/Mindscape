// ============================================================================
// 模块说明（中文）
// 「分区框重命名」命令（T2.6）。对应第六章保护措施：
//   ① 非法字符检测（上层 Board 在提交前拦截）
//   ② 同名冲突检测（上层拦截）
//   ③ 文件夹占用检测（renameDir 失败 → Err → 本命令不生效）
//   ④ 确认框（上层拦截）
//   ⑤ 执行 + 记录旧名（本命令：do / undo 都**同时改硬盘文件夹名与画布状态**，
//      落实 7.4「撤销必须同时回滚文件操作」—— 只还原画布不还原硬盘会出现
//      「画布显示旧名、硬盘已是新名」的错位）
//
// 实现任务：T2.6 / T2.9。
// ============================================================================

import type { Command } from '../types'
import type { StorageProvider } from '@/core/storage/StorageProvider'
import { joinPath } from '@/core/utils/paths'
import { emitHookTyped } from '@/core/registry/pluginCenter'

export interface RenamePartitionDelta {
  partitionId: string
  oldName: string
  newName: string
  /** 旧的相对 folderPath（一层扫描下 = oldName） */
  oldFolderPath: string
  newFolderPath: string
}

/** 写回层签名：写 boardStore.renamePartition */
export type ApplyPartitionRename = (payload: {
  id: string
  name: string
  folderPath: string
  groupFrom: string
  groupTo: string
}) => void

/**
 * 创建「分区框重命名」命令。
 *
 * do(): 硬盘 renameDir(旧绝对路径, 新名) → 状态写新名
 * undo(): 硬盘 renameDir(新绝对路径, 旧名) → 状态写旧名
 *
 * @param spacePath 空间文件夹绝对路径（拼出硬盘上的完整路径）
 * @param provider  存储实现（renameDir 失败会抛中文错误 → History 不推进指针）
 */
export function createRenamePartitionCommand(
  delta: RenamePartitionDelta,
  context: { spacePath: string; provider: StorageProvider; apply: ApplyPartitionRename },
): Command {
  const applyTo = (name: string, folderPath: string, groupFrom: string, groupTo: string) =>
    context.apply({
      id: delta.partitionId,
      name,
      folderPath,
      groupFrom,
      groupTo,
    })

  return {
    type: 'rename',

    async do() {
      await context.provider.renameDir(
        joinPath(context.spacePath, delta.oldFolderPath),
        delta.newName,
      )
      applyTo(delta.newName, delta.newFolderPath, delta.oldName, delta.newName)
      // 插件生命周期钩子（2026-09-20 埋点）：硬盘文件夹已同步改名后才触发
      emitHookTyped('partitionRenamed', {
        partitionId: delta.partitionId,
        previousName: delta.oldName,
        nextName: delta.newName,
      })
    },

    async undo() {
      await context.provider.renameDir(
        joinPath(context.spacePath, delta.newFolderPath),
        delta.oldName,
      )
      applyTo(delta.oldName, delta.oldFolderPath, delta.newName, delta.oldName)
    },
  }
}
