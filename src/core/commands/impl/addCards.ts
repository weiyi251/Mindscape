// ============================================================================
// 模块说明（中文）
// 「追加卡片」命令。对应开发计划书 T3.4（新建便签）/ T3.6（拖入）/ T3.8（粘贴）
// 与第 7.4 节（撤销必须回滚文件操作 —— history.ts 的覆盖范围注释明确含「拖入文件」）。
//
// 三类调用共用一条命令：
//   · 新建便签      —— 不产生文件（filePath 为空串占位），undo 只删卡片
//   · 拖入 / 粘贴   —— 文件副本在命令外已由 Rust 复制落盘（复制模式，原件保留）；
//                      undo 时**删除本次创建的副本文件**（delete_file），再删卡片；
//                      redo 时若副本已被删除则**从源路径重新复制**（sources 记录了来源）
//
// 部分失败策略（7.4「宁可部分还原 + 明确告知，不要卡死」）：
//   undo 删文件失败 → 抛错（卡片保留，用户重试）；redo 重新复制失败 → 抛错。
// 实现任务：T3.4 / T3.6 / T3.8。
// ============================================================================

import type { Card } from '@/core/types'
import type { StorageProvider } from '@/core/storage/StorageProvider'
import { emitHookTyped } from '@/core/registry/pluginCenter'
import type { Command } from '../types'

/** 一次「复制来源」记录：redo 重建副本时需要 */
export interface AddCardsSource {
  /** 源文件绝对路径（粘贴场景为空串 —— 二进制来自剪贴板，redo 无法重建） */
  src: string
  /** 目标目录绝对路径 */
  destDir: string
}

export interface AddCardsPayload {
  cards: Card[]
  /** 本次操作在硬盘上**新创建**的文件（绝对路径）。undo 时删除 */
  createdFiles: string[]
  /** 复制来源（与 createdFiles 一一对应；空串表示无源、redo 跳过重建） */
  sources: AddCardsSource[]
}

export interface AddCardsDeps {
  provider: Pick<StorageProvider, 'copyFile' | 'deleteFile'>
  /** 追加卡片（boardStore.addCards） */
  applyAdd: (cards: Card[]) => void
  /** 移除卡片（boardStore.removeCardsLocally） */
  applyRemove: (ids: string[]) => void
}

export function createAddCardsCommand(
  payload: AddCardsPayload,
  deps: AddCardsDeps,
): Command {
  /** 是否已执行过 do()：首次执行时文件已由调用方复制就位（拖入/粘贴的复制发生在命令外），
   *  跳过重建；之后的 do()（redo）才需要按 sources 重新复制。 */
  let hasRun = false

  const removeFiles = async () => {
    for (const file of payload.createdFiles) {
      await deps.provider.deleteFile(file)
    }
  }

  const ensureFiles = async () => {
    for (let i = 0; i < payload.createdFiles.length; i += 1) {
      const source = payload.sources[i]
      if (!source || source.src === '') continue
      try {
        await deps.provider.copyFile(source.src, source.destDir)
      } catch (error) {
        // 重名兜底后实际路径可能带 _1 后缀，redo 只要求「文件存在」，路径偏差可容忍
        if (!isIgnorableCopyError(error)) throw error
      }
    }
  }

  return {
    type: 'addCards',

    async do() {
      if (hasRun) await ensureFiles()
      hasRun = true
      deps.applyAdd(payload.cards)
      // 插件生命周期钩子（2026-09-20 埋点）：do() 是「卡片出现在画布」的唯一汇聚点，
      // 新建 / 拖入 / 粘贴 / 插件建卡共用本命令；redo 再次出现也如实通知。
      for (const card of payload.cards) emitHookTyped('cardCreated', { card })
    },

    async undo() {
      await removeFiles()
      deps.applyRemove(payload.cards.map((card) => card.id))
    },
  }
}

/** 重新复制时最常见的「可忽略」错误：目标已被用户手工恢复过（已存在同名） */
function isIgnorableCopyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('已存在')
}
