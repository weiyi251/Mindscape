// ============================================================================
// 模块说明（中文）
// updaterStore 的单元测试。vitest 环境为 node（项目未引入 jsdom），
// 因此只验证状态机的迁移与弹窗开关，不渲染 UI。
//
// 被 mock 的是 core/updater（插件薄封装层）：store 的职责只是「把结果翻译成状态」，
// 真正调用插件的行为已在 updater.test.ts 覆盖，这里不重复测。
// ============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { checkForUpdateMock, downloadAndInstallMock, restartAppMock } = vi.hoisted(() => ({
  checkForUpdateMock: vi.fn(),
  downloadAndInstallMock: vi.fn(),
  restartAppMock: vi.fn(),
}))

vi.mock('@/core/updater/updater', () => ({
  checkForUpdate: checkForUpdateMock,
  downloadAndInstall: downloadAndInstallMock,
  restartApp: restartAppMock,
}))

const { useUpdaterStore, resetUpdaterStoreForTest } = await import('./updaterStore')

/** 造一个可被 store 持有的 Update 假实例（store 只把它透传给 downloadAndInstall） */
const fakeUpdate = { version: '0.2.0' }

beforeEach(() => {
  checkForUpdateMock.mockReset()
  downloadAndInstallMock.mockReset()
  restartAppMock.mockReset()
  resetUpdaterStoreForTest()
})

/** 走一次 check，并返回 store 快照 */
async function runCheck(result: unknown, silent = false) {
  checkForUpdateMock.mockResolvedValue(result)
  await useUpdaterStore.getState().check(silent ? { silent: true } : undefined)
  return useUpdaterStore.getState()
}

describe('check', () => {
  it('发现新版本：进入 available 并自动弹窗，带上版本与说明', async () => {
    const state = await runCheck({
      kind: 'available',
      version: '0.2.0',
      notes: '修复若干问题',
      date: '2026-09-12',
      update: fakeUpdate,
    })

    expect(state.status).toBe('available')
    expect(state.dialogOpen).toBe(true)
    expect(state.version).toBe('0.2.0')
    expect(state.notes).toBe('修复若干问题')
  })

  it('发现新版本时即使静默检查也要弹窗（这是唯一该打扰用户的情形）', async () => {
    const state = await runCheck(
      { kind: 'available', version: '0.2.0', notes: '', date: '', update: fakeUpdate },
      true,
    )

    expect(state.status).toBe('available')
    expect(state.dialogOpen).toBe(true)
  })

  it('已是最新：静默检查不弹窗', async () => {
    const state = await runCheck({ kind: 'up-to-date' }, true)

    expect(state.status).toBe('up-to-date')
    expect(state.dialogOpen).toBe(false)
  })

  it('已是最新：手动检查要弹窗给出反馈', async () => {
    const state = await runCheck({ kind: 'up-to-date' })

    expect(state.status).toBe('up-to-date')
    expect(state.dialogOpen).toBe(true)
  })

  it('检查失败：静默时不弹窗，但错误信息仍留在 store 里', async () => {
    const state = await runCheck({ kind: 'error', message: '网络不可达' }, true)

    expect(state.status).toBe('error')
    expect(state.dialogOpen).toBe(false)
    expect(state.errorMessage).toBe('网络不可达')
  })

  it('检查失败：手动时弹窗展示原因', async () => {
    const state = await runCheck({ kind: 'error', message: '网络不可达' })

    expect(state.status).toBe('error')
    expect(state.dialogOpen).toBe(true)
  })

  it('非桌面环境：unsupported 同样遵循静默规则', async () => {
    expect((await runCheck({ kind: 'unsupported' }, true)).dialogOpen).toBe(false)
    expect((await runCheck({ kind: 'unsupported' })).dialogOpen).toBe(true)
  })

  it('新一轮检查会清掉上一轮的进度与错误', async () => {
    useUpdaterStore.setState({ progress: { downloaded: 10, total: 100 }, errorMessage: '旧错误' })

    const state = await runCheck({ kind: 'up-to-date' }, true)

    expect(state.progress).toBeNull()
    expect(state.errorMessage).toBe('')
  })
})

describe('install', () => {
  it('未检查过就点安装：不做任何事（没有可安装的 Update 实例）', async () => {
    await useUpdaterStore.getState().install()

    expect(downloadAndInstallMock).not.toHaveBeenCalled()
    expect(useUpdaterStore.getState().status).toBe('idle')
  })

  it('安装过程中把插件回调写进 progress，完成后进入 ready', async () => {
    await runCheck({ kind: 'available', version: '0.2.0', notes: '', date: '', update: fakeUpdate })

    downloadAndInstallMock.mockImplementation(async (_update, onProgress) => {
      onProgress({ downloaded: 40, total: 100 })
      onProgress({ downloaded: 100, total: 100 })
    })

    await useUpdaterStore.getState().install()

    const state = useUpdaterStore.getState()
    expect(state.status).toBe('ready')
    expect(state.progress).toEqual({ downloaded: 100, total: 100 })
  })

  it('下载失败：回到 error 并保留原因', async () => {
    await runCheck({ kind: 'available', version: '0.2.0', notes: '', date: '', update: fakeUpdate })
    downloadAndInstallMock.mockRejectedValue(new Error('校验失败'))

    await useUpdaterStore.getState().install()

    const state = useUpdaterStore.getState()
    expect(state.status).toBe('error')
    expect(state.errorMessage).toBe('校验失败')
  })
})

describe('open（手动入口）', () => {
  it('从未检查过：发起一次非静默检查', async () => {
    await runCheck({ kind: 'up-to-date' })
    resetUpdaterStoreForTest()
    checkForUpdateMock.mockClear()

    useUpdaterStore.getState().open()

    expect(checkForUpdateMock).toHaveBeenCalledTimes(1)
  })

  it('已是最新：重新检查，而不是拿旧结果糊弄用户', async () => {
    await runCheck({ kind: 'up-to-date' }, true)
    checkForUpdateMock.mockClear()

    useUpdaterStore.getState().open()
    // check 是异步的，让微任务队列跑完
    await Promise.resolve()
    await Promise.resolve()

    expect(checkForUpdateMock).toHaveBeenCalledTimes(1)
  })

  it('已发现更新：只开窗，不重新检查（避免丢掉 pending 实例）', async () => {
    await runCheck({ kind: 'available', version: '0.2.0', notes: '', date: '', update: fakeUpdate })
    useUpdaterStore.setState({ dialogOpen: false })
    checkForUpdateMock.mockClear()

    useUpdaterStore.getState().open()

    expect(checkForUpdateMock).not.toHaveBeenCalled()
    expect(useUpdaterStore.getState().dialogOpen).toBe(true)
  })

  it('正在下载：只开窗，不打断下载', async () => {
    await runCheck({ kind: 'available', version: '0.2.0', notes: '', date: '', update: fakeUpdate })
    useUpdaterStore.setState({ status: 'downloading', dialogOpen: false })
    checkForUpdateMock.mockClear()

    useUpdaterStore.getState().open()

    expect(checkForUpdateMock).not.toHaveBeenCalled()
    expect(useUpdaterStore.getState().status).toBe('downloading')
    expect(useUpdaterStore.getState().dialogOpen).toBe(true)
  })

  it('检查中：只开窗，不并发第二个请求', async () => {
    useUpdaterStore.setState({ status: 'checking' })
    checkForUpdateMock.mockClear()

    useUpdaterStore.getState().open()

    expect(checkForUpdateMock).not.toHaveBeenCalled()
    expect(useUpdaterStore.getState().dialogOpen).toBe(true)
  })
})

describe('dismiss / restart', () => {
  it('dismiss 只关窗，不改状态机', async () => {
    await runCheck({ kind: 'up-to-date' })

    useUpdaterStore.getState().dismiss()

    expect(useUpdaterStore.getState().dialogOpen).toBe(false)
    expect(useUpdaterStore.getState().status).toBe('up-to-date')
  })

  it('restart 调用插件的 relaunch', async () => {
    restartAppMock.mockResolvedValue(undefined)

    await useUpdaterStore.getState().restart()

    expect(restartAppMock).toHaveBeenCalledTimes(1)
  })
})
