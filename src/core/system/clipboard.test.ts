// ============================================================================
// 模块说明（中文）
// 系统剪贴板文件互通封装的单元测试（2026-09-13）。
// invoke 一律 mock：真实剪贴板行为由 Rust 侧测试覆盖（含 Windows 往返用例）。
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

import { readClipboardFiles, writeClipboardFiles, writeClipboardText } from './clipboard'

describe('writeClipboardFiles', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    desktopRuntime = true
  })

  it('透传路径列表给 Rust 命令，返回写入数量', async () => {
    invokeMock.mockResolvedValue(3)

    const count = await writeClipboardFiles(['D:\\a.jpg', 'D:\\b.png', 'D:\\c.txt'])

    expect(invokeMock).toHaveBeenCalledWith('write_clipboard_files', {
      paths: ['D:\\a.jpg', 'D:\\b.png', 'D:\\c.txt'],
    })
    expect(count).toBe(3)
  })

  it('Rust 的中文错误原样向上抛（调用方负责展示）', async () => {
    invokeMock.mockRejectedValue('以下路径不存在或不是文件，无法复制：D:\\缺失.png')

    await expect(writeClipboardFiles(['D:\\缺失.png'])).rejects.toContain('无法复制')
  })
})

describe('writeClipboardText', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('透传文本给 Rust 命令', async () => {
    invokeMock.mockResolvedValue(undefined)

    await writeClipboardText('便签内容')

    expect(invokeMock).toHaveBeenCalledWith('write_clipboard_text', { text: '便签内容' })
  })
})

describe('readClipboardFiles', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    desktopRuntime = true
  })

  it('桌面环境返回 Rust 读到的路径列表', async () => {
    invokeMock.mockResolvedValue(['D:\\外部\\图.png'])

    await expect(readClipboardFiles()).resolves.toEqual(['D:\\外部\\图.png'])
  })

  it('剪贴板上没有文件（Rust 返回空列表）→ 返回空', async () => {
    invokeMock.mockResolvedValue([])

    await expect(readClipboardFiles()).resolves.toEqual([])
  })

  it('非桌面环境（浏览器 dev / 测试）直接返回空列表，不发起 invoke', async () => {
    desktopRuntime = false

    await expect(readClipboardFiles()).resolves.toEqual([])
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('invoke 失败（如剪贴板被占用）按「没有文件」处理，不向上抛', async () => {
    invokeMock.mockRejectedValue('无法打开系统剪贴板')

    await expect(readClipboardFiles()).resolves.toEqual([])
  })
})
