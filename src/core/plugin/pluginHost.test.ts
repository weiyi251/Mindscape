// ============================================================================
// 模块说明（中文）
// pluginHost 的单元测试：发现 / 校验 / 激活 / 停用 / 卸载 / 重载 / 状态持久化。
//
// 全部通过注入假实现完成（假 plugins.json 网关、假扫描、假导入器、假删除），
// 不读真实磁盘、不起 Tauri —— 这正是把 options 设计成可注入的目的。
// ============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createPluginHost } from '@/core/plugin/pluginHost'
import type { ExternalPluginCandidate } from '@/core/plugin/pluginHost'
import { createEmptyPluginsFile } from '@/core/plugin/pluginStoreFile'
import type { PluginsFile } from '@/core/plugin/pluginStoreFile'
import type { BuiltinPluginDescriptor, PluginHostApi } from '@/core/plugin/types'
import {
  getRegisteredCardType,
  listRegisteredCanvasMenuItems,
  resetPluginCenter,
} from '@/core/registry/pluginCenter'
import type { CardTypeDef, CanvasMenuItem } from '@/core/registry/pluginCenter'

// ---------------------------------------------------------------------------
// 测试替身
// ---------------------------------------------------------------------------

function makeCardType(type: string): CardTypeDef {
  return { type, render: () => null, menu: [], defaultSize: { w: 10, h: 10 } }
}

function makeCanvasMenuItem(id: string): CanvasMenuItem {
  return { id, label: `画布项 ${id}`, action: () => {} }
}

/** 造一个内置插件描述符；activate 默认注册一个卡片类型 + 一个画布菜单项 */
function makeBuiltin(
  id: string,
  over: { name?: string; version?: string; activate?: BuiltinPluginDescriptor['activate']; deactivate?: () => void } = {},
): BuiltinPluginDescriptor {
  const name = over.name ?? `内置-${id}`
  return {
    manifest: { id, name, version: over.version ?? '1.0.0', description: '', author: '', main: 'index.js' },
    activate:
      over.activate ??
      ((api: PluginHostApi) => {
        api.registerCardType(makeCardType(`card-of-${id}`))
        api.registerCanvasMenuItem(makeCanvasMenuItem(`canvas-of-${id}`))
      }),
    deactivate: over.deactivate,
  }
}

/** 假的 plugins.json 网关：内存态 + 可读回最后一次落盘内容 */
function makeGateway(initial?: PluginsFile) {
  const state = { file: initial ?? createEmptyPluginsFile() }
  return {
    gateway: {
      load: async () => ({ file: state.file, corrupted: false }),
      save: async (file: PluginsFile) => {
        state.file = file
      },
    },
    saved: () => state.file,
    entryOf: (id: string) => state.file.plugins.find((item) => item.id === id),
  }
}

/** 假的动态加载器：按入口绝对路径查表 */
function makeLoader(modules: Map<string, unknown>) {
  return {
    resolveUrl: (path: string) => path,
    importer: async (url: string) => {
      if (!modules.has(url)) throw new Error(`模块不存在：${url}`)
      return modules.get(url)
    },
  }
}

function externalCandidate(id: string, installDir: string, extra: Record<string, unknown> = {}): ExternalPluginCandidate {
  return {
    installDir,
    manifestText: JSON.stringify({ id, name: `外部-${id}`, version: '0.1.0', ...extra }),
  }
}

beforeEach(() => {
  resetPluginCenter()
})

// ---------------------------------------------------------------------------
// 发现：内置 + 外部
// ---------------------------------------------------------------------------

describe('init 发现插件', () => {
  it('内置插件首次登记即启用（随应用发布的第一方能力），带版本与来源', async () => {
    const host = createPluginHost({
      builtins: [makeBuiltin('com.example.builtin', { name: '演示色卡', version: '2.3.1' })],
      gateway: makeGateway().gateway,
      scanExternal: async () => [],
    })

    await host.init()

    expect(host.list()).toHaveLength(1)
    expect(host.list()[0]).toMatchObject({
      id: 'com.example.builtin',
      name: '演示色卡',
      version: '2.3.1',
      source: 'builtin',
      // 2026-09-14：内置插件默认启用（否则用户得先去设置页点一次「启用」才能用）；
      // 已登记过的记录一律尊重用户的选择，见 pluginHost.registerBuiltins 的注释
      state: 'active',
      installDir: null,
    })
    expect(host.lastError()).toBeNull()
  })

  it('外部插件从安装目录被扫描出来，且只登记不自动启用', async () => {
    const host = createPluginHost({
      gateway: makeGateway().gateway,
      scanExternal: async () => [externalCandidate('com.example.color', 'E:/plugins/color')],
    })

    await host.init()

    expect(host.list()).toHaveLength(1)
    expect(host.list()[0]).toMatchObject({
      id: 'com.example.color',
      source: 'external',
      // 外部插件默认「已安装」不启用：用户从别处拿来的插件应先看清再启用
      state: 'installed',
      version: '0.1.0',
      installDir: 'E:/plugins/color',
    })
  })

  it('清单不合格的外部插件登记为「不可用」并带中文原因（用户能看到并卸载它）', async () => {
    const host = createPluginHost({
      gateway: makeGateway().gateway,
      scanExternal: async () => [{ installDir: 'E:/plugins/broken', manifestText: '{ not json' }],
    })

    await host.init()

    const [record] = host.list()
    expect(record.state).toBe('invalid')
    expect(record.source).toBe('external')
    expect(record.detail).toContain('JSON')
    expect(record.name).toContain('清单无效')
  })

  it('内置在前、外部分在后；同组按名称排序', async () => {
    const host = createPluginHost({
      builtins: [makeBuiltin('com.example.z', { name: '乙' }), makeBuiltin('com.example.a', { name: '甲' })],
      gateway: makeGateway().gateway,
      scanExternal: async () => [externalCandidate('com.example.ext', 'E:/plugins/ext')],
    })

    await host.init()

    expect(host.list().map((item) => item.name)).toEqual(['甲', '乙', '外部-com.example.ext'])
  })

  it('plugins.json 损坏 → lastError 有中文提示，但仍能发现插件', async () => {
    const host = createPluginHost({
      builtins: [makeBuiltin('com.example.a')],
      gateway: {
        load: async () => ({ file: createEmptyPluginsFile(), corrupted: true, error: '数据校验失败：根' }),
        save: async () => {},
      },
      scanExternal: async () => [],
    })

    await host.init()

    expect(host.lastError()).toContain('数据校验失败：根')
    expect(host.lastError()).toContain('plugins.json.bak')
    expect(host.list()).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 激活 / 停用
// ---------------------------------------------------------------------------

describe('enable / disable', () => {
  it('启用内置插件：注册生效、状态变 active、贡献计数正确、enabled 落盘', async () => {
    const fake = makeGateway()
    const host = createPluginHost({
      builtins: [makeBuiltin('com.example.a')],
      gateway: fake.gateway,
      scanExternal: async () => [],
    })
    await host.init()

    await host.enable('com.example.a')

    expect(getRegisteredCardType('card-of-com.example.a')).toBeDefined()
    expect(listRegisteredCanvasMenuItems().map((item) => item.id)).toEqual(['canvas-of-com.example.a'])

    const record = host.list()[0]
    expect(record.state).toBe('active')
    expect(record.contributions).toMatchObject({ cardTypes: 1, canvasMenuItems: 1 })
    expect(record.detail).toContain('卡片类型 1')
    expect(fake.entryOf('com.example.a')?.enabled).toBe(true)
    expect(fake.entryOf('com.example.a')?.version).toBe('1.0.0')
  })

  it('停用：注册被回收、状态变 inactive、enabled 落盘为 false', async () => {
    const fake = makeGateway()
    const host = createPluginHost({
      builtins: [makeBuiltin('com.example.a')],
      gateway: fake.gateway,
      scanExternal: async () => [],
    })
    await host.init()
    await host.enable('com.example.a')
    await host.disable('com.example.a')

    expect(getRegisteredCardType('card-of-com.example.a')).toBeUndefined()
    expect(listRegisteredCanvasMenuItems()).toHaveLength(0)

    const record = host.list()[0]
    expect(record.state).toBe('inactive')
    expect(record.contributions).toMatchObject({ cardTypes: 0, canvasMenuItems: 0 })
    expect(fake.entryOf('com.example.a')?.enabled).toBe(false)
  })

  it('重复启用是幂等的（不重复注册、不报错）', async () => {
    const host = createPluginHost({
      builtins: [makeBuiltin('com.example.a')],
      gateway: makeGateway().gateway,
      scanExternal: async () => [],
    })
    await host.init()
    await host.enable('com.example.a')
    await host.enable('com.example.a')

    expect(host.list()[0].contributions.cardTypes).toBe(1)
  })

  it('deactivate 抛错不影响停用结果（注册照样回收）', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const host = createPluginHost({
      builtins: [
        makeBuiltin('com.example.a', {
          deactivate: () => {
            throw new Error('插件自己炸了')
          },
        }),
      ],
      gateway: makeGateway().gateway,
      scanExternal: async () => [],
    })
    await host.init()
    await host.enable('com.example.a')

    await expect(host.disable('com.example.a')).resolves.toBeUndefined()
    expect(getRegisteredCardType('card-of-com.example.a')).toBeUndefined()
    expect(host.list()[0].state).toBe('inactive')
    error.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// 失败隔离
// ---------------------------------------------------------------------------

describe('插件抛错只影响自己', () => {
  it('activate 抛错 → 状态 error、带原因、半途注册被回收、不向外抛', async () => {
    const host = createPluginHost({
      builtins: [
        makeBuiltin('com.example.bad', {
          activate: (api: PluginHostApi) => {
            api.registerCardType(makeCardType('half-baked'))
            throw new Error('注册到一半炸了')
          },
        }),
      ],
      gateway: makeGateway().gateway,
      scanExternal: async () => [],
    })
    await host.init()

    await expect(host.enable('com.example.bad')).resolves.toBeUndefined()

    expect(getRegisteredCardType('half-baked')).toBeUndefined()
    const record = host.list()[0]
    expect(record.state).toBe('error')
    expect(record.detail).toContain('注册到一半炸了')
    expect(record.contributions.cardTypes).toBe(0)
  })

  it('一个插件炸掉不影响另一个', async () => {
    const host = createPluginHost({
      builtins: [
        makeBuiltin('com.example.bad', {
          activate: () => {
            throw new Error('坏的')
          },
        }),
        makeBuiltin('com.example.good', { name: '好的' }),
      ],
      gateway: makeGateway().gateway,
      scanExternal: async () => [],
    })
    await host.init()

    await host.enable('com.example.bad')
    await host.enable('com.example.good')

    const byId = (id: string) => host.list().find((item) => item.id === id)!
    expect(byId('com.example.bad').state).toBe('error')
    expect(byId('com.example.good').state).toBe('active')
    expect(getRegisteredCardType('card-of-com.example.good')).toBeDefined()
  })

  it('出错的插件可以重试启用', async () => {
    let shouldFail = true
    const host = createPluginHost({
      builtins: [
        makeBuiltin('com.example.flaky', {
          activate: (api: PluginHostApi) => {
            if (shouldFail) throw new Error('暂时失败')
            api.registerCardType(makeCardType('flaky-card'))
          },
        }),
      ],
      gateway: makeGateway().gateway,
      scanExternal: async () => [],
    })
    await host.init()

    await host.enable('com.example.flaky')
    expect(host.list()[0].state).toBe('error')

    shouldFail = false
    await host.enable('com.example.flaky')
    expect(host.list()[0].state).toBe('active')
    expect(getRegisteredCardType('flaky-card')).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// 外部插件：动态加载
// ---------------------------------------------------------------------------

describe('外部插件动态加载', () => {
  it('启用时走注入的导入器，注册真正生效', async () => {
    const modules = new Map<string, unknown>([
      [
        'E:/plugins/color/index.js',
        {
          activate: (api: PluginHostApi) => {
            api.registerCanvasMenuItem(makeCanvasMenuItem('color.new'))
          },
        },
      ],
    ])

    const host = createPluginHost({
      gateway: makeGateway().gateway,
      scanExternal: async () => [externalCandidate('com.example.color', 'E:/plugins/color')],
      loader: makeLoader(modules),
    })
    await host.init()
    await host.enable('com.example.color')

    expect(listRegisteredCanvasMenuItems().map((item) => item.id)).toEqual(['color.new'])
    expect(host.list()[0].state).toBe('active')
    expect(host.list()[0].detail).toContain('画布菜单项 1')
  })

  it('入口模块形状不对 → error，且带中文原因', async () => {
    const modules = new Map<string, unknown>([['E:/plugins/color/index.js', { nothing: true }]])

    const host = createPluginHost({
      gateway: makeGateway().gateway,
      scanExternal: async () => [externalCandidate('com.example.color', 'E:/plugins/color')],
      loader: makeLoader(modules),
    })
    await host.init()
    await host.enable('com.example.color')

    expect(host.list()[0].state).toBe('error')
    expect(host.list()[0].detail).toContain('未导出 activate(api) 函数')
  })

  it('遵循清单里的 main 文件名', async () => {
    const modules = new Map<string, unknown>([
      ['E:/plugins/color/plugin.js', { activate: () => {} }],
    ])

    const host = createPluginHost({
      gateway: makeGateway().gateway,
      scanExternal: async () => [
        externalCandidate('com.example.color', 'E:/plugins/color', { main: 'plugin.js' }),
      ],
      loader: makeLoader(modules),
    })
    await host.init()
    await host.enable('com.example.color')

    expect(host.list()[0].state).toBe('active')
  })
})

// ---------------------------------------------------------------------------
// 卸载
// ---------------------------------------------------------------------------

describe('uninstall', () => {
  it('外部插件：删除安装目录、移出列表、**配置保留**', async () => {
    const removeDir = vi.fn(async () => {})
    const fake = makeGateway({
      version: 1,
      plugins: [
        {
          id: 'com.example.color',
          enabled: false,
          source: 'external',
          version: '0.1.0',
          dir: 'E:/plugins/color',
          config: { outputDir: 'E:/色卡输出' },
        },
      ],
    })

    const host = createPluginHost({
      gateway: fake.gateway,
      scanExternal: async () => [externalCandidate('com.example.color', 'E:/plugins/color')],
      loader: makeLoader(new Map([['E:/plugins/color/index.js', { activate: () => {} }]])),
      removeDir,
    })
    await host.init()
    await host.uninstall('com.example.color')

    expect(removeDir).toHaveBeenCalledWith('E:/plugins/color')
    expect(host.list()).toHaveLength(0)

    const kept = fake.entryOf('com.example.color')
    expect(kept).toBeDefined()
    expect(kept?.dir).toBeNull()
    expect(kept?.enabled).toBe(false)
    expect(kept?.config).toEqual({ outputDir: 'E:/色卡输出' })
  })

  it('内置插件不能卸载（中文报错）', async () => {
    const host = createPluginHost({
      builtins: [makeBuiltin('com.example.a')],
      gateway: makeGateway().gateway,
      scanExternal: async () => [],
    })
    await host.init()

    await expect(host.uninstall('com.example.a')).rejects.toThrow(/不能卸载/)
    expect(host.list()).toHaveLength(1)
  })

  it('卸载运行中的插件会先停用（注册被回收）', async () => {
    const fake = makeGateway({
      version: 1,
      plugins: [
        {
          id: 'com.example.color',
          enabled: true,
          source: 'external',
          version: '0.1.0',
          dir: 'E:/plugins/color',
          config: {},
        },
      ],
    })

    const host = createPluginHost({
      gateway: fake.gateway,
      scanExternal: async () => [externalCandidate('com.example.color', 'E:/plugins/color')],
      loader: makeLoader(
        new Map([
          [
            'E:/plugins/color/index.js',
            { activate: (api: PluginHostApi) => api.registerCanvasMenuItem(makeCanvasMenuItem('color.new')) },
          ],
        ]),
      ),
      removeDir: async () => {},
    })
    await host.init()
    expect(listRegisteredCanvasMenuItems()).toHaveLength(1)

    await host.uninstall('com.example.color')
    expect(listRegisteredCanvasMenuItems()).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 重新加载（外部插件的「更新」）
// ---------------------------------------------------------------------------

describe('reload', () => {
  it('替换成新版本后重新加载：版本号更新并可再次启用', async () => {
    let manifestText = JSON.stringify({ id: 'com.example.color', name: '色卡', version: '0.1.0' })

    const host = createPluginHost({
      gateway: makeGateway().gateway,
      scanExternal: async () => [{ installDir: 'E:/plugins/color', manifestText }],
      readManifest: async () => manifestText,
      loader: makeLoader(new Map([['E:/plugins/color/index.js', { activate: () => {} }]])),
    })
    await host.init()
    expect(host.list()[0].version).toBe('0.1.0')

    // 用户把新版本文件替换进安装目录
    manifestText = JSON.stringify({ id: 'com.example.color', name: '色卡', version: '0.2.0' })
    await host.reload('com.example.color')

    expect(host.list()[0].version).toBe('0.2.0')
    expect(host.list()[0].state).toBe('installed')
  })

  it('运行中重载：先停用再启用，注册不重复也不丢失', async () => {
    const manifestText = JSON.stringify({ id: 'com.example.color', name: '色卡', version: '0.1.0' })
    const host = createPluginHost({
      gateway: makeGateway().gateway,
      scanExternal: async () => [{ installDir: 'E:/plugins/color', manifestText }],
      readManifest: async () => manifestText,
      loader: makeLoader(
        new Map([
          [
            'E:/plugins/color/index.js',
            { activate: (api: PluginHostApi) => api.registerCanvasMenuItem(makeCanvasMenuItem('color.new')) },
          ],
        ]),
      ),
    })
    await host.init()
    await host.enable('com.example.color')
    expect(listRegisteredCanvasMenuItems()).toHaveLength(1)

    await host.reload('com.example.color')

    expect(host.list()[0].state).toBe('active')
    expect(listRegisteredCanvasMenuItems()).toHaveLength(1)
  })

  it('清单损坏 → 状态 invalid（中文原因）', async () => {
    let manifestText = JSON.stringify({ id: 'com.example.color', name: '色卡', version: '0.1.0' })
    const host = createPluginHost({
      gateway: makeGateway().gateway,
      scanExternal: async () => [{ installDir: 'E:/plugins/color', manifestText }],
      readManifest: async () => manifestText,
      loader: makeLoader(new Map([['E:/plugins/color/index.js', { activate: () => {} }]])),
    })
    await host.init()

    manifestText = '{ broken'
    await host.reload('com.example.color')

    const record = host.list()[0]
    expect(record.state).toBe('invalid')
    expect(record.detail).toContain('JSON 解析失败')
  })

  it('安装目录里没有清单 → 状态 invalid，中文说明', async () => {
    let manifestText = JSON.stringify({ id: 'com.example.color', name: '色卡', version: '0.1.0' })
    const host = createPluginHost({
      gateway: makeGateway().gateway,
      scanExternal: async () => [{ installDir: 'E:/plugins/color', manifestText }],
      readManifest: async () => (manifestText === '' ? null : manifestText),
      loader: makeLoader(new Map([['E:/plugins/color/index.js', { activate: () => {} }]])),
    })
    await host.init()

    manifestText = ''
    await host.reload('com.example.color')

    expect(host.list()[0].state).toBe('invalid')
    expect(host.list()[0].detail).toContain('没有 manifest.json')
  })

  it('内置插件不需重载（中文报错）', async () => {
    const host = createPluginHost({
      builtins: [makeBuiltin('com.example.a')],
      gateway: makeGateway().gateway,
      scanExternal: async () => [],
    })
    await host.init()
    await expect(host.reload('com.example.a')).rejects.toThrow(/无需重新加载/)
  })
})

// ---------------------------------------------------------------------------
// 启动时恢复启用状态
// ---------------------------------------------------------------------------

describe('启动时恢复启用状态', () => {
  it('plugins.json 里 enabled 的插件在 init 时被自动激活', async () => {
    const fake = makeGateway({
      version: 1,
      plugins: [
        { id: 'com.example.a', enabled: true, source: 'builtin', version: '1.0.0', dir: null, config: {} },
      ],
    })

    const host = createPluginHost({
      builtins: [makeBuiltin('com.example.a')],
      gateway: fake.gateway,
      scanExternal: async () => [],
    })
    await host.init()

    expect(host.list()[0].state).toBe('active')
    expect(getRegisteredCardType('card-of-com.example.a')).toBeDefined()
  })

  it('曾经启用过的插件在未启用时显示「已停用」', async () => {
    const fake = makeGateway({
      version: 1,
      plugins: [
        { id: 'com.example.a', enabled: false, source: 'builtin', version: '1.0.0', dir: null, config: {} },
      ],
    })

    const host = createPluginHost({
      builtins: [makeBuiltin('com.example.a')],
      gateway: fake.gateway,
      scanExternal: async () => [],
    })
    await host.init()

    expect(host.list()[0].state).toBe('inactive')
  })
})

// ---------------------------------------------------------------------------
// 刷新与订阅
// ---------------------------------------------------------------------------

describe('refresh / subscribe', () => {
  it('refresh 能发现新放进目录的外部插件', async () => {
    let candidates: ExternalPluginCandidate[] = []
    const host = createPluginHost({
      gateway: makeGateway().gateway,
      scanExternal: async () => candidates,
    })
    await host.init()
    expect(host.list()).toHaveLength(0)

    candidates = [externalCandidate('com.example.new', 'E:/plugins/new')]
    await host.refresh()

    expect(host.list().map((item) => item.id)).toEqual(['com.example.new'])
  })

  it('refresh 会移除安装目录已消失的插件', async () => {
    let candidates: ExternalPluginCandidate[] = [
      externalCandidate('com.example.gone', 'E:/plugins/gone'),
    ]
    const host = createPluginHost({
      gateway: makeGateway().gateway,
      scanExternal: async () => candidates,
    })
    await host.init()
    expect(host.list()).toHaveLength(1)

    candidates = []
    await host.refresh()

    expect(host.list()).toHaveLength(0)
  })

  it('subscribe 在状态变化时被触发，取消订阅后不再收到', async () => {
    const listener = vi.fn()
    const host = createPluginHost({
      builtins: [makeBuiltin('com.example.a')],
      gateway: makeGateway().gateway,
      scanExternal: async () => [],
    })

    const unsubscribe = host.subscribe(listener)
    await host.init()
    expect(listener).toHaveBeenCalled()

    const callsAfterInit = listener.mock.calls.length
    // 内置插件在 init 里就已经被激活（默认启用），重复 enable 是幂等的、不会通知；
    // 因此这里用「停用」制造一次真实的状态变化
    await host.disable('com.example.a')
    expect(listener.mock.calls.length).toBeGreaterThan(callsAfterInit)

    unsubscribe()
    const callsAfterUnsubscribe = listener.mock.calls.length
    await host.enable('com.example.a')
    expect(listener.mock.calls.length).toBe(callsAfterUnsubscribe)
  })
})

// ---------------------------------------------------------------------------
// 插件配置
// ---------------------------------------------------------------------------

describe('插件配置（config）', () => {
  it('activate 里通过 api.config.set 写入的配置会落盘，并在记录上可见', async () => {
    const fake = makeGateway()
    const host = createPluginHost({
      builtins: [
        makeBuiltin('com.example.a', {
          activate: async (api: PluginHostApi) => {
            await api.config.set({ outputDir: 'E:/色卡输出' })
          },
        }),
      ],
      gateway: fake.gateway,
      scanExternal: async () => [],
    })
    await host.init()
    await host.enable('com.example.a')

    expect(fake.entryOf('com.example.a')?.config).toEqual({ outputDir: 'E:/色卡输出' })
    expect(host.list()[0].config).toEqual({ outputDir: 'E:/色卡输出' })
  })

  it('api.config.set 是浅合并', async () => {
    const fake = makeGateway({
      version: 1,
      plugins: [
        {
          id: 'com.example.a',
          enabled: false,
          source: 'builtin',
          version: '1.0.0',
          dir: null,
          config: { a: 1, b: 2 },
        },
      ],
    })
    const host = createPluginHost({
      builtins: [
        makeBuiltin('com.example.a', {
          activate: async (api: PluginHostApi) => {
            await api.config.set({ b: 20, c: 30 })
          },
        }),
      ],
      gateway: fake.gateway,
      scanExternal: async () => [],
    })
    await host.init()
    await host.enable('com.example.a')

    expect(fake.entryOf('com.example.a')?.config).toEqual({ a: 1, b: 20, c: 30 })
  })
})
