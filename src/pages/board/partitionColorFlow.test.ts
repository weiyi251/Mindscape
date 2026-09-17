// ============================================================================
// 模块说明（中文）
// partitionColorFlow.ts 的单元测试：外抽前后的行为契约（找不到分区静默、
// 菜单项齐全、选中后命令 do/undo 的旧新值、落盘调度）。
// ============================================================================

import { describe, expect, it, vi } from 'vitest'

import { openPartitionColorMenu } from './partitionColorFlow'
import type { PartitionColorDeps } from './partitionColorFlow'
import { PARTITION_PALETTE } from '@/core/board/partitions'
import type { Command } from '@/core/commands/types'

function makeDeps(overrides: Partial<PartitionColorDeps> = {}): PartitionColorDeps & {
  executed: Command[]
  scheduled: number
} {
  const executed: Command[] = []
  let scheduled = 0
  return {
    partitions: [{ id: 'p1', color: '#5A7D6A' }],
    execute: vi.fn(async (command: Command) => {
      executed.push(command)
    }),
    schedule: vi.fn(() => {
      scheduled += 1
    }),
    showMenu: vi.fn(),
    applyColor: vi.fn(),
    ...overrides,
    get executed() {
      return executed
    },
    get scheduled() {
      return scheduled
    },
  } as PartitionColorDeps & { executed: Command[]; scheduled: number }
}

describe('openPartitionColorMenu', () => {
  it('找不到分区时静默返回（不弹菜单、不执行命令）', () => {
    const deps = makeDeps()
    openPartitionColorMenu('missing', { x: 1, y: 2 }, deps)
    expect(deps.showMenu).not.toHaveBeenCalled()
    expect(deps.execute).not.toHaveBeenCalled()
  })

  it('弹出二级菜单：首项「自动」+ 8 色板共 9 项', () => {
    const deps = makeDeps()
    openPartitionColorMenu('p1', { x: 1, y: 2 }, deps)
    expect(deps.showMenu).toHaveBeenCalledTimes(1)
    const menu = vi.mocked(deps.showMenu).mock.calls[0][0] as { x: number; y: number; items: { run: () => void }[] }
    expect(menu.x).toBe(1)
    expect(menu.y).toBe(2)
    expect(menu.items).toHaveLength(1 + PARTITION_PALETTE.length)
  })

  it('选中色板色：执行改色命令，do 写新色 / undo 还原旧色，随后请求落盘', async () => {
    const deps = makeDeps()
    openPartitionColorMenu('p1', { x: 1, y: 2 }, deps)
    const menu = vi.mocked(deps.showMenu).mock.calls[0][0] as { items: { run: () => void }[] }
    menu.items[1].run() // 第 1 号色
    await Promise.resolve()

    expect(deps.execute).toHaveBeenCalledTimes(1)
    const command = deps.executed[0]
    command.do()
    expect(deps.applyColor).toHaveBeenLastCalledWith('p1', PARTITION_PALETTE[0])
    command.undo()
    expect(deps.applyColor).toHaveBeenLastCalledWith('p1', '#5A7D6A')
    expect(deps.scheduled).toBe(1)
  })

  it('选中「自动」：命令的新值是 auto 字符串（轮换语义在 resolvePartitionColor）', async () => {
    const deps = makeDeps()
    openPartitionColorMenu('p1', { x: 1, y: 2 }, deps)
    const menu = vi.mocked(deps.showMenu).mock.calls[0][0] as { items: { run: () => void }[] }
    menu.items[0].run()
    await Promise.resolve()

    const command = deps.executed[0]
    command.do()
    expect(deps.applyColor).toHaveBeenLastCalledWith('p1', 'auto')
  })
})
