// ============================================================================
// 模块说明（中文）
// 「一键补分区框」编排层（generatePartitionsFlow）的单元测试（A2，2026-09-20）。
//
// 覆盖：无待补项零动作、只读拦截、正常补框（几何 + 命令 + 清空提示 + 落盘）、
//      命令失败时不清提示也不落盘。
// ============================================================================

import { describe, expect, it, vi } from 'vitest'

import type { Card, Partition } from '@/core/types'
import { zCardSchema } from '@/core/types'
import type { Command } from '@/core/commands/types'

import { GENERATE_PARTITIONS_TEXT, runGeneratePartitions } from './generatePartitionsFlow'
import type { GeneratePartitionsStore } from './generatePartitionsFlow'

function card(over: Record<string, unknown> = {}): Card {
  return zCardSchema.parse({
    id: 'c_001',
    type: 'image',
    filePath: 'a.jpg',
    originalPath: 'a.jpg',
    x: 0,
    y: 0,
    w: 220,
    h: 160,
    ...over,
  })
}

function partition(over: Partial<Partition> = {}): Partition {
  return {
    id: 'p_001',
    name: '已建框',
    folderPath: '已建框',
    x: 0,
    y: 0,
    w: 300,
    h: 200,
    color: '#5A7D6A',
    collapsed: false,
    meta: {},
    ...over,
  }
}

interface Harness {
  store: GeneratePartitionsStore
  added: Partition[]
  removed: string[]
  cleared: string[][]
}

function makeStore(over: Partial<GeneratePartitionsStore> = {}): Harness {
  const added: Partition[] = []
  const removed: string[] = []
  const cleared: string[][] = []

  const store: GeneratePartitionsStore = {
    readOnly: false,
    cards: [],
    partitions: [],
    unframedFolders: [],
    addPartitions: (items) => added.push(...items),
    removePartitions: (ids) => removed.push(...ids),
    setUnframedFolders: (names) => cleared.push(names),
    ...over,
  }

  return { store, added, removed, cleared }
}

function deps(harness: Harness) {
  // 模拟 History.execute：真正调用 command.do()，否则画布侧的状态写入不会被触发
  const execute = vi.fn(async (command: Command) => {
    await command.do()
  })
  const schedule = vi.fn()
  const onError = vi.fn()
  return { execute, schedule, onError, args: { store: harness.store, execute, schedule, onError } }
}

describe('runGeneratePartitions', () => {
  it('没有待补框的文件夹：零动作、零提示', async () => {
    const harness = makeStore()
    const { execute, schedule, onError, args } = deps(harness)

    await expect(runGeneratePartitions(args)).resolves.toBe(0)

    expect(execute).not.toHaveBeenCalled()
    expect(schedule).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('只读模式：拒绝写入并给出中文原因', async () => {
    const harness = makeStore({ readOnly: true, unframedFolders: ['空文件夹'] })
    const { execute, args, onError } = deps(harness)

    await expect(runGeneratePartitions(args)).resolves.toBe(0)

    expect(execute).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(GENERATE_PARTITIONS_TEXT.readOnly)
  })

  it('正常补框：空文件夹用默认尺寸排在既有内容下方，命令入栈 + 清提示 + 请求落盘', async () => {
    const harness = makeStore({
      unframedFolders: ['空文件夹'],
      cards: [card({ x: 0, y: 0, w: 220, h: 160 })],
      partitions: [partition({ x: 0, y: 0, w: 300, h: 200 })],
    })
    const { execute, schedule, onError, args } = deps(harness)

    await expect(runGeneratePartitions(args)).resolves.toBe(1)

    expect(execute).toHaveBeenCalledTimes(1)
    expect(harness.added).toHaveLength(1)
    expect(harness.added[0].name).toBe('空文件夹')
    expect(harness.added[0].folderPath).toBe('空文件夹')
    expect(harness.added[0].y).toBe(200 + 40) // 既有元素下缘 200 + 间距 40
    expect(harness.cleared).toEqual([[]])
    expect(schedule).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('多个待补文件夹：一次命令全部写入（不逐条入栈，撤销一次全撤）', async () => {
    const harness = makeStore({ unframedFolders: ['甲', '乙'] })
    const { execute, args } = deps(harness)

    await expect(runGeneratePartitions(args)).resolves.toBe(2)

    expect(execute).toHaveBeenCalledTimes(1)
    expect(harness.added.map((item) => item.name)).toEqual(['甲', '乙'])
  })

  it('命令失败：报错、保留提示、不落盘（用户可重试）', async () => {
    const harness = makeStore({ unframedFolders: ['空文件夹'] })
    const { execute, schedule, onError, args } = deps(harness)
    execute.mockRejectedValueOnce(new Error('磁盘只读'))

    await expect(runGeneratePartitions(args)).resolves.toBe(0)

    expect(onError).toHaveBeenCalledWith(GENERATE_PARTITIONS_TEXT.failed('磁盘只读'))
    expect(harness.cleared).toEqual([])
    expect(schedule).not.toHaveBeenCalled()
  })
})
