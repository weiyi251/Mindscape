// ============================================================================
// 模块说明（中文）
// updater 模块的单元测试。vitest 环境为 node（项目未引入 jsdom），
// 因此这里不渲染任何 UI，只验证「调用与结果归一化」这条纯逻辑链路。
// 三个外部依赖全部 mock：检查插件、重启插件、运行时判定。
// ============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { UpdateProgress } from './updater'

/** 插件回调事件的形状（只声明本测试用到的字段，避免隐式 any） */
type PluginEvent = { event: string; data: { contentLength?: number; chunkLength?: number } }

const { checkMock, relaunchMock, state } = vi.hoisted(() => ({
  checkMock: vi.fn(),
  relaunchMock: vi.fn(),
  state: { desktop: true },
}))

vi.mock('@tauri-apps/plugin-updater', () => ({ check: checkMock }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: relaunchMock }))
vi.mock('@/core/utils/runtime', () => ({ isDesktopRuntime: () => state.desktop }))

const { checkForUpdate, downloadAndInstall, restartApp, progressRatio } = await import('./updater')

beforeEach(() => {
  checkMock.mockReset()
  relaunchMock.mockReset()
  state.desktop = true
})

describe('checkForUpdate', () => {
  it('非桌面环境直接短路，且不触碰插件', async () => {
    state.desktop = false
    await expect(checkForUpdate()).resolves.toEqual({ kind: 'unsupported' })
    expect(checkMock).not.toHaveBeenCalled()
  })

  it('插件返回 null 时判定为已是最新', async () => {
    checkMock.mockResolvedValue(null)
    await expect(checkForUpdate()).resolves.toEqual({ kind: 'up-to-date' })
  })

  it('有更新时归一化出版本、说明与日期', async () => {
    const update = { version: '0.2.0', body: '修复了若干问题', date: '2026-09-12' }
    checkMock.mockResolvedValue(update)

    const result = await checkForUpdate()

    expect(result.kind).toBe('available')
    if (result.kind !== 'available') throw new Error('unreachable')
    expect(result.version).toBe('0.2.0')
    expect(result.notes).toBe('修复了若干问题')
    expect(result.date).toBe('2026-09-12')
    expect(result.update).toBe(update)
  })

  it('说明与日期缺失时回落为空串而不是 undefined', async () => {
    checkMock.mockResolvedValue({ version: '0.2.0' })

    const result = await checkForUpdate()

    if (result.kind !== 'available') throw new Error('unreachable')
    expect(result.notes).toBe('')
    expect(result.date).toBe('')
  })

  it('插件抛错时归一化为 error，绝不向上抛', async () => {
    checkMock.mockRejectedValue(new Error('network down'))

    const result = await checkForUpdate()

    expect(result).toEqual({ kind: 'error', message: 'network down' })
  })

  it('抛出的非 Error 值也能被转成字符串', async () => {
    checkMock.mockRejectedValue('boom')
    await expect(checkForUpdate()).resolves.toEqual({ kind: 'error', message: 'boom' })
  })
})

describe('progressRatio', () => {
  it('总长度已知时按比例返回', () => {
    expect(progressRatio({ downloaded: 25, total: 100 })).toBe(0.25)
  })

  it('总长度未知时返回 null（无法换算百分比）', () => {
    expect(progressRatio({ downloaded: 25, total: null })).toBeNull()
  })

  it('总长度为 0 时返回 null，避免除零', () => {
    expect(progressRatio({ downloaded: 0, total: 0 })).toBeNull()
  })

  it('超出范围的比例会被夹到 [0, 1]', () => {
    expect(progressRatio({ downloaded: 300, total: 100 })).toBe(1)
    expect(progressRatio({ downloaded: -5, total: 100 })).toBe(0)
  })
})

describe('downloadAndInstall', () => {
  it('把插件事件聚合成累计进度', async () => {
    const update = {
      downloadAndInstall: async (onEvent: (event: PluginEvent) => void) => {
        onEvent({ event: 'Started', data: { contentLength: 100 } })
        onEvent({ event: 'Progress', data: { chunkLength: 30 } })
        onEvent({ event: 'Progress', data: { chunkLength: 70 } })
      },
    }
    const seen: UpdateProgress[] = []

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await downloadAndInstall(update as any, (p) => seen.push(p))

    expect(seen).toEqual([
      { downloaded: 0, total: 100 },
      { downloaded: 30, total: 100 },
      { downloaded: 100, total: 100 },
    ])
  })

  it('未提供回调时不报错', async () => {
    const update = {
      downloadAndInstall: async (onEvent: (event: PluginEvent) => void) => {
        onEvent({ event: 'Started', data: {} })
      },
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(downloadAndInstall(update as any)).resolves.toBeUndefined()
  })
})

describe('restartApp', () => {
  it('调用插件的 relaunch', async () => {
    relaunchMock.mockResolvedValue(undefined)
    await restartApp()
    expect(relaunchMock).toHaveBeenCalledTimes(1)
  })
})
