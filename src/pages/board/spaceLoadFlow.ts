// ============================================================================
// 模块说明（中文）
// 空间加载 / 重新扫描的编排层（A1，2026-09-20 用户计划第 3 步）。
//
// 为什么单独成文件：Board.tsx 已顶到行数棘轮（2000/2000），而「进入空间」
// 那段逻辑（loadSpace → 修复后补落盘 → 插件钩子）与 A1 新增的「重新扫描 /
// 聚焦检查 / 刷新基线」三件事都需要它，整块外抽后 Board 侧只留一行调用。
//
// 四件事：
//   reloadSpace(space, deps)            —— 加载空间 + 修复过脏数据时补一次落盘
//   rescanCurrentSpace(deps)            —— 用户点「重新扫描」：清标记 → 重新加载
//   checkExternalChanges(deps)          —— 窗口重新聚焦时比对签名，写「外部变动」标记
//   refreshDirSignatureBaseline()       —— 落盘成功后刷新基线（应用自身操作也会改文件夹）
//
// 依赖注入（除三个自读 store 的入口外），因此可在 node 环境单测。
// ============================================================================

import { externalChangeOf, readDirSignature } from '@/core/storage/dirSignature'
import { useBoardStore } from '@/core/store/boardStore'
import { useSpacesStore } from '@/core/store/spacesStore'
import type { Space } from '@/core/types'

/** 用户可见文案常量表（集中一处便于校对） */
export const SPACE_LOAD_TEXT = {
  /** 手动重新扫描失败（自动检查失败不打扰用户） */
  rescanFailed: (message: string) => `重新扫描失败：${message}`,
} as const

/**
 * 「窗口重新聚焦」检查的最小间隔（毫秒）。
 *
 * 属于编排节奏而非文案，因此放在本文件（组件文件只导出组件，满足
 * react-refresh/only-export-components）。连续来回切窗口时不必每次都读盘。
 */
export const EXTERNAL_CHECK_THROTTLE_MS = 2000

export interface SpaceLoadDeps {
  /** 落盘调度（Board 传 LayoutWriter 实例） */
  writer: { flush: () => Promise<void> | void }
  /** 失败提示（中文，可直接展示）；可选 */
  onError?: (message: string) => void
}

/**
 * 加载指定空间（进入空间 / 重新扫描共用）。
 *
 * ⚠️ 本函数**不**上报 `spaceOpened` 钩子：重新扫描会再次调用它，
 *    而「插件钩子成对出现（spaceOpened / spaceClosed）」的语义不能被打破。
 *    进入空间的首帧由 Board 在返回的 Promise 之后自行上报。
 */
export async function reloadSpace(space: Space, deps: SpaceLoadDeps): Promise<void> {
  await useBoardStore.getState().loadSpace(space)
  try {
    // 本次加载修复过历史脏数据（id 撞号去重 / 脏 originalPath 回填 /
    // A1 新记入的「已移除」条目）→ 立刻落盘一次。不落盘的话修复只停在内存：
    // 用户随后的操作一旦抛错（命令不入栈、不写盘），磁盘上的坏数据会一直保留。
    if (useBoardStore.getState().needsMigration) await deps.writer.flush()
  } catch (error) {
    deps.onError?.(error instanceof Error ? error.message : String(error))
  }
}

/**
 * 用户主动「重新扫描」：先清掉变动标记，再重新加载当前空间。
 *
 * 重新加载即重新读一遍 layout 与文件夹（`layoutMerge` 负责「layout 位置优先、
 * 新文件接在下方、无文件卡原样保留」），因此磁盘现状会被如实拉回画布；
 * 期间消失的文件由 store 记入「已移除」（见 boardStore.loadSpace 第 6.9 步）。
 *
 * @returns 是否真的执行了重扫（没有当前空间时为 false）
 */
export async function rescanCurrentSpace(deps: SpaceLoadDeps): Promise<boolean> {
  const space = useSpacesStore.getState().getCurrentSpace()
  if (!space) return false

  useBoardStore.getState().setExternalChange(null)

  // 先落盘再重扫：重新加载会用 layout 覆盖内存态，未落盘的改动必须先写下去
  // （失败不阻止重扫 —— reloadSpace 内部那次 flush 会把错误经 onError 报出来）
  try {
    await deps.writer.flush()
  } catch {
    // 忽略：下面的 reloadSpace 会带着「脏数据修复」再 flush 一次并如实报错
  }

  try {
    await reloadSpace(space, deps)
    return true
  } catch (error) {
    deps.onError?.(
      SPACE_LOAD_TEXT.rescanFailed(error instanceof Error ? error.message : String(error)),
    )
    return false
  }
}

/**
 * 刷新签名基线。调用时机：每次布局**落盘成功后**。
 *
 * 为什么不能只在 loadSpace 时写一次：应用自己的操作（拖入文件、移除卡片、
 * 重命名、新建分区目录）同样会改变文件夹内容 —— 不刷新基线，下次窗口聚焦
 * 就会把自家操作误报成「外部变动」。
 */
export async function refreshDirSignatureBaseline(): Promise<void> {
  const store = useBoardStore.getState()
  const space = useSpacesStore.getState().getCurrentSpace()
  if (!space || store.status !== 'ready') return

  try {
    store.setDirSignature(await readDirSignature(space.folderPath))
  } catch {
    // 读不到就保持 null：比对会被跳过，宁可漏报也不误报
    store.setDirSignature(null)
  }
}

/**
 * 比对一次文件夹签名，把「外部变动」写进 store。
 *
 * 失败时**静默**（自动检查是后台行为，用户没主动要求）：路径被删 / 改名这类
 * 情况在用户下次操作时自然会有更明确的中文提示。
 *
 * @returns 是否检测到变动
 */
export async function checkExternalChanges(): Promise<boolean> {
  const store = useBoardStore.getState()
  const space = useSpacesStore.getState().getCurrentSpace()
  if (!space || store.status !== 'ready' || store.readOnly) return false

  try {
    const current = await readDirSignature(space.folderPath)
    // 基线取最新值（刷新基线可能是并发的，避免用旧快照比对）
    const change = externalChangeOf(useBoardStore.getState().dirSignature, current)
    useBoardStore.getState().setExternalChange(change)
    return change !== null
  } catch {
    return false
  }
}
