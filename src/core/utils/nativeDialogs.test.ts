// ============================================================================
// 模块说明（中文）
// nativeDialogs 的单元测试。vitest 环境为 node（项目不引入 jsdom，用户裁决），
// 因此不渲染任何 UI，只验证「按运行环境选中正确的弹窗 API」这条逻辑链路：
// 桌面端必须走 dialog 插件（带标题/图标），浏览器开发态必须回落原生 confirm/alert。
//
// 两个外部依赖全部 mock：dialog 插件、运行时判定；window 用 vi.stubGlobal 造桩。
// 实现任务：P1-1（架构守卫测试，规则 2 把原生弹窗收口到本模块）。
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { askMock, messageMock, state } = vi.hoisted(() => ({
  askMock: vi.fn(),
  messageMock: vi.fn(),
  state: { desktop: true },
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({ ask: askMock, message: messageMock }))
vi.mock('@/core/utils/runtime', () => ({ isDesktopRuntime: () => state.desktop }))

const { confirmDialog, alertDialog } = await import('./nativeDialogs')

const confirmStub = vi.fn()
const alertStub = vi.fn()

beforeEach(() => {
  askMock.mockReset()
  messageMock.mockReset()
  confirmStub.mockReset()
  alertStub.mockReset()
  alertStub.mockReturnValue(undefined)
  state.desktop = true
  // node 环境没有 window，按调用点需要的样子造一个最小桩
  vi.stubGlobal('window', { confirm: confirmStub, alert: alertStub })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('confirmDialog', () => {
  it('桌面端走 dialog 插件的 ask()，带标题与 warning 图标，不触碰原生 confirm', async () => {
    askMock.mockResolvedValue(true)

    await expect(confirmDialog('要这么做吗？', '重命名分区')).resolves.toBe(true)

    expect(askMock).toHaveBeenCalledWith('要这么做吗？', { title: '重命名分区', kind: 'warning' })
    expect(confirmStub).not.toHaveBeenCalled()
  })

  it('桌面端 ask() 被取消时返回 false', async () => {
    askMock.mockResolvedValue(false)

    await expect(confirmDialog('要这么做吗？', '移除空间')).resolves.toBe(false)
  })

  it('浏览器开发态回落原生 confirm()，不触碰插件', async () => {
    state.desktop = false
    confirmStub.mockReturnValue(true)

    await expect(confirmDialog('要这么做吗？', '移除空间')).resolves.toBe(true)

    expect(confirmStub).toHaveBeenCalledWith('要这么做吗？')
    expect(askMock).not.toHaveBeenCalled()
  })
})

describe('alertDialog', () => {
  it('桌面端走 dialog 插件的 message()，带标题与 error 图标，不触碰原生 alert', async () => {
    messageMock.mockResolvedValue('Ok')

    await expect(alertDialog('移除失败了', '移除空间')).resolves.toBeUndefined()

    expect(messageMock).toHaveBeenCalledWith('移除失败了', { title: '移除空间', kind: 'error' })
    expect(alertStub).not.toHaveBeenCalled()
  })

  it('浏览器开发态回落原生 alert()，不触碰插件', async () => {
    state.desktop = false

    await expect(alertDialog('移除失败了', '移除空间')).resolves.toBeUndefined()

    expect(alertStub).toHaveBeenCalledWith('移除失败了')
    expect(messageMock).not.toHaveBeenCalled()
  })
})
