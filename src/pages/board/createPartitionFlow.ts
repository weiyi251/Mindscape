// ============================================================================
// 模块说明（中文）
// 「新建分区」的编排层（2026-09-14 用户要求：在空间内直接创建分区，
// 创建后在对应空间文件夹下自动生成同名文件夹）。
//
// 为什么单独成文件：Board.tsx 是全项目最大的文件（架构守卫规则 1 有行数棘轮），
// 校验 → 查重 → 命令 → 落盘的流程整块抽出，Board 侧只留「弹输入框 + 传依赖」。
//
// 职责划分：
//   · 纯名称校验（空 / 非法字符 / 保留名 / 画布同名）→ core/board/partitions
//   · 硬盘同名检测 + 命令执行编排 → 本文件
//   · 分区框对象构造 → core/board/partitions.createPartitionAt
//   · 文件夹创建 / 回收 → core/commands/impl/createPartition
//
// 依赖全部以参数注入（不直接 import store / history），因此可在 node 环境单测，
// 无需 DOM，也无需真机。
// ============================================================================

import { checkNewPartitionName, createPartitionAt } from '@/core/board/partitions'
import type { NewPartitionNameIssue } from '@/core/board/partitions'
import type { PromptDialogState } from '@/components/ui/prompt-dialog'
import { createCreatePartitionCommand } from '@/core/commands/impl/createPartition'
import type { Command } from '@/core/commands/types'
import { localStorageProvider } from '@/core/storage/LocalFolderProvider'
import { useBoardStore } from '@/core/store/boardStore'
import { useSpacesStore } from '@/core/store/spacesStore'
import type { StorageProvider } from '@/core/storage/StorageProvider'
import type { Partition } from '@/core/types'
import { joinPath } from '@/core/utils/paths'

/** 用户可见文案常量表（集中一处便于校对；core 层不持有文案） */
export const PARTITION_CREATE_TEXT = {
  /** 输入浮层标题 */
  title: '新建分区',
  /** 输入浮层占位提示 */
  placeholder: '例如：旅行 / 参考素材',
  /** 只读模式（布局 version 过高）拒绝创建 */
  readOnly: '布局由更新版本创建，处于只读模式，无法新建分区',
  /** 名称为空 */
  empty: '分区名不能为空',
  /** 含非法字符或以 . 开头 */
  invalid: '名称含非法字符（不可用 \\ / : * ? " < > |，也不能以 . 开头）',
  /** 与保留目录同名（.mindscape / _已移除） */
  reserved: '该名称是系统保留目录名，换一个吧',
  /** 画布上已有同名分区 */
  duplicate: '已存在同名分区，换一个名字吧',
  /** 硬盘上已有同名文件夹 */
  existsOnDisk: (name: string) => `空间文件夹里已存在「${name}」，换一个名字吧`,
  /** 命令执行失败 */
  failed: (message: string) => `新建分区失败：${message}`,
} as const

/** 名称校验结果 → 中文提示 */
function issueText(issue: NewPartitionNameIssue): string {
  return PARTITION_CREATE_TEXT[issue]
}

/**
 * 本流程需要的画布状态切片。
 * 传 `useBoardStore.getState()` 即可（结构化类型，多余字段不影响）。
 */
export interface PartitionCreationStore {
  /** 只读模式：true 时拒绝创建 */
  readOnly: boolean
  /** 当前画布上的全部分区框（查重 + 取号 + 配色轮换都基于它） */
  partitions: Partition[]
  addPartition: (partition: Partition) => void
  removePartitions: (ids: string[]) => void
  /** 创建成功后选中新分区（Ctrl+V 的粘贴目标） */
  selectPartition: (id: string | null) => void
}

export interface CreatePartitionDeps {
  /** 空间文件夹绝对路径 */
  spacePath: string
  provider: StorageProvider
  store: PartitionCreationStore
  /** 执行命令（Board 传 history.execute，成功后自动入撤销栈） */
  execute: (command: Command) => Promise<void>
  /** 请求落盘（Board 传 writer.schedule） */
  schedule: () => void
  /** 失败提示（中文，可直接展示） */
  onError: (message: string) => void
}

/**
 * 校验并创建一个新分区（并在空间文件夹下落地同名文件夹）。
 *
 * 步骤：只读拦截 → 名称校验（纯函数）→ 硬盘同名检测 → 建框 → 执行命令 → 落盘。
 * 任一步失败即返回 false 并只经 onError 报错，画布与硬盘都不会被改动。
 *
 * @param rawName 用户输入的名称（内部 trim）
 * @param center  右键点处的画布坐标，新框以此为**中心**
 * @returns 是否创建成功
 */
export async function runCreatePartition(
  rawName: string,
  center: { x: number; y: number },
  deps: CreatePartitionDeps,
): Promise<boolean> {
  const { store } = deps
  if (store.readOnly) {
    deps.onError(PARTITION_CREATE_TEXT.readOnly)
    return false
  }

  const name = rawName.trim()
  const issue = checkNewPartitionName(name, store.partitions)
  if (issue) {
    deps.onError(issueText(issue))
    return false
  }

  try {
    // 硬盘同名检测：画布上没有、但空间文件夹里已存在同名目录 → 拒绝，
    // 否则命令的 create_dir 会把两个分区指向同一个文件夹
    const exists = await deps.provider.dirExists(joinPath(deps.spacePath, name))
    if (exists) {
      deps.onError(PARTITION_CREATE_TEXT.existsOnDisk(name))
      return false
    }

    const partition = createPartitionAt(name, center, store.partitions)
    await deps.execute(
      createCreatePartitionCommand(partition, {
        spacePath: deps.spacePath,
        provider: deps.provider,
        applyAdd: (created) => store.addPartition(created),
        applyRemove: (ids) => store.removePartitions(ids),
        onNotice: deps.onError,
      }),
    )
    deps.schedule()
    store.selectPartition(partition.id)
    return true
  } catch (error) {
    deps.onError(
      PARTITION_CREATE_TEXT.failed(error instanceof Error ? error.message : String(error)),
    )
    return false
  }
}

/**
 * Board 侧接线用的便捷入口：取当前空间 + 组依赖 + 弹出命名浮层，一步到位。
 *
 * 为什么收在这里：Board.tsx 有行数棘轮（架构守卫规则 1，阈值 2080），
 * 「取 store → 组 6 个依赖 → 弹浮层」整块搬到本模块后，Board 只留一行调用。
 *
 * ⚠️ 这是本文件唯一的「直接读 store」的函数（runCreatePartition 仍是纯注入的）。
 *    history / writer 用结构化接口接收，避免本模块反向依赖 LayoutWriter / History 实例。
 */
export interface CreatePartitionBinding {
  /** 撤销栈（Board 传 History 实例） */
  history: { execute: (command: Command) => Promise<void> }
  /** 落盘调度（Board 传 LayoutWriter 实例） */
  writer: { schedule: () => void }
  /** 输入浮层开关（Board 传 setPrompt） */
  setPrompt: (state: PromptDialogState | null) => void
  /** 失败提示（Board 传 setActionError） */
  setActionError: (message: string) => void
}

export function openCreatePartitionPrompt(
  point: { x: number; y: number },
  binding: CreatePartitionBinding,
): void {
  const space = useSpacesStore.getState().getCurrentSpace()
  if (!space) return

  const deps: CreatePartitionDeps = {
    spacePath: space.folderPath,
    provider: localStorageProvider,
    store: useBoardStore.getState(),
    execute: (command) => binding.history.execute(command),
    schedule: () => binding.writer.schedule(),
    onError: binding.setActionError,
  }

  binding.setPrompt({
    title: PARTITION_CREATE_TEXT.title,
    value: '',
    placeholder: PARTITION_CREATE_TEXT.placeholder,
    onConfirm: (name) => {
      void runCreatePartition(name, point, deps)
    },
  })
}
