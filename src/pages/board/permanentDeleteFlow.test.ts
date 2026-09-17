// ============================================================================
// 模块说明（中文）
// permanentDeleteFlow.ts 的单元测试：记录匹配（movedTo 优先 / id 兜底）、
// 确认取消不动、真删调用、部分失败只清成功项、无目标早退。
// ============================================================================

import { describe, expect, it, vi } from 'vitest'

import { PERMANENT_DELETE_TEXT, runPermanentDelete } from './permanentDeleteFlow'
import type { PermanentDeleteDeps } from './permanentDeleteFlow'
import type { StorageProvider } from '@/core/storage/StorageProvider'
import { zCardSchema } from '@/core/types'
import type { Card, RemovedEntry } from '@/core/types'

function makeRemovedCard(id: string, movedTo: string): Card {
  return zCardSchema.parse({
    id,
    type: 'image',
    filePath: movedTo, // 灰卡的 filePath 就是 movedTo
    originalPath: movedTo,
    x: 0,
    y: 0,
    w: 220,
    h: 220,
  })
}

function makeEntry(id: string, movedTo: string, originalPath: string): RemovedEntry {
  return { id, movedTo, originalPath }
}

function makeDeps(overrides: Partial<PermanentDeleteDeps> = {}): PermanentDeleteDeps & {
  deleted: string[]
  deletedPayloads: { cardIds: string[]; entryIds: string[] }[]
  scheduled: number
  errors: string[]
} {
  const deleted: string[] = []
  const deletedPayloads: { cardIds: string[]; entryIds: string[] }[] = []
  let scheduled = 0
  const errors: string[] = []
  return {
    spacePath: 'D:\\space',
    provider: {
      deleteFile: vi.fn(async (path: string) => {
        deleted.push(path)
      }),
    } as unknown as StorageProvider,
    removedCards: [],
    removedEntries: [],
    confirm: vi.fn(async () => true),
    onError: vi.fn((message: string) => {
      errors.push(message)
    }),
    applyDelete: vi.fn((payload: { cardIds: string[]; entryIds: string[] }) => {
      deletedPayloads.push(payload)
    }),
    schedule: vi.fn(() => {
      scheduled += 1
    }),
    ...overrides,
    get deleted() {
      return deleted
    },
    get deletedPayloads() {
      return deletedPayloads
    },
    get scheduled() {
      return scheduled
    },
    get errors() {
      return errors
    },
  } as PermanentDeleteDeps & {
    deleted: string[]
    deletedPayloads: { cardIds: string[]; entryIds: string[] }[]
    scheduled: number
    errors: string[]
  }
}

describe('runPermanentDelete', () => {
  it('空 id 清单直接成功返回（不动 store）', async () => {
    const deps = makeDeps()
    expect(await runPermanentDelete([], deps)).toBe(true)
    expect(deps.confirm).not.toHaveBeenCalled()
    expect(deps.deletedPayloads).toHaveLength(0)
  })

  it('灰卡找不到 removed 记录：不弹确认、不删任何文件', async () => {
    const deps = makeDeps({
      removedCards: [makeRemovedCard('r1', '_已移除/a.jpg')],
      removedEntries: [],
    })
    expect(await runPermanentDelete(['r1'], deps)).toBe(false)
    expect(deps.confirm).not.toHaveBeenCalled()
    expect(deps.deleted).toHaveLength(0)
  })

  it('确认取消：不删文件、不清 store', async () => {
    const deps = makeDeps({
      removedCards: [makeRemovedCard('r1', '_已移除/a.jpg')],
      removedEntries: [makeEntry('r1', '_已移除/a.jpg', 'a.jpg')],
      confirm: vi.fn(async () => false),
    })
    expect(await runPermanentDelete(['r1'], deps)).toBe(true)
    expect(deps.deleted).toHaveLength(0)
    expect(deps.deletedPayloads).toHaveLength(0)
  })

  it('确认后真删：deleteFile 收「空间路径 + movedTo」绝对路径，store 清对应 id', async () => {
    const deps = makeDeps({
      removedCards: [makeRemovedCard('r1', '_已移除/子/a.jpg'), makeRemovedCard('r2', '_已移除/b.png')],
      removedEntries: [
        makeEntry('r1', '_已移除/子/a.jpg', '子/a.jpg'),
        makeEntry('r2', '_已移除/b.png', 'b.png'),
      ],
    })
    expect(await runPermanentDelete(['r1', 'r2'], deps)).toBe(true)

    expect(deps.deleted).toEqual(['D:\\space\\_已移除\\子\\a.jpg', 'D:\\space\\_已移除\\b.png'])
    expect(deps.deletedPayloads).toEqual([{ cardIds: ['r1', 'r2'], entryIds: ['r1', 'r2'] }])
    expect(deps.scheduled).toBe(1)
  })

  it('记录按 movedTo 优先匹配、id 兜底（历史重复 id 记录不会误删旧条目的文件）', async () => {
    const deps = makeDeps({
      removedCards: [makeRemovedCard('dup', '_已移除/新的.jpg')],
      // 两条记录同 id：旧条目的 movedTo 不同 → 按 movedTo 精确匹配到第二条
      removedEntries: [
        makeEntry('dup', '_已移除/旧的.jpg', '旧的.jpg'),
        makeEntry('dup', '_已移除/新的.jpg', '新的.jpg'),
      ],
    })
    await runPermanentDelete(['dup'], deps)
    expect(deps.deleted).toEqual(['D:\\space\\_已移除\\新的.jpg'])
    expect(deps.deletedPayloads[0].entryIds).toEqual(['dup'])
  })

  it('部分失败：只清成功项，失败清单经 onError 报出', async () => {
    const deps = makeDeps({
      removedCards: [makeRemovedCard('r1', '_已移除/a.jpg'), makeRemovedCard('r2', '_已移除/b.png')],
      removedEntries: [
        makeEntry('r1', '_已移除/a.jpg', 'a.jpg'),
        makeEntry('r2', '_已移除/b.png', 'b.png'),
      ],
      provider: {
        deleteFile: vi.fn(async (path: string) => {
          if (path.endsWith('b.png')) throw new Error('文件被占用')
        }),
      } as unknown as StorageProvider,
    })
    expect(await runPermanentDelete(['r1', 'r2'], deps)).toBe(false)

    expect(deps.deletedPayloads).toEqual([{ cardIds: ['r1'], entryIds: ['r1'] }])
    expect(deps.errors[0]).toBe(PERMANENT_DELETE_TEXT.partialFailed(['b.png（文件被占用）']))
    expect(deps.scheduled).toBe(1)
  })

  it('全部失败：store 不动', async () => {
    const deps = makeDeps({
      removedCards: [makeRemovedCard('r1', '_已移除/a.jpg')],
      removedEntries: [makeEntry('r1', '_已移除/a.jpg', 'a.jpg')],
      provider: {
        deleteFile: vi.fn(async () => {
          throw new Error('磁盘错误')
        }),
      } as unknown as StorageProvider,
    })
    expect(await runPermanentDelete(['r1'], deps)).toBe(false)
    expect(deps.deletedPayloads).toHaveLength(0)
    expect(deps.scheduled).toBe(0)
  })
})
