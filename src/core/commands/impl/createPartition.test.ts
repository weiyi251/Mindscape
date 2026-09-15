// ============================================================================
// 模块说明（中文）
// 「新建分区」命令（createPartition）的单元测试（2026-09-14 用户要求）。
//
// 覆盖：do 建目录 + 追加框；undo 回收空目录 + 移除框；
//      目录非空时保留目录并提示（绝不递归删用户文件）；
//      redo（create_dir 幂等）与 History 往返；do 失败不留状态。
// ============================================================================

import { describe, expect, it, vi } from 'vitest'

import { History } from '@/core/commands/history'
import type { StorageProvider } from '@/core/storage/StorageProvider'
import type { Partition } from '@/core/types'

import { createCreatePartitionCommand } from './createPartition'

const PARTITION: Partition = {
  id: 'p_001',
  name: '旅行',
  folderPath: '旅行',
  x: 100,
  y: 100,
  w: 360,
  h: 260,
  color: '#5A7D6A',
  collapsed: false,
  meta: {},
}

/** 假 provider：只记调用顺序，目录内容可控 */
function setup(options: { children?: string[]; failCreate?: boolean } = {}) {
  const calls: string[] = []
  const children = [...(options.children ?? [])]

  const provider = {
    async createDir(path: string) {
      calls.push(`createDir:${path}`)
      if (options.failCreate) throw new Error('创建失败：没有权限')
    },
    async dirExists(path: string) {
      calls.push(`dirExists:${path}`)
      return true
    },
    async listDir(path: string) {
      calls.push(`listDir:${path}`)
      return children.map((name) => ({ name, path: `${path}\\${name}`, isDir: false, size: 0, modifiedAt: null }))
    },
    async deleteDir(path: string) {
      calls.push(`deleteDir:${path}`)
    },
  } as unknown as StorageProvider

  const stored: Partition[] = []
  const removedIds: string[] = []
  const notices: string[] = []

  const command = createCreatePartitionCommand(PARTITION, {
    spacePath: 'D:\\空间',
    provider,
    applyAdd: (partition) => stored.push(partition),
    applyRemove: (ids) => removedIds.push(...ids),
    onNotice: (message) => notices.push(message),
  })

  return { command, calls, stored, removedIds, notices }
}

describe('createCreatePartitionCommand', () => {
  it('do：先在空间文件夹下建同名目录，再把分区框追加到画布', async () => {
    const { command, calls, stored } = setup()

    await command.do()

    expect(calls).toEqual(['createDir:D:\\空间\\旅行'])
    expect(stored).toEqual([PARTITION])
  })

  it('undo：目录为空 → 回收目录 + 移除分区框', async () => {
    const { command, calls, removedIds, notices } = setup()

    await command.do()
    await command.undo()

    expect(calls).toEqual([
      'createDir:D:\\空间\\旅行',
      'dirExists:D:\\空间\\旅行',
      'listDir:D:\\空间\\旅行',
      'deleteDir:D:\\空间\\旅行',
    ])
    expect(removedIds).toEqual(['p_001'])
    expect(notices).toEqual([])
  })

  it('undo：目录非空 → 保留目录（绝不递归删用户文件）并如实提示', async () => {
    const { command, calls, removedIds, notices } = setup({ children: ['a.jpg'] })

    await command.do()
    await command.undo()

    expect(calls).not.toContain('deleteDir:D:\\空间\\旅行')
    expect(removedIds).toEqual(['p_001'])
    expect(notices).toEqual(['分区「旅行」的文件夹里还有内容，已保留该文件夹（未递归删除）'])
  })

  it('undo：目录已不存在（用户手动删了）→ 跳过回收，不抛错', async () => {
    const calls: string[] = []
    const provider = {
      async createDir() {
        calls.push('createDir')
      },
      async dirExists() {
        calls.push('dirExists')
        return false
      },
      async deleteDir() {
        calls.push('deleteDir')
      },
    } as unknown as StorageProvider
    const removedIds: string[] = []
    const command = createCreatePartitionCommand(PARTITION, {
      spacePath: 'D:\\空间',
      provider,
      applyAdd: () => {},
      applyRemove: (ids) => removedIds.push(...ids),
    })

    await command.undo()

    expect(calls).toEqual(['dirExists'])
    expect(removedIds).toEqual(['p_001'])
  })

  it('do 抛错：状态零写入（History 据此保持指针不动、不入栈）', async () => {
    const { command, stored } = setup({ failCreate: true })

    await expect(command.do()).rejects.toThrow('没有权限')
    expect(stored).toEqual([])
  })

  it('History 往返：execute → undo → redo，目录与画布同步往返且不重复建框', async () => {
    const { command, calls, stored, removedIds } = setup()
    const history = new History()

    await history.execute(command)
    await history.undo()
    await history.redo()

    expect(calls).toEqual([
      'createDir:D:\\空间\\旅行',
      'dirExists:D:\\空间\\旅行',
      'listDir:D:\\空间\\旅行',
      'deleteDir:D:\\空间\\旅行',
      'createDir:D:\\空间\\旅行',
    ])
    // 追加一次、移除一次、redo 再追加一次（create_dir 幂等，不报「已存在」）
    expect(removedIds).toEqual(['p_001'])
    expect(stored).toHaveLength(2)
  })

  it('onNotice 可缺省（可选回调），目录非空时不抛错', async () => {
    const provider = {
      async createDir() {},
      async dirExists() {
        return true
      },
      async listDir() {
        return [{ name: 'x.jpg', path: 'x', isDir: false, size: 1, modifiedAt: null }]
      },
      async deleteDir() {
        throw new Error('不该被调用')
      },
    } as unknown as StorageProvider
    const applyRemove = vi.fn()
    const command = createCreatePartitionCommand(PARTITION, {
      spacePath: 'D:\\空间',
      provider,
      applyAdd: () => {},
      applyRemove,
    })

    await expect(command.undo()).resolves.toBeUndefined()
    expect(applyRemove).toHaveBeenCalledWith(['p_001'])
  })
})
