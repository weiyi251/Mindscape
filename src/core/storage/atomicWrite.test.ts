// ============================================================================
// 模块说明（中文）
// core/storage/atomicWrite.ts 的单元测试。
//
// vitest 为 node 环境（项目不引入 jsdom），fs 插件整体 mock 成内存实现，
// 只验证原子写的**行为契约**：先写 .tmp 再 rename、目标最终为完整内容、
// 失败时向上抛（不吞错）。
// ============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fsState, writeTextFileMock, renameMock } = vi.hoisted(() => ({
  fsState: { files: new Map<string, string>(), trace: [] as string[] },
  writeTextFileMock: vi.fn(),
  renameMock: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  writeTextFile: (...args: unknown[]) => writeTextFileMock(...args),
  rename: (...args: unknown[]) => renameMock(...args),
}))

import { atomicWriteTextFile } from './atomicWrite'

beforeEach(() => {
  fsState.files.clear()
  fsState.trace.length = 0
  writeTextFileMock.mockReset()
  renameMock.mockReset()

  writeTextFileMock.mockImplementation(async (filePath: string, text: string) => {
    fsState.files.set(filePath, text)
    fsState.trace.push(`write:${filePath}`)
  })
  renameMock.mockImplementation(async (from: string, to: string) => {
    const text = fsState.files.get(from)
    if (text === undefined) throw new Error(`文件不存在：${from}`)
    fsState.files.delete(from)
    fsState.files.set(to, text)
    fsState.trace.push(`rename:${from}->${to}`)
  })
})

const TARGET = 'C:\\Users\\tester\\AppData\\Roaming\\Mindscape\\spaces.json'

describe('atomicWriteTextFile', () => {
  it('先写 .tmp 再 rename，目标拿到完整内容', async () => {
    await atomicWriteTextFile(TARGET, '{ "version": 1 }\n')

    expect(fsState.trace).toEqual([`write:${TARGET}.tmp`, `rename:${TARGET}.tmp->${TARGET}`])
    expect(fsState.files.get(TARGET)).toBe('{ "version": 1 }\n')
  })

  it('不残留 .tmp', async () => {
    await atomicWriteTextFile(TARGET, 'x')
    expect(fsState.files.has(`${TARGET}.tmp`)).toBe(false)
  })

  it('覆盖已有目标时，旧内容被整体替换', async () => {
    fsState.files.set(TARGET, '旧内容')
    await atomicWriteTextFile(TARGET, '新内容')
    expect(fsState.files.get(TARGET)).toBe('新内容')
  })

  it('写 .tmp 失败时向上抛，且不触碰目标文件（旧内容仍完整）', async () => {
    fsState.files.set(TARGET, '旧内容')
    writeTextFileMock.mockImplementation(async () => {
      throw new Error('磁盘已满')
    })

    await expect(atomicWriteTextFile(TARGET, '新内容')).rejects.toThrow('磁盘已满')
    expect(renameMock).not.toHaveBeenCalled()
    expect(fsState.files.get(TARGET)).toBe('旧内容')
  })

  it('rename 失败时向上抛（不吞错）', async () => {
    renameMock.mockImplementation(async () => {
      throw new Error('目标被占用')
    })
    await expect(atomicWriteTextFile(TARGET, '新内容')).rejects.toThrow('目标被占用')
  })
})
