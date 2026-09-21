// ============================================================================
// 模块说明（中文）
// 系统剪贴板文件互通封装的单元测试（2026-09-13；2026-09-21 M4 补移动端通道）。
// invoke 一律 mock：真实剪贴板行为由 Rust 侧测试覆盖（含 Windows 往返用例）。
// runtime 也只换掉「UA / 桌面判定从哪来」，平台能力表用真表，
// 这样「移动端不得碰原生命令、必须改走 navigator.clipboard」是被真实判定链驱动的。
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

vi.mock('@/core/utils/runtime', () => ({
  isDesktopRuntime: () => desktopRuntime,
  currentUserAgent: () => userAgent,
  isMobileRuntime: (value: string) => /Android|iPhone|iPad|Mobile/.test(value),
}))

let desktopRuntime = true
let userAgent = ''

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; M2012K11AC Build/UKQ1) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36'

import {
  CLIPBOARD_TEXT,
  readClipboardFiles,
  writeClipboardFiles,
  writeClipboardText,
  writeSystemClipboardText,
} from './clipboard'

afterEach(() => {
  userAgent = ''
  vi.unstubAllGlobals()
})

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

describe('writeSystemClipboardText（M4：按平台选通道）', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    desktopRuntime = true
    userAgent = ''
  })

  it('桌面：走原生命令，不碰 navigator.clipboard', async () => {
    invokeMock.mockResolvedValue(undefined)
    const webClipboard = { writeText: vi.fn(async () => {}) }

    await writeSystemClipboardText('便签内容', webClipboard)

    expect(invokeMock).toHaveBeenCalledWith('write_clipboard_text', { text: '便签内容' })
    expect(webClipboard.writeText).not.toHaveBeenCalled()
  })

  it('移动端：原生命令一次都不发（安卓上注定 Err），改走网页剪贴板', async () => {
    userAgent = ANDROID_UA
    const writeText = vi.fn(async () => {})

    await writeSystemClipboardText('海报.png', { writeText })

    expect(invokeMock).not.toHaveBeenCalled()
    expect(writeText).toHaveBeenCalledWith('海报.png')
  })

  it('移动端默认值确实取 navigator.clipboard（不传第二参数）', async () => {
    userAgent = ANDROID_UA
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { userAgent: ANDROID_UA, clipboard: { writeText } })

    await writeSystemClipboardText('便签')

    expect(writeText).toHaveBeenCalledWith('便签')
  })

  it('移动端且 WebView 不给剪贴板接口：如实报错，不假装复制成功', async () => {
    userAgent = ANDROID_UA
    vi.stubGlobal('navigator', { userAgent: ANDROID_UA })

    await expect(writeSystemClipboardText('便签')).rejects.toThrow(CLIPBOARD_TEXT.noWebClipboard)
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

  it('移动端（安卓 isDesktopRuntime 仍为 true）也要挡住：不发注定失败的 invoke', async () => {
    userAgent = ANDROID_UA

    await expect(readClipboardFiles()).resolves.toEqual([])
    expect(invokeMock).not.toHaveBeenCalled()
  })
})
