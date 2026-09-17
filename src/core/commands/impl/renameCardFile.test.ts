// ============================================================================
// 模块说明（中文）
// renameCardFile.ts 的单元测试：名称校验、do/undo 的文件移动与字段写回、
// 重名改写时以实际落点为准。
// ============================================================================

import { describe, expect, it, vi } from 'vitest'

import { createRenameCardFileCommand, isValidCardFileName } from './renameCardFile'
import type { RenameCardFileContext } from './renameCardFile'
import type { CardFileRefUpdate } from './moveCardToFolder'
import type { StorageProvider } from '@/core/storage/StorageProvider'
import { zCardSchema } from '@/core/types'
import type { Card } from '@/core/types'

function makeFileCard(filePath: string): Card {
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

function makeContext(overrides: Partial<RenameCardFileContext> = {}): RenameCardFileContext & {
  updates: CardFileRefUpdate[]
} {
  const updates: CardFileRefUpdate[] = []
  return {
    spacePath: 'D:\\space',
    provider: {
      moveFile: vi.fn(async (_src: string, dest: string) => dest),
    } as unknown as StorageProvider,
    applyUpdate: vi.fn((next: CardFileRefUpdate[]) => {
      updates.push(...next)
    }),
    ...overrides,
    updates,
  } as RenameCardFileContext & { updates: CardFileRefUpdate[] }
}

describe('isValidCardFileName', () => {
  it('普通名字（含扩展名 / 中文 / 空格）合法', () => {
    expect(isValidCardFileName('报告 v2.pdf')).toBe(true)
    expect(isValidCardFileName('总平面图.dwg')).toBe(true)
  })

  it('空串 / 纯空白 / 点号非法', () => {
    expect(isValidCardFileName('')).toBe(false)
    expect(isValidCardFileName('   ')).toBe(false)
    expect(isValidCardFileName('.')).toBe(false)
    expect(isValidCardFileName('..')).toBe(false)
    expect(isValidCardFileName('.hidden')).toBe(false)
  })

  it('含 Windows 非法字符非法', () => {
    for (const char of ['\\', '/', ':', '*', '?', '"', '<', '>', '|']) {
      expect(isValidCardFileName(`a${char}b.jpg`)).toBe(false)
    }
  })
})

describe('createRenameCardFileCommand', () => {
  it('do：文件移到同目录新名，filePath / originalPath 写新相对路径，group 保留', async () => {
    const card = makeFileCard('参考资料/ref-01.jpg')
    const context = makeContext()
    const command = createRenameCardFileCommand(card, '外墙.jpg', context)

    await command.do()

    const move = vi.mocked(context.provider.moveFile).mock.calls[0]
    expect(move[0]).toBe('D:\\space\\参考资料\\ref-01.jpg')
    expect(move[1]).toBe('D:\\space\\参考资料\\外墙.jpg')
    expect(context.updates).toEqual([
      {
        id: 'c1',
        filePath: '参考资料/外墙.jpg',
        originalPath: '参考资料/外墙.jpg',
        group: card.group,
      },
    ])
  })

  it('根目录文件：目录部分为空，dest 落在空间根', async () => {
    const card = makeFileCard('ref-01.jpg')
    const context = makeContext()
    const command = createRenameCardFileCommand(card, 'ref-02.jpg', context)

    await command.do()

    const move = vi.mocked(context.provider.moveFile).mock.calls[0]
    expect(move[1]).toBe('D:\\space\\ref-02.jpg')
    expect(context.updates[0].filePath).toBe('ref-02.jpg')
  })

  it('undo：文件移回旧名，字段整体还原', async () => {
    const card = makeFileCard('参考资料/ref-01.jpg')
    const context = makeContext()
    const command = createRenameCardFileCommand(card, '外墙.jpg', context)
    await command.do()
    await command.undo()

    const moveBack = vi.mocked(context.provider.moveFile).mock.calls[1]
    expect(moveBack[0]).toBe('D:\\space\\参考资料\\外墙.jpg')
    expect(moveBack[1]).toBe('D:\\space\\参考资料\\ref-01.jpg')
    expect(context.updates.at(-1)).toEqual({
      id: 'c1',
      filePath: card.filePath,
      originalPath: card.originalPath,
      group: card.group,
    })
  })

  it('moveFile 重名自动改写落点：以实际路径反推相对路径（_1 后缀场景）', async () => {
    const card = makeFileCard('ref.jpg')
    const context = makeContext({
      provider: {
        moveFile: vi.fn(async (_src: string, dest: string) => `${dest}_1`) as StorageProvider['moveFile'],
      } as unknown as StorageProvider,
    })
    const command = createRenameCardFileCommand(card, 'other.jpg', context)

    await command.do()

    expect(context.updates[0].filePath).toBe('other.jpg_1')
    // undo 从实际落点移回
    await command.undo()
    expect(vi.mocked(context.provider.moveFile).mock.calls[1][0]).toBe('D:\\space\\other.jpg_1')
  })
})
