// ============================================================================
// 模块说明（中文）
// 「批量补分区框」命令（addPartitions）的单元测试（A2，2026-09-20）。
//
// 覆盖：do 批量追加、undo 只撤框、空清单零调用，
//      以及本命令最重要的一条语义 —— **绝不碰硬盘**（目录是用户的，
//      撤销「补框」不能变成删文件夹）。
// ============================================================================

import { describe, expect, it, vi } from 'vitest'

import { History } from '@/core/commands/history'
import type { Partition } from '@/core/types'

import { createAddPartitionsCommand } from './addPartitions'
import type { AddPartitionsContext } from './addPartitions'

function partition(id: string, name: string): Partition {
  return {
    id,
    name,
    folderPath: name,
    x: 0,
    y: 0,
    w: 360,
    h: 260,
    color: '#5A7D6A',
    collapsed: false,
    meta: {},
  }
}

function setup(partitions: Partition[]) {
  const stored: Partition[] = []
  const removedIds: string[] = []

  // 故意把「硬盘能力」也塞进 context：命令若哪天想删目录，下面的间谍会立刻抓到
  const diskSpies = {
    createDir: vi.fn(),
    deleteDir: vi.fn(),
    dirExists: vi.fn(),
  }

  const context = {
    applyAdd: (items: Partition[]) => stored.push(...items),
    applyRemove: (ids: string[]) => removedIds.push(...ids),
    ...diskSpies,
  } as unknown as AddPartitionsContext

  return { command: createAddPartitionsCommand(partitions, context), stored, removedIds, diskSpies }
}

describe('createAddPartitionsCommand', () => {
  it('do：一次性把全部补出的分区框追加到画布（顺序保持）', async () => {
    const items = [partition('p_001', '空文件夹一'), partition('p_002', '空文件夹二')]
    const { command, stored } = setup(items)

    await command.do()

    expect(stored).toEqual(items)
  })

  it('undo：只从画布移除这些框，且绝不碰硬盘（目录是用户的）', async () => {
    const items = [partition('p_001', '空文件夹一'), partition('p_002', '空文件夹二')]
    const { command, removedIds, diskSpies } = setup(items)

    await command.do()
    await command.undo()

    expect(removedIds).toEqual(['p_001', 'p_002'])
    expect(diskSpies.deleteDir).not.toHaveBeenCalled()
    expect(diskSpies.createDir).not.toHaveBeenCalled()
    expect(diskSpies.dirExists).not.toHaveBeenCalled()
  })

  it('空清单：do / undo 都不产生调用（不生成无意义命令）', async () => {
    const { command, stored, removedIds } = setup([])

    await command.do()
    await command.undo()

    expect(stored).toEqual([])
    expect(removedIds).toEqual([])
  })

  it('History 往返：execute → undo → redo，画布框同步往返', async () => {
    const items = [partition('p_001', '空文件夹一')]
    const { command, stored, removedIds } = setup(items)
    const history = new History()

    await history.execute(command)
    await history.undo()
    await history.redo()

    expect(stored).toHaveLength(2) // 首次追加 + redo 再追加
    expect(removedIds).toEqual(['p_001'])
  })

  it('命令 type 供调试 / 将来的命令重放识别', () => {
    const { command } = setup([])
    expect(command.type).toBe('addPartitions')
  })
})
