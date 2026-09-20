// ============================================================================
// 模块说明（中文）
// 目录签名封装的单元测试（A1，2026-09-20）。
// invoke 一律 mock：真实的文件系统签名行为由 Rust 侧测试覆盖
// （src-tauri/src/commands/dir_signature.rs 的 8 个用例）。
// ============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

vi.mock('@/core/utils/runtime', () => ({
  isDesktopRuntime: () => desktopRuntime,
}))

let desktopRuntime = true

import { externalChangeOf, readDirSignature, sameSignature } from './dirSignature'
import type { DirSignature } from './dirSignature'

const BASE: DirSignature = { hash: 'abc123', files: 5, dirs: 2 }

beforeEach(() => {
  invokeMock.mockReset()
  desktopRuntime = true
})

describe('readDirSignature', () => {
  it('桌面环境：调用 Rust 命令并透传绝对路径', async () => {
    invokeMock.mockResolvedValue(BASE)

    const result = await readDirSignature('D:\\Mindscape\\01_项目A')

    expect(invokeMock).toHaveBeenCalledWith('dir_signature', { path: 'D:\\Mindscape\\01_项目A' })
    expect(result).toEqual(BASE)
  })

  it('非桌面环境：返回 null 且不调用 invoke（不是错误，只是没有这项能力）', async () => {
    desktopRuntime = false

    await expect(readDirSignature('D:\\空间')).resolves.toBeNull()
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('桌面环境的真实错误（路径不可访问）原样向上抛，由调用方展示', async () => {
    invokeMock.mockRejectedValue('路径不存在：D:\\空间')

    await expect(readDirSignature('D:\\空间')).rejects.toContain('路径不存在')
  })
})

describe('sameSignature', () => {
  it('三项全等才算一致', () => {
    expect(sameSignature(BASE, { ...BASE })).toBe(true)
    expect(sameSignature(BASE, { ...BASE, hash: 'other' })).toBe(false)
    expect(sameSignature(BASE, { ...BASE, files: 6 })).toBe(false)
    expect(sameSignature(BASE, { ...BASE, dirs: 3 })).toBe(false)
  })

  it('任一为 null（不支持 / 还没基线）→ 视为无需报告，避免误报', () => {
    expect(sameSignature(null, BASE)).toBe(true)
    expect(sameSignature(BASE, null)).toBe(true)
    expect(sameSignature(null, null)).toBe(true)
  })
})

describe('externalChangeOf', () => {
  it('完全一致 → null（没有外部变动）', () => {
    expect(externalChangeOf(BASE, { ...BASE })).toBeNull()
  })

  it('文件数变化 → 给出前后数量（UI 可显示「12 → 15」）', () => {
    expect(externalChangeOf(BASE, { ...BASE, hash: 'x', files: 7 })).toEqual({
      prevFiles: 5,
      files: 7,
    })
  })

  it('文件数相同但内容变了（改名 / 覆盖）→ 同样报变动，前后数量相同', () => {
    expect(externalChangeOf(BASE, { ...BASE, hash: 'changed' })).toEqual({
      prevFiles: 5,
      files: 5,
    })
  })

  it('缺基线或读不到当前签名 → null（不误报）', () => {
    expect(externalChangeOf(null, BASE)).toBeNull()
    expect(externalChangeOf(BASE, null)).toBeNull()
  })
})
