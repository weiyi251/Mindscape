// ============================================================================
// 模块说明（中文）
// 分区框重命名（renamePartition 命令 + isValidFolderName）的单元测试（T2.6）。
// ============================================================================

import { describe, expect, it, vi } from 'vitest'

import { createRenamePartitionCommand } from './renamePartition'
import { isValidFolderName } from '@/core/board/partitions'
import type { StorageProvider } from '@/core/storage/StorageProvider'
import { History } from '@/core/commands/history'

describe('isValidFolderName', () => {
  it('正常名字通过', () => {
    expect(isValidFolderName('参考资料')).toBe(true)
    expect(isValidFolderName('我的 方案-2')).toBe(true)
  })

  it('非法字符 / 保留名 / 空名被拒绝（第六章保护措施 ①）', () => {
    for (const bad of ['a\\b', 'a/b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b']) {
      expect(isValidFolderName(bad)).toBe(false)
    }
    expect(isValidFolderName('')).toBe(false)
    expect(isValidFolderName('   ')).toBe(false)
    expect(isValidFolderName('.')).toBe(false)
    expect(isValidFolderName('..')).toBe(false)
    expect(isValidFolderName('.mindscape')).toBe(false)
  })
})

describe('createRenamePartitionCommand', () => {
  const delta = {
    partitionId: 'p_001',
    oldName: '旧名',
    newName: '新名',
    oldFolderPath: '旧名',
    newFolderPath: '新名',
  }

  function setup() {
    const renames: { from: string; to: string }[] = []
    const applies: { id: string; name: string; folderPath: string; groupFrom: string; groupTo: string }[] = []
    const provider = {
      async renameDir(oldPath: string, newName: string) {
        renames.push({ from: oldPath, to: newName })
        return `${oldPath}\\..\\${newName}`
      },
    } as unknown as StorageProvider
    const apply = vi.fn((payload: {
      id: string
      name: string
      folderPath: string
      groupFrom: string
      groupTo: string
    }) => {
      applies.push(payload)
    })
    const command = createRenamePartitionCommand(delta, {
      spacePath: 'D:\\空间',
      provider,
      apply,
    })
    return { command, renames, applies }
  }

  it('do：改硬盘名 → 状态写新名（7.4：视图与文件一起变）', async () => {
    const { command, renames, applies } = setup()

    await command.do()

    expect(renames).toEqual([{ from: 'D:\\空间\\旧名', to: '新名' }])
    expect(applies).toEqual([
      { id: 'p_001', name: '新名', folderPath: '新名', groupFrom: '旧名', groupTo: '新名' },
    ])
  })

  it('undo：硬盘名改回去 → 状态还原旧名', async () => {
    const { command, renames, applies } = setup()

    await command.do()
    await command.undo()

    expect(renames).toEqual([
      { from: 'D:\\空间\\旧名', to: '新名' },
      { from: 'D:\\空间\\新名', to: '旧名' },
    ])
    expect(applies.at(-1)).toEqual({
      id: 'p_001',
      name: '旧名',
      folderPath: '旧名',
      groupFrom: '新名',
      groupTo: '旧名',
    })
  })

  it('历史集成：execute → undo → redo，硬盘名与状态同步往返', async () => {
    const { command, renames } = setup()
    const history = new History()

    await history.execute(command)
    await history.undo()
    await history.redo()

    expect(renames).toEqual([
      { from: 'D:\\空间\\旧名', to: '新名' },
      { from: 'D:\\空间\\新名', to: '旧名' },
      { from: 'D:\\空间\\旧名', to: '新名' },
    ])
  })

  it('do 抛错（③ 占用）时不产生任何状态写入，由 History 保持指针不动', async () => {
    const applies: unknown[] = []
    const provider = {
      async renameDir() {
        throw new Error('重命名失败：文件夹被占用')
      },
    } as unknown as StorageProvider
    const command = createRenamePartitionCommand(delta, {
      spacePath: 'D:\\空间',
      provider,
      apply: (payload) => applies.push(payload),
    })

    await expect(command.do()).rejects.toThrow('文件夹被占用')
    expect(applies).toEqual([])
  })
})
