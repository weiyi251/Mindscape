// ============================================================================
// 模块说明（中文）
// 更新检查的状态容器。放在 Zustand 而非组件内 useState，原因与 spacesStore 类似：
// 「启动时静默检查」发生在 App 层，而「手动检查入口」在空间列表页、提示弹窗又在
// 另一处，三者共享同一份状态，拆成 props 传递会污染 SpaceList 的接口。
//
// 注意：这里保存的 Update 实例来自 Tauri 插件，是不可序列化对象，只用于本次会话内
// 的下载安装，绝不落盘。
// ============================================================================

import { create } from 'zustand'
import type { Update } from '@tauri-apps/plugin-updater'

import {
  checkForUpdate,
  downloadAndInstall,
  restartApp,
  type UpdateProgress,
} from '@/core/updater/updater'

/**
 * 更新流程状态机：
 *   idle → checking → up-to-date | available | error | unsupported
 *   available → downloading → ready（等待重启）
 */
export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error'
  | 'unsupported'

interface UpdaterState {
  status: UpdateStatus
  version: string
  notes: string
  errorMessage: string
  progress: UpdateProgress | null
  /** 弹窗是否可见。启动检查为静默模式时，「已是最新」不会打开它。 */
  dialogOpen: boolean
}

interface UpdaterActions {
  /** 检查更新。silent=true 时「已是最新 / 出错」都不弹窗，仅「发现新版本」才提示 */
  check: (options?: { silent?: boolean }) => Promise<void>
  /** 下载并安装当前发现的更新 */
  install: () => Promise<void>
  /** 重启应用使更新生效 */
  restart: () => Promise<void>
  /** 关闭提示弹窗 */
  dismiss: () => void
  /**
   * 打开弹窗（手动入口用）。
   * 已发现更新 / 正在下载 / 待重启 / 检查中 → 直接开窗展示当前状态；
   * 其余情况重新发起一次非静默检查（这样「已是最新」「失败」都会明确告诉用户）。
   */
  open: () => void
}

const INITIAL: UpdaterState = {
  status: 'idle',
  version: '',
  notes: '',
  errorMessage: '',
  progress: null,
  dialogOpen: false,
}

/** Update 实例单独存放，避免混进响应式 state 被当作数据渲染 */
let pendingUpdate: Update | null = null

export const useUpdaterStore = create<UpdaterState & UpdaterActions>((set, get) => ({
  ...INITIAL,

  async check(options) {
    const silent = options?.silent ?? false
    set({ status: 'checking', errorMessage: '', progress: null })

    const result = await checkForUpdate()

    if (result.kind === 'available') {
      pendingUpdate = result.update
      set({
        status: 'available',
        version: result.version,
        notes: result.notes,
        dialogOpen: true,
      })
      return
    }

    if (result.kind === 'unsupported') {
      set({ status: 'unsupported', dialogOpen: !silent })
      return
    }

    if (result.kind === 'error') {
      set({ status: 'error', errorMessage: result.message, dialogOpen: !silent })
      return
    }

    // up-to-date：静默检查时不做任何打扰
    set({ status: 'up-to-date', dialogOpen: !silent })
  },

  async install() {
    const update = pendingUpdate
    if (!update) return

    set({ status: 'downloading', progress: { downloaded: 0, total: null } })

    try {
      await downloadAndInstall(update, (progress) => set({ progress }))
      // Windows 上安装阶段会由安装器结束进程，通常到不了这里；能到则说明已装好待重启
      set({ status: 'ready' })
    } catch (error) {
      set({
        status: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
      })
    }
  },

  async restart() {
    await restartApp()
  },

  dismiss() {
    set({ dialogOpen: false })
  },

  open() {
    const status = get().status
    // 已有结果或正在进行 → 直接开窗，不重复请求：
    //   available / downloading / ready：重复检查会把已发现的更新与下载进度丢掉
    //   checking：避免并发两个检查请求
    if (
      status === 'available' ||
      status === 'downloading' ||
      status === 'ready' ||
      status === 'checking'
    ) {
      set({ dialogOpen: true })
      return
    }
    // idle / up-to-date / error / unsupported：用户主动点，应重新查一次拿最新结果
    // （启动时已静默查过「已是最新」，但距离用户点击可能已经过了很久）
    void get().check({ silent: false })
  },
}))

/** 仅供测试使用：清空状态与挂起的 Update 引用 */
export function resetUpdaterStoreForTest() {
  pendingUpdate = null
  useUpdaterStore.setState({ ...INITIAL })
}
