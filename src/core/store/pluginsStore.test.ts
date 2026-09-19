// ============================================================================
// 模块说明（中文）
// pluginsStore 的单元测试：注入假宿主，验证「转发 + 同步 + 错误落到 actionError」。
// ============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PluginHost } from '@/core/plugin/pluginHost'
import type { PluginRecord } from '@/core/plugin/types'
import { createPluginsStore } from '@/core/store/pluginsStore'
import { getRegistryVersion, registerCardType, resetPluginCenter } from '@/core/registry/pluginCenter'

function makeRecord(over: Partial<PluginRecord> = {}): PluginRecord {
  return {
    id: 'com.example.a',
    name: '演示插件',
    version: '1.0.0',
    description: '',
    author: '',
    source: 'builtin',
    installDir: null,
    main: 'index.js',
    state: 'installed',
    detail: '',
    contributions: { cardTypes: 0, menuItems: 0, canvasMenuItems: 0, hooks: 0 },
    config: {},
    ...over,
  }
}

function makeHost(over: Partial<PluginHost> = {}) {
  let listeners: (() => void)[] = []
  const host: PluginHost = {
    init: vi.fn(async () => {}),
    list: vi.fn(() => [makeRecord()]),
    lastError: vi.fn(() => null),
    enable: vi.fn(async () => {}),
    disable: vi.fn(async () => {}),
    uninstall: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    subscribe: vi.fn((listener: () => void) => {
      listeners.push(listener)
      return () => {
        listeners = listeners.filter((item) => item !== listener)
      }
    }),
    ...over,
  }
  return { host, fire: () => listeners.forEach((listener) => listener()) }
}

beforeEach(() => {
  resetPluginCenter()
})

describe('pluginsStore.load', () => {
  it('初始化宿主、订阅它，并把列表与版本号同步进来', async () => {
    const { host } = makeHost()
    const store = createPluginsStore(() => host)

    await store.getState().load()

    expect(host.init).toHaveBeenCalledTimes(1)
    expect(host.subscribe).toHaveBeenCalledTimes(1)
    expect(store.getState().status).toBe('ready')
    expect(store.getState().plugins).toHaveLength(1)
    expect(store.getState().registryVersion).toBe(getRegistryVersion())
  })

  it('宿主推变更时自动同步（订阅生效）', async () => {
    let list = [makeRecord()]
    const { host, fire } = makeHost({ list: () => list })
    const store = createPluginsStore(() => host)
    await store.getState().load()

    list = [makeRecord(), makeRecord({ id: 'com.example.b', name: '第二个' })]
    fire()

    expect(store.getState().plugins).toHaveLength(2)
  })

  it('load 失败 → status=error 且带中文提示', async () => {
    const { host } = makeHost({
      init: vi.fn(async () => {
        throw new Error('磁盘炸了')
      }),
    })
    const store = createPluginsStore(() => host)

    await store.getState().load()

    expect(store.getState().status).toBe('error')
    expect(store.getState().error).toBe('磁盘炸了')
  })

  it('宿主上报的 lastError 会进 store（plugins.json 损坏提示）', async () => {
    const { host } = makeHost({ lastError: () => 'plugins.json 解析失败；已备份为 .bak' })
    const store = createPluginsStore(() => host)

    await store.getState().load()

    expect(store.getState().error).toContain('plugins.json 解析失败')
  })
})

describe('pluginsStore 操作转发', () => {
  const cases: [keyof ReturnType<typeof makeHost>['host'], 'enable' | 'disable' | 'uninstall' | 'reload'][] = []

  it('enable / disable / uninstall / reload 都转给宿主，并清理 pendingId', async () => {
    const { host } = makeHost()
    const store = createPluginsStore(() => host)

    await store.getState().enable('com.example.a')
    await store.getState().disable('com.example.a')
    await store.getState().uninstall('com.example.a')
    await store.getState().reload('com.example.a')

    expect(host.enable).toHaveBeenCalledWith('com.example.a')
    expect(host.disable).toHaveBeenCalledWith('com.example.a')
    expect(host.uninstall).toHaveBeenCalledWith('com.example.a')
    expect(host.reload).toHaveBeenCalledWith('com.example.a')
    expect(store.getState().pendingId).toBeNull()
    void cases
  })

  it('操作抛错 → actionError 有中文提示，且不打断后续操作', async () => {
    const { host } = makeHost({
      uninstall: vi.fn(async () => {
        throw new Error('内置插件不能卸载')
      }),
    })
    const store = createPluginsStore(() => host)

    await store.getState().uninstall('com.example.a')
    expect(store.getState().actionError).toBe('内置插件不能卸载')

    // 下一个操作会先清掉上一次的错误
    await store.getState().enable('com.example.a')
    expect(store.getState().actionError).toBeNull()
  })

  it('refresh 转给宿主', async () => {
    const { host } = makeHost()
    const store = createPluginsStore(() => host)

    await store.getState().refresh()

    expect(host.refresh).toHaveBeenCalledTimes(1)
  })

  it('clearActionError 手动清错', async () => {
    const { host } = makeHost({
      enable: vi.fn(async () => {
        throw new Error('坏了')
      }),
    })
    const store = createPluginsStore(() => host)
    await store.getState().enable('x')
    expect(store.getState().actionError).toBe('坏了')

    store.getState().clearActionError()
    expect(store.getState().actionError).toBeNull()
  })
})

describe('pluginsStore 与注册表版本号', () => {
  it('注册表变化后同步进 store（渲染层据此重取菜单/卡片类型）', async () => {
    const { host, fire } = makeHost()
    const store = createPluginsStore(() => host)
    await store.getState().load()

    const before = store.getState().registryVersion
    registerCardType({ type: 'x', render: () => null, menu: [], defaultSize: { w: 1, h: 1 } })
    fire()

    expect(store.getState().registryVersion).toBeGreaterThan(before)
  })
})
