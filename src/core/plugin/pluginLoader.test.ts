// ============================================================================
// 模块说明（中文）
// pluginLoader.ts 的单元测试：入口路径拼接、模块形状判定、加载失败的**中文报错**。
// 全部通过注入假导入器完成，不触碰 Tauri。
// ============================================================================

import { describe, expect, it, vi } from 'vitest'

import {
  isPluginModule,
  loadPluginModule,
  pluginEntryPath,
} from '@/core/plugin/pluginLoader'
import type { PluginManifest } from '@/core/plugin/manifest'

function makeManifest(over: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'com.example.demo',
    name: '演示',
    version: '1.0.0',
    description: '',
    author: '',
    main: 'index.js',
    ...over,
  }
}

describe('pluginEntryPath', () => {
  it('跟随安装目录的分隔符拼接', () => {
    expect(pluginEntryPath('C:\\Users\\lenovo\\AppData\\Roaming\\Mindscape\\plugins\\demo', 'index.js')).toBe(
      'C:\\Users\\lenovo\\AppData\\Roaming\\Mindscape\\plugins\\demo\\index.js',
    )
    expect(pluginEntryPath('E:/data/plugins/demo/', 'main.mjs')).toBe('E:/data/plugins/demo/main.mjs')
  })
})

describe('isPluginModule', () => {
  it('必须是含 activate 函数的对象', () => {
    expect(isPluginModule({ activate: () => {} })).toBe(true)
    expect(isPluginModule({ activate: () => {}, deactivate: () => {} })).toBe(true)

    expect(isPluginModule(null)).toBe(false)
    expect(isPluginModule('activate')).toBe(false)
    expect(isPluginModule({})).toBe(false)
    expect(isPluginModule({ activate: 'not-a-function' })).toBe(false)
    // deactivate 若非 undefined 必须是函数
    expect(isPluginModule({ activate: () => {}, deactivate: 1 })).toBe(false)
  })
})

describe('loadPluginModule', () => {
  it('成功：把入口绝对路径交给 resolveUrl，再用 importer 拿模块', async () => {
    const resolveUrl = vi.fn((path: string) => `asset://localhost/${path}`)
    const module = { activate: vi.fn() }
    const importer = vi.fn(async () => module)

    const loaded = await loadPluginModule('E:/data/plugins/demo', makeManifest(), {
      resolveUrl,
      importer,
    })

    expect(loaded).toBe(module)
    expect(resolveUrl).toHaveBeenCalledWith('E:/data/plugins/demo/index.js')
    expect(importer).toHaveBeenCalledWith('asset://localhost/E:/data/plugins/demo/index.js')
  })

  it('导入器抛错 → 中文「入口加载失败」错误', async () => {
    const importer = vi.fn(async () => {
      throw new Error('SyntaxError: Unexpected token')
    })

    await expect(
      loadPluginModule('E:/data/plugins/demo', makeManifest(), {
        resolveUrl: (path) => path,
        importer,
      }),
    ).rejects.toThrow(/插件「com\.example\.demo」入口加载失败/)
  })

  it('模块形状不对 → 中文「未导出 activate」错误', async () => {
    await expect(
      loadPluginModule('E:/data/plugins/demo', makeManifest(), {
        resolveUrl: (path) => path,
        importer: async () => ({ hello: 'world' }),
      }),
    ).rejects.toThrow(/未导出 activate\(api\) 函数/)
  })

  it('遵循清单里的 main 文件名', async () => {
    const resolveUrl = vi.fn((path: string) => path)
    await loadPluginModule('E:/plugins/x', makeManifest({ main: 'plugin.js' }), {
      resolveUrl,
      importer: async () => ({ activate: () => {} }),
    })
    expect(resolveUrl).toHaveBeenCalledWith('E:/plugins/x/plugin.js')
  })
})
