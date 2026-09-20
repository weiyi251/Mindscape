// ============================================================================
// 模块说明（中文）
// 「一键补分区框」的编排层（A2，2026-09-20 用户计划第 2 步）。
//
// 背景：进空间时 `createPartitions` 会为扫描到的子文件夹自动建框，但**空子文件夹**
// 没有包围盒、建不了框 → 磁盘上有目录、画布上却什么都没有。这与项目的铁律
// 「文件夹是真相，画布只是视图」不符：用户在资源管理器里看得到、在画布里看不到。
//
// 本流程把这份差集（boardStore.unframedFolders）一次性补成框：
//   几何 → core/board/partitions.createPartitionsForFolders（纯函数）
//   命令 → core/commands/impl/addPartitions（只加框，**不碰硬盘**）
//   落盘 → 由 Board 传入的 schedule（500ms 防抖原子写）
//
// 依赖全部以参数注入（不直接 import History / LayoutWriter），因此可在 node 环境单测。
// ============================================================================

import { createPartitionsForFolders } from '@/core/board/partitions'
import { createAddPartitionsCommand } from '@/core/commands/impl/addPartitions'
import type { Command } from '@/core/commands/types'
import { useBoardStore } from '@/core/store/boardStore'
import type { Card, Partition } from '@/core/types'

/** 用户可见文案常量表（集中一处便于校对；core 层不持有文案） */
export const GENERATE_PARTITIONS_TEXT = {
  /** 只读模式（布局 version 过高）拒绝写画布 */
  readOnly: '布局由更新版本创建，处于只读模式，无法补生成分区框',
  /** 命令执行失败 */
  failed: (message: string) => `生成分区框失败：${message}`,
} as const

/**
 * 本流程需要的画布状态切片。
 * 传 `useBoardStore.getState()` 即可（结构化类型，多余字段不影响）。
 */
export interface GeneratePartitionsStore {
  /** 只读模式：true 时拒绝写画布 */
  readOnly: boolean
  /** 全部卡片（求包围盒用） */
  cards: Card[]
  /** 画布现有分区框（取号 / 配色 / 避让用） */
  partitions: Partition[]
  /** 磁盘上有目录、画布上无框的文件夹名（由 loadSpace 算出） */
  unframedFolders: string[]
  addPartitions: (partitions: Partition[]) => void
  removePartitions: (ids: string[]) => void
  setUnframedFolders: (names: string[]) => void
}

export interface GeneratePartitionsDeps {
  store: GeneratePartitionsStore
  /** 执行命令（Board 传 history.execute，成功后自动入撤销栈） */
  execute: (command: Command) => Promise<void>
  /** 请求落盘（Board 传 writer.schedule） */
  schedule: () => void
  /** 失败提示（中文，可直接展示） */
  onError: (message: string) => void
}

/**
 * 为「磁盘有目录、画布无框」的文件夹批量补框。
 *
 * @returns 实际补出的框数量（0 表示没有待补项，或过程失败）
 */
export async function runGeneratePartitions(deps: GeneratePartitionsDeps): Promise<number> {
  const { store } = deps
  const names = store.unframedFolders
  if (names.length === 0) return 0

  if (store.readOnly) {
    deps.onError(GENERATE_PARTITIONS_TEXT.readOnly)
    return 0
  }

  try {
    const partitions = createPartitionsForFolders({
      names,
      cards: store.cards,
      existing: store.partitions,
    })
    if (partitions.length === 0) return 0

    await deps.execute(
      createAddPartitionsCommand(partitions, {
        applyAdd: (items) => store.addPartitions(items),
        applyRemove: (ids) => store.removePartitions(ids),
      }),
    )

    // 补完即清空提示（差集已经被消费掉）
    store.setUnframedFolders([])
    deps.schedule()
    return partitions.length
  } catch (error) {
    deps.onError(
      GENERATE_PARTITIONS_TEXT.failed(error instanceof Error ? error.message : String(error)),
    )
    return 0
  }
}

// ---------------------------------------------------------------------------
// Board 侧接线（自读 store 组依赖，Board 只留一行 JSX）
// ---------------------------------------------------------------------------

export interface GeneratePartitionsBinding {
  /** 撤销栈（Board 传 History 实例） */
  history: { execute: (command: Command) => Promise<void> }
  /** 落盘调度（Board 传 LayoutWriter 实例） */
  writer: { schedule: () => void }
  /** 失败提示（Board 传 setActionError） */
  onError: (message: string) => void
}

/**
 * 按钮点击入口：取当前画布状态 + 组依赖 → 执行补框。
 *
 * ⚠️ 这是本文件唯一「直接读 store」的函数（runGeneratePartitions 仍是纯注入的），
 *    原因与 createPartitionFlow.openCreatePartitionPrompt 相同：Board.tsx 有行数棘轮。
 */
export function generatePartitionsFromFolders(binding: GeneratePartitionsBinding): Promise<number> {
  return runGeneratePartitions({
    store: useBoardStore.getState(),
    execute: (command) => binding.history.execute(command),
    schedule: () => binding.writer.schedule(),
    onError: binding.onError,
  })
}

/**
 * 「暂不生成」：只清掉本次提示（内存态）。
 * 不落盘、不进撤销栈 —— 下次进入空间会按当时的磁盘状况重新算。
 */
export function dismissUnframedFolders(): void {
  useBoardStore.getState().setUnframedFolders([])
}
