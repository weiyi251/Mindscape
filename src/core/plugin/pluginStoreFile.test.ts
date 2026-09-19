// ============================================================================
// 模块说明（中文）
// plugins.json 读写层的纯逻辑单元测试（不触碰 Tauri，只测解释 / 序列化 / 校验）。
// ============================================================================

import { describe, expect, it } from 'vitest'

import {
  PLUGINS_FILE_VERSION,
  createEmptyPluginsFile,
  interpretPluginsText,
  migratePluginsFile,
  parsePluginsFile,
  serializePluginsFile,
} from '@/core/plugin/pluginStoreFile'
import type { PluginFileMigration, PluginsFile } from '@/core/plugin/pluginStoreFile'

describe('createEmptyPluginsFile', () => {
  it('首次运行为空列表，版本号为 PLUGINS_FILE_VERSION', () => {
    const file = createEmptyPluginsFile()
    expect(file.plugins).toEqual([])
    expect(file.version).toBe(PLUGINS_FILE_VERSION)
  })
})

describe('parsePluginsFile', () => {
  it('合法文件：字段缺省被补全', () => {
    const result = parsePluginsFile(JSON.stringify({ plugins: [{ id: 'com.example.a' }] }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.plugins[0]).toEqual({
      id: 'com.example.a',
      enabled: false,
      source: 'external',
      version: '0.0.0',
      dir: null,
      config: {},
    })
  })

  it('保留完整字段', () => {
    const result = parsePluginsFile(
      JSON.stringify({
        version: 1,
        plugins: [
          {
            id: 'com.example.b',
            enabled: true,
            source: 'builtin',
            version: '1.2.3',
            dir: 'E:/data/plugins/b',
            config: { outputDir: 'E:/色卡' },
          },
        ],
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.plugins[0].enabled).toBe(true)
    expect(result.data.plugins[0].source).toBe('builtin')
    expect(result.data.plugins[0].config).toEqual({ outputDir: 'E:/色卡' })
  })

  it('非法来源被拒；JSON 语法错误给出中文原因', () => {
    expect(parsePluginsFile(JSON.stringify({ plugins: [{ id: 'x', source: 'cloud' }] })).ok).toBe(
      false,
    )
    const broken = parsePluginsFile('{oops')
    expect(broken.ok).toBe(false)
    if (!broken.ok) expect(broken.error).toContain('JSON 解析失败')
  })
})

describe('migratePluginsFile', () => {
  it('当前版本数据原样通过，不标记 changed', () => {
    const raw = { version: 1, plugins: [{ id: 'com.example.a', enabled: true }] }
    const result = migratePluginsFile(raw)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.changed).toBe(false)
    expect(result.data.plugins[0].id).toBe('com.example.a')
  })

  it('缺 version 的最老数据：补默认字段并盖上当前版本号（changed=true）', () => {
    const result = migratePluginsFile({ plugins: [{ id: 'com.example.old' }] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.changed).toBe(true)
    expect(result.data.version).toBe(PLUGINS_FILE_VERSION)
    expect(result.data.plugins[0]).toMatchObject({ id: 'com.example.old', enabled: false })
  })

  it('未来版本拒绝加载，错误说明新旧版本', () => {
    const result = migratePluginsFile({ version: PLUGINS_FILE_VERSION + 9, plugins: [] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('高于当前应用支持')
    expect(result.error).toContain(`v${PLUGINS_FILE_VERSION}`)
  })

  it('注入的迁移步骤按登记顺序执行', () => {
    const calls: number[] = []
    const migrations: readonly PluginFileMigration[] = [
      {
        from: 1,
        migrate: (raw) => {
          calls.push(1)
          return { ...raw, migratedOnce: true }
        },
      },
      {
        from: 2,
        migrate: (raw) => {
          calls.push(2)
          return { ...raw, migratedTwice: true }
        },
      },
    ]
    // version 缺失按 0 处理：两条步骤都命中
    const result = migratePluginsFile({ plugins: [] }, migrations)
    expect(result.ok).toBe(true)
    expect(calls).toEqual([1, 2])
  })

  it('from 低于数据版本的步骤被跳过', () => {
    const calls: number[] = []
    const migrations: readonly PluginFileMigration[] = [
      {
        from: 0,
        migrate: (raw) => {
          calls.push(0)
          return raw
        },
      },
    ]
    const result = migratePluginsFile({ version: 1, plugins: [] }, migrations)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(calls).toEqual([])
    expect(result.changed).toBe(false)
  })

  it('迁移后的数据 version 盖章为当前版本', () => {
    const migrations: readonly PluginFileMigration[] = [
      { from: 1, migrate: (raw) => ({ ...raw }) },
    ]
    const result = migratePluginsFile({ version: 1, plugins: [] }, migrations)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.version).toBe(PLUGINS_FILE_VERSION)
  })
})

describe('interpretPluginsText', () => {
  it('空文本视为空列表且不算损坏', () => {
    for (const text of ['', '   ', '\n\t']) {
      const result = interpretPluginsText(text)
      expect(result.corrupted).toBe(false)
      expect(result.file.plugins).toEqual([])
    }
  })

  it('损坏内容：标记 corrupted 并带原因，不抛错', () => {
    const result = interpretPluginsText('{"plugins": "not-an-array"}')
    expect(result.corrupted).toBe(true)
    expect(result.error).toBeTruthy()
    expect(result.file.plugins).toEqual([])
  })

  it('合法内容原样解释', () => {
    const text = JSON.stringify({ plugins: [{ id: 'com.example.c', enabled: true }] })
    const result = interpretPluginsText(text)
    expect(result.corrupted).toBe(false)
    expect(result.file.plugins).toHaveLength(1)
    expect(result.file.plugins[0].enabled).toBe(true)
  })
})

describe('serializePluginsFile', () => {
  it('两空格缩进 + 末尾换行，且能往返解析', () => {
    const file: PluginsFile = {
      version: 1,
      plugins: [
        {
          id: 'com.example.roundtrip',
          enabled: true,
          source: 'external',
          version: '0.1.0',
          dir: 'E:/data/plugins/rt',
          config: { nested: { a: 1 } },
        },
      ],
    }
    const text = serializePluginsFile(file)

    expect(text.endsWith('\n')).toBe(true)
    expect(text).toContain('\n  "plugins"')

    const parsed = parsePluginsFile(text)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.data).toEqual(file)
  })
})
