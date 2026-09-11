// ============================================================================
// 模块说明（中文）
// 布局落盘调度器。对应 17.6「数据持久化策略」：
//
//   · 写盘时机：**内存态为准，防抖 500ms** 落盘
//   · 强制立即落盘：窗口关闭前 / 切换空间前 / 手动 Ctrl+S
//   · 原子写入由 Rust 侧 write_layout 保证（先 .tmp 再 rename），本层只负责"什么时候写"
//
// 为什么需要这一层：视口每帧都在变，若每次变化都写盘，磁盘会被打爆
// （WebView2 下 60fps × 一个小 JSON 也足够让磁盘队列拥堵）。防抖把一串连续变化
// 收敛成一次写盘。
//
// 【串行化】写盘是异步的，且可能比防抖间隔更慢（网络盘 / 机械盘）。
// 这里用一条 Promise 链把所有写操作排队，避免两次写入交叉导致文件内容错乱。
//
// 【内容去重】与上一次成功写入的内容完全一致时跳过写盘 —— Ctrl+S 无改动、
// 或只是来回切视图时不会产生无意义的磁盘写入。
//
// 时间源（setTimer / clearTimer）可注入，便于单元测试。
//
// 实现任务：T1.6（阶段一）。
// ============================================================================

import type { Layout } from '@/core/types'

/** 防抖间隔（17.6：防抖 500ms） */
export const LAYOUT_DEBOUNCE_MS = 500

export type TimerScheduler = (fn: () => void, ms: number) => number
export type TimerClearer = (id: number) => void

const defaultSetTimer: TimerScheduler = (fn, ms) => setTimeout(fn, ms) as unknown as number
const defaultClearTimer: TimerClearer = (id) => clearTimeout(id)

/**
 * Layout → 待写入的 JSON 文本。
 * 缩进 2 空格：layout.json 可能被用户直接打开看，可读性优先于体积
 * （单空间 ≤100 张卡片时文件也就几十 KB）。
 */
export function serializeLayout(layout: Layout): string {
  return JSON.stringify(layout, null, 2)
}

export interface LayoutWriterOptions {
  /** 取当前内存态快照；返回 null 表示当前不该写盘（例如尚未进入空间） */
  build: () => Layout | null
  /** 实际写盘（由 StorageProvider.writeLayout 提供） */
  write: (json: string) => Promise<void>
  /** 防抖间隔，默认 LAYOUT_DEBOUNCE_MS */
  delayMs?: number
  setTimer?: TimerScheduler
  clearTimer?: TimerClearer
  /** 写盘失败：收到可展示的中文消息 */
  onError?: (message: string) => void
  /** 写盘成功 */
  onSuccess?: () => void
}

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  return String(error)
}

export class LayoutWriter {
  private readonly options: LayoutWriterOptions
  private readonly delayMs: number
  private readonly setTimer: TimerScheduler
  private readonly clearTimer: TimerClearer

  private timer: number | null = null
  private queue: Promise<void> = Promise.resolve()
  private lastWritten: string | null = null
  private disposed = false

  constructor(options: LayoutWriterOptions) {
    this.options = options
    this.delayMs = options.delayMs ?? LAYOUT_DEBOUNCE_MS
    this.setTimer = options.setTimer ?? defaultSetTimer
    this.clearTimer = options.clearTimer ?? defaultClearTimer
  }

  /** 是否有等待落盘的改动 */
  get hasPending(): boolean {
    return this.timer !== null
  }

  /** 标记「有改动」：防抖 delayMs 后落盘。重复调用只重置计时器 */
  schedule(): void {
    if (this.disposed) return
    if (this.timer !== null) this.clearTimer(this.timer)
    this.timer = this.setTimer(() => {
      this.timer = null
      void this.flush()
    }, this.delayMs)
  }

  /**
   * 立即落盘（窗口关闭前 / 切换空间前 / Ctrl+S）。
   * 返回的 Promise 在本次及此前排队的写入全部完成后 resolve。
   */
  flush(): Promise<void> {
    if (this.disposed) return this.queue
    this.cancelTimer()

    const layout = this.options.build()
    if (!layout) return this.queue

    const json = serializeLayout(layout)
    if (json === this.lastWritten) return this.queue // 内容没变，省一次磁盘写入

    this.lastWritten = json
    this.queue = this.queue
      .then(() => this.options.write(json))
      .then(() => {
        this.options.onSuccess?.()
      })
      .catch((error: unknown) => {
        // 写失败 → 清掉去重记录，让下一次改动能重试
        this.lastWritten = null
        this.options.onError?.(errorMessage(error))
      })

    return this.queue
  }

  /**
   * 丢弃待落盘的防抖计时器（不写盘）。
   * ⚠️ 离开空间时应先 flush 再 cancel，否则最后一次改动会丢。
   */
  cancel(): void {
    this.cancelTimer()
  }

  /** 停止使用（组件卸载）：取消待落盘并等待进行中的写入结束 */
  async dispose(): Promise<void> {
    this.cancelTimer()
    this.disposed = true
    await this.queue
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer)
      this.timer = null
    }
  }
}
