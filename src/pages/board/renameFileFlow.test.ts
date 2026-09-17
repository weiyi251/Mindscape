// ============================================================================
// 模块说明（中文）
// renameFileFlow.ts 的单元测试：校验分支（只读 / 空名 / 非法字符 / 同名冲突 /
// 与旧名相同）与「确认 → 命令 → 落盘」链路。
// ============================================================================

import { describe, expect, it, vi } from 'vitest'

import { RENAME_FILE_TEXT, runRenameCardFile } from './renameFileFlow'
import type { RenameCardFileDeps } from './renameFileFlow'
import type { CardFileRefUpdate } from '@/core/commands/impl/moveCardToFolder'
import type { Command } from '@/core/commands/types'
import type { StorageProvider, DirEntry } from '@/core/storage/StorageProvider'
import { zCardSchema } from '@/core/types'
import type { Card } from '@/core/types'

function makeImageCard(filePath: string): Card {
  return zCardSchema.parse({
    id: 'c1',
    type: 'image',
    filePath,
    originalPath: filePath,
    x: 0,
    y: 0,
    w: 220,
    h: 220,
  })
}

function entry(name: string): DirEntry {
  return { name, path: `D:/space/${name}`, isDir: false, size: 1, modifiedAt: null }
}

function makeDeps(overrides: Partial<RenameCardFileDeps> = {}): RenameCardFileDeps & {
  executed: Command[]
  scheduled: number
  errors: string[]
  fileRefCalls: { card: Card; updates: CardFileRefUpdate[] }[]
} {
  const executed: Command[] = []
  let scheduled = 0
  const errors: string[] = []
  const fileRefCalls: { card: Card; updates: CardFileRefUpdate[] }[] = []
  return {
    spacePath: 'D:\\space',
    provider: {
      listDir: vi.fn(async () => [entry('旧图.jpg'), entry('别的.png')]),
      moveFile: vi.fn(async (_src: string, dest: string) => dest),
    } as unknown as StorageProvider,
    readOnly: false,
    execute: vi.fn(async (command: Command) => {
      executed.push(command)
    }),
    schedule: vi.fn(() => {
      scheduled += 1
    }),
    onError: vi.fn((message: string) => {
      errors.push(message)
    }),
    applyFileRefs: vi.fn((card: Card, updates: CardFileRefUpdate[]) => {
      fileRefCalls.push({ card, updates })
    }),
    ...overrides,
    get executed() {
      return executed
    },
    get scheduled() {
      return scheduled
    },
    get errors() {
      return errors
    },
    get fileRefCalls() {
      return fileRefCalls
    },
  } as RenameCardFileDeps & {
    executed: Command[]
    scheduled: number
    errors: string[]
    fileRefCalls: { card: Card; updates: CardFileRefUpdate[] }[]
  }
}

describe('runRenameCardFile', () => {
  it('只读模式拒绝', async () => {
    const deps = makeDeps({ readOnly: true })
    const ok = await runRenameCardFile(makeImageCard('旧图.jpg'), '新图.jpg', deps)
    expect(ok).toBe(false)
    expect(deps.errors).toEqual([RENAME_FILE_TEXT.readOnly])
    expect(deps.execute).not.toHaveBeenCalled()
  })

  it('空名 / 非法字符拒绝', async () => {
    const deps = makeDeps()
    expect(await runRenameCardFile(makeImageCard('旧图.jpg'), '   ', deps)).toBe(false)
    expect(deps.errors).toEqual([RENAME_FILE_TEXT.empty])
    expect(await runRenameCardFile(makeImageCard('旧图.jpg'), 'a/b.jpg', deps)).toBe(false)
    expect(deps.errors.at(-1)).toBe(RENAME_FILE_TEXT.invalid)
    expect(deps.execute).not.toHaveBeenCalled()
  })

  it('与旧名相同：静默 no-op（成功且不执行命令）', async () => {
    const deps = makeDeps()
    const ok = await runRenameCardFile(makeImageCard('旧图.jpg'), ' 旧图.jpg ', deps)
    expect(ok).toBe(true)
    expect(deps.execute).not.toHaveBeenCalled()
    expect(deps.scheduled).toBe(0)
  })

  it('同目录同名冲突拒绝（大小写不敏感；排除旧名自身支持纯大小写改名）', async () => {
    const deps = makeDeps()
    expect(await runRenameCardFile(makeImageCard('旧图.jpg'), '别的.png', deps)).toBe(false)
    expect(deps.errors).toEqual([RENAME_FILE_TEXT.duplicate('别的.png')])

    const ok = await runRenameCardFile(makeImageCard('旧图.jpg'), '旧图.JPG', deps)
    expect(ok).toBe(true)
    expect(deps.execute).toHaveBeenCalledTimes(1)
  })

  it('合法改名：执行可撤销命令并落盘，undo 还原旧相对路径', async () => {
    const card = makeImageCard('旧图.jpg')
    const deps = makeDeps()
    const ok = await runRenameCardFile(card, '新图.jpg', deps)
    expect(ok).toBe(true)
    expect(deps.executed).toHaveLength(1)
    expect(deps.scheduled).toBe(1)

    await deps.executed[0].do()
    expect(deps.fileRefCalls[0].updates).toEqual([
      { id: 'c1', filePath: '新图.jpg', originalPath: '新图.jpg', group: card.group },
    ])
    await deps.executed[0].undo()
    expect(deps.fileRefCalls.at(-1)?.updates).toEqual([
      { id: 'c1', filePath: card.filePath, originalPath: card.originalPath, group: card.group },
    ])
  })

  it('子目录文件：查重用绝对父目录，命令保持目录不变', async () => {
    const deps = makeDeps()
    await runRenameCardFile(makeImageCard('参考资料/旧图.jpg'), '新图.jpg', deps)
    expect(vi.mocked(deps.provider.listDir).mock.calls[0][0]).toBe('D:\\space\\参考资料')
    expect(deps.executed).toHaveLength(1)
  })
})
