// ============================================================================
// 模块说明（中文）
// 「新建分区」编排层（createPartitionFlow）的单元测试（2026-09-14 用户要求）。
//
// 依赖全部注入，node 环境直接跑：只读拦截 / 名称校验 / 硬盘查重 /
// 成功路径（建目录 + 追加框 + 落盘 + 选中）/ 失败提示。
// ============================================================================

import { describe, expect, it, vi } from 'vitest'

import type { Command } from '@/core/commands/types'
import type { StorageProvider } from '@/core/storage/StorageProvider'
import type { Partition } from '@/core/types'

import { PARTITION_CREATE_TEXT, openCreatePartitionPrompt, runCreatePartition } from './createPartitionFlow'
import type { PartitionCreationStore } from './createPartitionFlow'

function partition(partial: Partial<Partition> = {}): Partition {
  return {
    id: 'p_001',
    name: '参考资料',
    folderPath: '参考资料',
    x: 0,
    y: 0,
    w: 200,
    h: 200,
    color: '#5A7D6A',
    collapsed: false,
    meta: {},
    ...partial,
  }
}

function setup(options: { partitions?: Partition[]; readOnly?: boolean; existsOnDisk?: boolean; failExists?: boolean } = {}) {
  const calls: string[] = []
  const provider = {
    async dirExists(path: string) {
      calls.push(`dirExists:${path}`)
      if (options.failExists) throw new Error('读取失败：没有权限')
      return options.existsOnDisk ?? false
    },
    async createDir(path: string) {
      calls.push(`createDir:${path}`)
    },
    async listDir() {
      return []
    },
    async deleteDir(path: string) {
      calls.push(`deleteDir:${path}`)
    },
  } as unknown as StorageProvider

  const partitions = [...(options.partitions ?? [])]
  const errors: string[] = []
  const store: PartitionCreationStore = {
    readOnly: options.readOnly ?? false,
    partitions,
    addPartition: (created) => partitions.push(created),
    removePartitions: (ids) => {
      for (const id of ids) {
        const index = partitions.findIndex((item) => item.id === id)
        if (index >= 0) partitions.splice(index, 1)
      }
    },
    selectPartition: vi.fn(),
  }
  const schedule = vi.fn()

  const deps = {
    spacePath: 'D:\\空间',
    provider,
    store,
    execute: async (command: Command) => {
      calls.push(`execute:${command.type}`)
      await command.do()
    },
    schedule,
    onError: (message: string) => errors.push(message),
  }

  return { deps, calls, partitions, errors, store, schedule, provider }
}

describe('runCreatePartition', () => {
  it('只读模式：直接拒绝，不碰硬盘、不建框', async () => {
    const { deps, calls, errors, partitions } = setup({ readOnly: true })

    await expect(runCreatePartition('旅行', { x: 0, y: 0 }, deps)).resolves.toBe(false)

    expect(errors).toEqual([PARTITION_CREATE_TEXT.readOnly])
    expect(calls).toEqual([])
    expect(partitions).toEqual([])
  })

  it('名称为空 / 非法 / 保留名 / 画布同名：给出对应中文提示且不落盘', async () => {
    const { deps, calls, errors } = setup({ partitions: [partition()] })

    await runCreatePartition('   ', { x: 0, y: 0 }, deps)
    await runCreatePartition('a/b', { x: 0, y: 0 }, deps)
    await runCreatePartition('_已移除', { x: 0, y: 0 }, deps)
    await runCreatePartition('参考资料', { x: 0, y: 0 }, deps)

    expect(errors).toEqual([
      PARTITION_CREATE_TEXT.empty,
      PARTITION_CREATE_TEXT.invalid,
      PARTITION_CREATE_TEXT.reserved,
      PARTITION_CREATE_TEXT.duplicate,
    ])
    // 校验在硬盘检测之前完成，一次 IO 都没发生
    expect(calls).toEqual([])
  })

  it('硬盘上已有同名文件夹：拒绝（避免两个分区指向同一文件夹）', async () => {
    const { deps, calls, errors, partitions } = setup({ existsOnDisk: true })

    await expect(runCreatePartition('旅行', { x: 0, y: 0 }, deps)).resolves.toBe(false)

    expect(errors).toEqual([PARTITION_CREATE_TEXT.existsOnDisk('旅行')])
    expect(calls).toEqual(['dirExists:D:\\空间\\旅行'])
    expect(partitions).toEqual([])
  })

  it('成功：建目录 + 以点击点为中心建框 + 落盘 + 选中新分区', async () => {
    const { deps, calls, partitions, errors, store, schedule } = setup()

    await expect(runCreatePartition('  旅行  ', { x: 500, y: 300 }, deps)).resolves.toBe(true)

    expect(calls).toEqual(['dirExists:D:\\空间\\旅行', 'execute:createPartition', 'createDir:D:\\空间\\旅行'])
    expect(errors).toEqual([])
    expect(partitions).toHaveLength(1)
    expect(partitions[0].name).toBe('旅行') // 前后空格被 trim
    expect(partitions[0].folderPath).toBe('旅行')
    expect(partitions[0].x).toBe(500 - partitions[0].w / 2)
    expect(schedule).toHaveBeenCalledTimes(1)
    expect(store.selectPartition).toHaveBeenCalledWith(partitions[0].id)
  })

  it('文件夹已存在同名分区时取号不撞：id 接着现有分区递增', async () => {
    const { deps, partitions } = setup({ partitions: [partition({ id: 'p_007' })] })

    await runCreatePartition('旅行', { x: 0, y: 0 }, deps)

    expect(partitions.map((item) => item.id)).toEqual(['p_007', 'p_008'])
  })

  it('硬盘检测抛错：报「新建分区失败」且画布不动', async () => {
    const { deps, errors, partitions, schedule } = setup({ failExists: true })

    await expect(runCreatePartition('旅行', { x: 0, y: 0 }, deps)).resolves.toBe(false)

    expect(errors).toEqual([PARTITION_CREATE_TEXT.failed('读取失败：没有权限')])
    expect(partitions).toEqual([])
    expect(schedule).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Board 侧接线入口（openCreatePartitionPrompt）
// ---------------------------------------------------------------------------

describe('openCreatePartitionPrompt', () => {
  it('未进入任何空间时不提浮层（避免对着空画布建目录）', () => {
    const setPrompt = vi.fn()
    const setActionError = vi.fn()

    openCreatePartitionPrompt(
      { x: 0, y: 0 },
      {
        history: { execute: vi.fn() },
        writer: { schedule: vi.fn() },
        setPrompt,
        setActionError,
      },
    )

    expect(setPrompt).not.toHaveBeenCalled()
    expect(setActionError).not.toHaveBeenCalled()
  })
})
