// ============================================================================
// 模块说明（中文）
// 启动引导（bootstrap.ts）的集成测试。
//
// 这是插件系统**唯一一条端到端被覆盖的路径**：
//   bootstrapPlugins() → configurePluginHost(内置清单) → host.init()
//     → 读 plugins.json（node 环境下必然失败）→ 登记内置插件 → 激活 → 注册生效
//
// 之所以能在 node 环境跑完整条链：
//   · 磁盘 I/O 在宿主内部就被 try/catch 兜住了（读失败只是 lastError，不抛）；
//   · 内置插件的 activate 只调 pluginCenter 的注册函数，不碰 Tauri。
// 于是它顺带证明了「插件系统坏掉不影响应用启动」这条兜底策略真的成立。
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getPluginHost, resetPluginHost } from '@/core/plugin/pluginHost'
import { listRegisteredCanvasMenuItems, resetPluginCenter } from '@/core/registry/pluginCenter'
import { bootstrapPlugins } from './bootstrap'
import { COLOR_CARD_MENU_ITEM_ID, COLOR_CARD_PLUGIN_ID } from './colorCard'

beforeEach(() => {
  resetPluginCenter()
  resetPluginHost()
})

afterEach(() => {
  resetPluginCenter()
  resetPluginHost()
  vi.restoreAllMocks()
})

describe('bootstrapPlugins', () => {
  it('内置色卡插件完成激活并注册画布菜单项（非桌面环境也能走到这一步）', async () => {
    // node 环境没有 Tauri：读写 plugins.json 与扫描外部目录都会失败并被吞掉，
    // 宿主会把失败记进 lastError 并打日志 —— 这里静音它，免得测试输出变脏
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const host = await bootstrapPlugins()

    expect(listRegisteredCanvasMenuItems().map((item) => item.id)).toContain(COLOR_CARD_MENU_ITEM_ID)

    const record = host.list().find((item) => item.id === COLOR_CARD_PLUGIN_ID)
    expect(record).toBeDefined()
    expect(record?.source).toBe('builtin')
    expect(record?.state).toBe('active')
    expect(record?.contributions.canvasMenuItems).toBe(1)

    error.mockRestore()
  })

  it('返回的宿主就是应用级单例（设置页插件列表读的是同一个）', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const host = await bootstrapPlugins()

    expect(getPluginHost()).toBe(host)
  })

  it('不会抛错（插件系统故障绝不能拖垮应用启动）', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(bootstrapPlugins()).resolves.toBeDefined()
  })
})
