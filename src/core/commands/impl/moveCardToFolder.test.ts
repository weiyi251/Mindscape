// ============================================================================
// 模块说明（中文）
// 「移动卡片到文件夹」命令（moveCardToFolder）的单元测试。
// 覆盖：顶层文件夹推断、成功流（含分区扩框）、未分类（group 清空）、
// 重名自动改写实际落点、undo 全量还原（文件 + 字段 + 分区矩形）、do 失败不入栈。
// ============================================================================

import { describe, expect, it } from 'vitest'

import type { Card, Partition } from '@/core/types'
import type { StorageProvider } from '@/core/storage/StorageProvider'
import {
  createMoveCardToFolderCommand,
  currentTopFolderOf,
} from './moveCardToFolder'

type Update = { id: string; filePath: string; originalPath: string; group: string | undefined }
type Rect = { id: string; x: number; y: number; w: number; h: number }

function card(id: string, filePath: string, overrides: Partial<Card> = {}): Card {
  return {
    id,
    type: 'image',
    filePath,
    originalPath: filePath,
    x: 0,
    y: 0,
    w: 100,
    h: 80,
    rotation: 0,
    zIndex: 0,
    note: '',
    meta: {},
    ...overrides,
  }
}

function partition(overrides: Partial<Partition> = {}): Partition {
  return {
    id: 'p_001',
    name: '旅行',
    folderPath: '旅行',
    x: 0,
    y: 0,
    w: 500,
    h: 400,
    color: 'auto',
    collapsed: false,
    meta: {},
    ...overrides,
  }
}

const SPACE = 'D:\\空间'

/** 可编程假 provider：记录移动；moveResult 模拟重名自动加后缀后的实际落点 */
function fakeProvider(moves: { from: string; to: string; actual: string }[], moveResult?: string) {
  return {
    async moveFile(from: string, to: string) {
      const actual = moveResult ?? to
      moves.push({ from, to, actual })
      return actual
    },
  } as unknown as StorageProvider
}

/** 收集型 context：记录全部应用回调的入参 */
function setup(options: { moveResult?: string } = {}) {
  const moves: { from: string; to: string; actual: string }[] = []
  const updates: Update[][] = []
  const partitionRects: Rect[][] = []

  const context = {
    spacePath: SPACE,
    provider: fakeProvider(moves, options.moveResult),
    applyUpdate: (list: Update[]) => {
      updates.push(list)
    },
    applyPartitionRects: (list: Rect[]) => {
      partitionRects.push(list)
    },
  }

  return { context, moves, updates, partitionRects }
}

describe('currentTopFolderOf', () => {
  it('取相对路径第一段作为当前顶层文件夹', () => {
    expect(currentTopFolderOf('未分类/a.png')).toBe('未分类')
    expect(currentTopFolderOf('旅行\\b.jpg')).toBe('旅行')
    expect(currentTopFolderOf('根目录图.jpg')).toBe('')
  })
})

describe('createMoveCardToFolderCommand', () => {
  it('do：文件移到目标分区文件夹，字段更新 + 目标分区扩框', async () => {
    const { context, moves, updates, partitionRects } = setup()
    const target = partition({ x: 100, y: 100, w: 300, h: 200 })
    const command = createMoveCardToFolderCommand(
      // 卡片在 (400, 350)，超出分区右下角 → 扩框
      card('c_001', '未分类/a.png', { x: 400, y: 350 }),
      '旅行',
      '旅行',
      target,
      context,
    )

    await command.do()

    // joinPath 会把相对路径的分隔符统一成 base 的风格（Windows → \）
    expect(moves).toEqual([
      { from: 'D:\\空间\\未分类\\a.png', to: 'D:\\空间\\旅行\\a.png', actual: 'D:\\空间\\旅行\\a.png' },
    ])
    expect(updates).toEqual([
      [{ id: 'c_001', filePath: '旅行/a.png', originalPath: '旅行/a.png', group: '旅行' }],
    ])
    // 扩到包住卡片：max(400 + 100, 400) = 500 宽、max(350 + 80, 300) = 430 高
    expect(partitionRects).toEqual([[{ id: 'p_001', x: 100, y: 100, w: 400, h: 330 }]])
  })

  it('do：卡片已在目标分区内 → 不改分区矩形', async () => {
    const { context, updates, partitionRects } = setup()
    const target = partition({ x: 0, y: 0, w: 500, h: 400 })
    const command = createMoveCardToFolderCommand(
      card('c_001', '旅行/b.jpg', { x: 50, y: 50 }),
      '旅行',
      '旅行',
      target,
      context,
    )

    await command.do()

    expect(partitionRects).toHaveLength(0)
    expect(updates).toEqual([
      [{ id: 'c_001', filePath: '旅行/b.jpg', originalPath: '旅行/b.jpg', group: '旅行' }],
    ])
  })

  it('do：移到未分类 → group 清空、不触发分区矩形', async () => {
    const { context, moves, updates, partitionRects } = setup()
    const command = createMoveCardToFolderCommand(
      card('c_001', '旅行/c.jpg'),
      '未分类',
      undefined,
      null,
      context,
    )

    await command.do()

    expect(moves[0].to).toBe('D:\\空间\\未分类\\c.jpg')
    expect(updates).toEqual([
      [{ id: 'c_001', filePath: '未分类/c.jpg', originalPath: '未分类/c.jpg', group: undefined }],
    ])
    expect(partitionRects).toHaveLength(0)
  })

  it('do：目标重名被自动加后缀 → filePath 记实际落点', async () => {
    const { context, moves, updates } = setup({ moveResult: 'D:\\空间\\旅行\\a_1.png' })
    const command = createMoveCardToFolderCommand(
      card('c_001', '未分类/a.png'),
      '旅行',
      '旅行',
      null,
      context,
    )

    await command.do()

    expect(moves[0].actual).toBe('D:\\空间\\旅行\\a_1.png')
    expect(updates[0][0].filePath).toBe('旅行/a_1.png')
  })

  it('undo：文件移回原位、字段还原、分区矩形还原', async () => {
    const { context, moves, updates, partitionRects } = setup()
    const target = partition({ x: 100, y: 100, w: 300, h: 200 })
    const original = card('c_001', '未分类/a.png', { x: 400, y: 350 })
    const command = createMoveCardToFolderCommand(
      original,
      '旅行',
      '旅行',
      target,
      context,
    )

    await command.do()
    await command.undo()

    expect(moves).toHaveLength(2)
    expect(moves[1].from).toBe('D:\\空间\\旅行\\a.png')
    expect(moves[1].to).toBe('D:\\空间\\未分类\\a.png')
    expect(updates).toHaveLength(2)
    expect(updates[1]).toEqual([
      { id: 'c_001', filePath: '未分类/a.png', originalPath: '未分类/a.png', group: undefined },
    ])
    // undo 把分区矩形还原成 do 之前的值
    expect(partitionRects).toHaveLength(2)
    expect(partitionRects[1]).toEqual([{ id: 'p_001', x: 100, y: 100, w: 300, h: 200 }])
  })

  it('do 失败：抛错、不触发任何应用回调（命令不入栈）', async () => {
    const provider = {
      async moveFile() {
        throw new Error('文件夹被占用')
      },
    } as unknown as StorageProvider
    const updates: unknown[] = []
    const partitionRects: unknown[] = []

    const command = createMoveCardToFolderCommand(
      card('c_001', '未分类/a.png'),
      '旅行',
      '旅行',
      partition(),
      {
        spacePath: SPACE,
        provider,
        applyUpdate: (list) => updates.push(list),
        applyPartitionRects: (list) => partitionRects.push(list),
      },
    )

    await expect(command.do()).rejects.toThrow('文件夹被占用')
    expect(updates).toHaveLength(0)
    expect(partitionRects).toHaveLength(0)
  })
})
