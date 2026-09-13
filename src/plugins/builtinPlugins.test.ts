// ============================================================================
// 模块说明（中文）
// 内置插件清单（builtinPlugins.ts）的单元测试。
//
// 清单是**只增不改**的地方，一旦有两条同 id、或写出不合规的 id，
// pluginHost 会以「后一条覆盖前一条」的方式静默处理 —— 用户只看到列表里少了一个插件。
// 这里把这些约束钉成测试。
// ============================================================================

import { describe, expect, it } from 'vitest'

import { isValidPluginId } from '@/core/plugin/manifest'
import { BUILTIN_PLUGINS } from './builtinPlugins'

describe('BUILTIN_PLUGINS', () => {
  it('至少含一个插件，且 id 不重复', () => {
    expect(BUILTIN_PLUGINS.length).toBeGreaterThan(0)
    const ids = BUILTIN_PLUGINS.map((plugin) => plugin.manifest.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每个插件 id 都是合规的反向域名（pluginHost 按它做状态键）', () => {
    for (const plugin of BUILTIN_PLUGINS) {
      expect(isValidPluginId(plugin.manifest.id), `id 不合规：${plugin.manifest.id}`).toBe(true)
    }
  })

  it('每个插件的清单元信息齐全，main 是 .js / .mjs 文件名', () => {
    for (const plugin of BUILTIN_PLUGINS) {
      const { id, name, version, description, author, main } = plugin.manifest
      for (const [field, value] of Object.entries({ id, name, version, description, author, main })) {
        expect(value.trim().length, `${id} 的 ${field} 为空`).toBeGreaterThan(0)
      }
      expect(version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(main).toMatch(/\.m?js$/)
    }
  })

  it('每个插件都导出了 activate（内置插件不走动态 import，靠它接入）', () => {
    for (const plugin of BUILTIN_PLUGINS) {
      expect(typeof plugin.activate).toBe('function')
    }
  })
})
