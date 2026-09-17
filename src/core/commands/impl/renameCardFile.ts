// ============================================================================
// 模块说明（中文）
// 「重命名卡片文件」命令（2026-09-15 用户需求：在空间中可以重命名文件）。
//
// 与「移动卡片到文件夹」（moveCardToFolder.ts）互为镜像：**视图 + 文件一起动**
// —— 物理文件 moveFile 到同目录的新名字，卡片的 filePath / originalPath 同步
// 更新（group 不变 —— 重命名不动文件夹归属）；undo 时文件移回旧名、字段还原，
// 不允许出现「画布显示新名、硬盘躺在旧名」的状态。
//
// 【为什么不用 moveFile 的静默加后缀】移动到文件夹时目标重名落成 `xxx_1.ext`
// 可接受（用户选的是「位置」）；但重命名用户明确指定了**新名字**，落成 _1
// 就不是用户要的结果 —— 因此同名冲突由上层流程（renameFileFlow.ts）在弹窗
// 确认前经 listDir 拦截，本命令不再重复查（与 moveCardToFolder 同款：
// do 以 moveFile 的实际落点反推相对路径写入 filePath，undo/redo 均安全）。
//
// 单卡操作（菜单是逐卡触发的），不做批量；失败抛错 → 命令不入栈、状态不变。
// ============================================================================

import type { Card } from '@/core/types'
import type { Command } from '../types'
import type { StorageProvider } from '@/core/storage/StorageProvider'
import { dirnameOf, joinPath, relativePathOf } from '@/core/utils/paths'
import type { CardFileRefUpdate } from './moveCardToFolder'

/** 写回层签名：boardStore.setCardFileRefs（与 moveCardToFolder 同一 payload） */
export type ApplyCardFileRefs = (updates: CardFileRefUpdate[]) => void

export interface RenameCardFileContext {
  spacePath: string
  provider: StorageProvider
  /** do / undo 的应用：写回卡片的 filePath / originalPath（group 原样保留） */
  applyUpdate: ApplyCardFileRefs
}

/**
 * Windows 文件名非法字符（与 partitions.ts 的 INVALID_FOLDER_CHARS、
 * Rust 侧 INVALID_FOLDER_CHARS 保持一致）。
 */
const INVALID_FILE_NAME_CHARS = ['\\', '/', ':', '*', '?', '"', '<', '>', '|', '\0']

/**
 * 校验新文件名（弹窗确认前的第一道拦截；同名冲突需 IO，由流程层查）。
 * 与 isValidFolderName 同一套规则：非空、不以 . 开头、不含非法字符。
 */
export function isValidCardFileName(name: string): boolean {
  return (
    name.trim().length > 0 &&
    name !== '.' &&
    name !== '..' &&
    !name.startsWith('.') &&
    !name.split('').some((char) => INVALID_FILE_NAME_CHARS.includes(char))
  )
}

/**
 * 创建「重命名卡片文件」命令。
 *
 * @param card    目标卡片（filePath 非空，调用方保证）
 * @param newName 新文件名（含扩展名；目录不变，调用方已校验）
 * @param context 注入的空间路径 / 存储层 / 写回层
 */
export function createRenameCardFileCommand(
  card: Card,
  newName: string,
  context: RenameCardFileContext,
): Command {
  /** do 的实际落点（重名改写时与预期 dest 不同）；undo 用它移回 */
  let actualAbs = ''

  return {
    type: 'renameCardFile',

    async do() {
      const srcAbs = joinPath(context.spacePath, card.filePath)
      const destAbs = joinPath(
        context.spacePath,
        joinPath(dirnameOf(card.filePath), newName),
      )

      actualAbs = await context.provider.moveFile(srcAbs, destAbs)
      const newRel = relativePathOf(actualAbs, context.spacePath)

      context.applyUpdate([
        {
          id: card.id,
          filePath: newRel,
          originalPath: newRel,
          group: card.group,
        },
      ])
    },

    async undo() {
      // 文件先回旧名（actualAbs 在重名改写时与预期 dest 不同，以实际为准）
      await context.provider.moveFile(actualAbs, joinPath(context.spacePath, card.filePath))

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
