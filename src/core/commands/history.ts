// ============================================================================
// 模块说明（中文）
// 撤销 / 重做栈。对应开发计划书第 7.4 节「撤销 / 重做规格」：
//   · 保留最近 50 步（HISTORY_LIMIT），超出后丢弃最旧记录
//   · 仅本次运行期间有效 —— 历史只存内存，关闭窗口 / 退出应用即清空
//   · 覆盖范围：移动、缩放、移除、恢复、改名、连线、备注、拖入文件
//   · 撤销必须同时回滚文件操作（由各命令的 undo() 负责）
//
// 模型：entries 是「已执行过的命令」序列，index 指向当前所处的命令位置。
//   - 新命令入栈时，index 之后的记录（即重做分支）被丢弃
//   - undo() 调用 entries[index].undo() 并把 index 前移
//   - redo() 把 index 后移并调用 entries[index].do()
//   - index === -1 表示「回到最初状态」，此时不能撤销
// ============================================================================

import type { Command } from './types'

/** 撤销栈深度上限（第 7.4 节：保留最近 50 步） */
export const HISTORY_LIMIT = 50

/** 命令执行前后的快照，仅用于测试与调试观察 */
export interface HistoryState {
  /** 当前栈内命令数 */
  size: number
  /** 可撤销步数 */
  undoDepth: number
  /** 可重做步数 */
  redoDepth: number
  /** 当前所处位置（-1 表示最初状态） */
  index: number
}

export class History {
  private entries: Command[] = []
  private index = -1

  constructor(private readonly limit: number = HISTORY_LIMIT) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`撤销栈深度必须是 ≥1 的整数，收到：${limit}`)
    }
  }

  /**
   * 记录一条**已经执行过**的命令（本方法不再调用 do()）。
   *
   * 业务层通常这样用：
   *   await cmd.do(); history.push(cmd)
   * 若需要「执行 + 记录」一步到位，用 execute()。
   */
  push(command: Command): void {
    // 丢弃重做分支：新操作发生后，原来的「未来」不再可达
    if (this.index < this.entries.length - 1) {
      this.entries = this.entries.slice(0, this.index + 1)
    }

    this.entries.push(command)

    // 超出深度上限则丢弃最旧记录
    if (this.entries.length > this.limit) {
      this.entries = this.entries.slice(this.entries.length - this.limit)
    }

    this.index = this.entries.length - 1
  }

  /** 执行并记录：等价于 await command.do() + push(command) */
  async execute(command: Command): Promise<void> {
    await command.do()
    this.push(command)
  }

  canUndo(): boolean {
    return this.index >= 0
  }

  canRedo(): boolean {
    return this.index < this.entries.length - 1
  }

  /**
   * 撤销一步。命令 undo() 抛错时不推进指针，保证状态一致、可重试。
   * @returns 是否真的执行了一次撤销
   */
  async undo(): Promise<boolean> {
    if (!this.canUndo()) return false

    await this.entries[this.index].undo()
    this.index -= 1
    return true
  }

  /**
   * 重做一步。命令 do() 抛错时不推进指针。
   * @returns 是否真的执行了一次重做
   */
  async redo(): Promise<boolean> {
    if (!this.canRedo()) return false

    this.index += 1
    try {
      await this.entries[this.index].do()
    } catch (error) {
      // 回退指针，保持「index 始终指向已成功执行的那条命令」
      this.index -= 1
      throw error
    }
    return true
  }

  /** 清空历史（切换空间 / 关闭窗口时调用，对应「仅本次运行期间有效」） */
  clear(): void {
    this.entries = []
    this.index = -1
  }

  /** 只读快照，供调试面板或测试断言使用 */
  getState(): HistoryState {
    return {
      size: this.entries.length,
      undoDepth: this.index + 1,
      redoDepth: this.entries.length - 1 - this.index,
      index: this.index,
    }
  }
}
