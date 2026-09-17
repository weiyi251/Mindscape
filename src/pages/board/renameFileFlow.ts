// ============================================================================
// 模块说明（中文）
// 「重命名文件」的编排层（2026-09-15 用户需求：在空间中可以重命名文件）。
//
// 与 createPartitionFlow.ts 同构的流程文件：输入浮层（Board 侧薄壳弹出）→
// 校验（空名 / 非法字符 / 同目录同名冲突）→ 可撤销命令（renameCardFile.ts，
// 物理文件与视图字段一起动）→ 落盘。
//
// 为什么单独成文件：Board.tsx 有行数棘轮（架构守卫规则 1，阈值 2080），
// 校验 + 查重 + 命令组装整块搬出，Board 只留「组依赖 + 一行调用」。
//
// 依赖全部以参数注入（不直接 import store / history），可在 node 环境单测。
// ============================================================================

import { createRenameCardFileCommand, isValidCardFileName } from '@/core/commands/impl/renameCardFile'
import type { CardFileRefUpdate } from '@/core/commands/impl/moveCardToFolder'
import type { Command } from '@/core/commands/types'
import type { StorageProvider } from '@/core/storage/StorageProvider'
import type { Card } from '@/core/types'
import { basenameOf, dirnameOf, joinPath } from '@/core/utils/paths'
import type { PromptDialogState } from '@/components/ui/prompt-dialog'

/** 用户可见文案常量表（集中一处便于校对） */
export const RENAME_FILE_TEXT = {
  /** 输入浮层标题（不带文件名 —— 名字本身已在输入框里） */
  title: '重命名文件',
  /** 输入浮层占位提示 */
  placeholder: '输入新的文件名（含扩展名）',
  /** 只读模式（布局 version 过高）拒绝重命名 */
  readOnly: '布局由更新版本创建，处于只读模式，无法重命名',
  /** 名称为空 */
  empty: '文件名不能为空',
  /** 含非法字符或以 . 开头 */
  invalid: '文件名含非法字符（不可用 \\ / : * ? " < > |，也不能以 . 开头）',
  /** 同目录已有同名文件 */
  duplicate: (name: string) => `当前文件夹里已存在「${name}」，换一个名字吧`,
  /** 命令执行失败 */
  failed: (message: string) => `重命名失败：${message}`,
} as const

export interface RenameCardFileDeps {
  spacePath: string
  provider: StorageProvider
  /** 只读模式：true 时拒绝重命名 */
  readOnly: boolean
  /** 执行命令（Board 传 history.execute，成功后自动入撤销栈） */
  execute: (command: Command) => Promise<void>
  /** 请求落盘（Board 传 writer.schedule） */
  schedule: () => void
  /** 失败提示（中文，可直接展示） */
  onError: (message: string) => void
  /**
   * 写回层（Board 侧组装）：image 卡先重登记资源表（setCardAsset，方案 A 裁决 6
   * 「资源写入早于 store 更新」），再把 filePath / originalPath 写回 store
   * （setCardFileRefs）。group 由命令保持原值。
   */
  applyFileRefs: (card: Card, updates: CardFileRefUpdate[]) => void
}

/**
 * 校验并重命名卡片文件（同目录改名，文件夹归属不变）。
 *
 * 步骤：只读拦截 → 空名 / 非法字符校验 → 与旧名相同早退 → 硬盘同名检测 →
 * 执行命令 → 落盘。任一步失败即返回 false 并只经 onError 报错，
 * 画布与硬盘都不会被改动。
 *
 * @param card    目标卡片（filePath 非空，调用方保证）
 * @param rawName 用户输入的新文件名（内部 trim）
 * @returns 是否重命名成功
 */
export async function runRenameCardFile(
  card: Card,
  rawName: string,
  deps: RenameCardFileDeps,
): Promise<boolean> {
  if (deps.readOnly) {
    deps.onError(RENAME_FILE_TEXT.readOnly)
    return false
  }

  const newName = rawName.trim()
  if (newName === '') {
    deps.onError(RENAME_FILE_TEXT.empty)
    return false
  }
  if (!isValidCardFileName(newName)) {
    deps.onError(RENAME_FILE_TEXT.invalid)
    return false
  }
  // 与旧名相同：无意义的 no-op，静默成功（不报错、不落盘）
  if (newName === basenameOf(card.filePath)) return true

  // 硬盘同名检测：moveFile 重名会静默落成 `xxx_1.ext`，但重命名的语义是
  // 「用户明确指定新名字」—— 冲突必须显式拦截而不是静默改写。
  // 排除旧名自身（Windows 大小写不敏感，纯大小写改名合法）。
  const dirAbs = dirnameOf(joinPath(deps.spacePath, card.filePath))
  const entries = await deps.provider.listDir(dirAbs)
  const lower = newName.toLowerCase()
  const conflict = entries.find(
    (entry) => entry.name.toLowerCase() === lower && entry.name !== basenameOf(card.filePath),
  )
  if (conflict) {
    deps.onError(RENAME_FILE_TEXT.duplicate(newName))
    return false
  }

  try {
    await deps.execute(
      createRenameCardFileCommand(card, newName, {
        spacePath: deps.spacePath,
        provider: deps.provider,
        applyUpdate: (updates) => deps.applyFileRefs(card, updates),
      }),
    )
    deps.schedule()
    return true
  } catch (error) {
    deps.onError(
      RENAME_FILE_TEXT.failed(error instanceof Error ? error.message : String(error)),
    )
    return false
  }
}

/**
 * Board 侧接线用的便捷入口：组依赖 + 弹输入浮层，一步到位。
 * history / writer 用结构化接口接收，避免本模块反向依赖具体实例。
 */
export interface RenameFileBinding {
  spacePath: string
  provider: StorageProvider
  readOnly: boolean
  history: { execute: (command: Command) => Promise<void> }
  writer: { schedule: () => void }
  setPrompt: (state: PromptDialogState | null) => void
  setActionError: (message: string) => void
  applyFileRefs: (card: Card, updates: CardFileRefUpdate[]) => void
}

export function openRenameFilePrompt(card: Card, binding: RenameFileBinding): void {
  binding.setPrompt({
    title: RENAME_FILE_TEXT.title,
    value: basenameOf(card.filePath),
    placeholder: RENAME_FILE_TEXT.placeholder,
    onConfirm: (value) => {
      void runRenameCardFile(card, value, {
        spacePath: binding.spacePath,
        provider: binding.provider,
        readOnly: binding.readOnly,
        execute: (command) => binding.history.execute(command),
        schedule: () => binding.writer.schedule(),
        onError: binding.setActionError,
        applyFileRefs: binding.applyFileRefs,
      })
    },
  })
}
