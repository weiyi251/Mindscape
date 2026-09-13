// ============================================================================
// 模块说明（中文）
// plugins.json 读写层的纯逻辑单元测试（不触碰 Tauri，只测解释 / 序列化 / 校验）。
// ============================================================================

import { describe, expect, it } from 'vitest'

import {
  createEmptyPluginsFile,
  interpretPluginsText,
  parsePluginsFile,
  serializePluginsFile,
} from '@/core/plugin/pluginStoreFile'
import type { PluginsFile } from '@/core/plugin/pluginStoreFile'

describe('createEmptyPluginsFile', () => {
  it('首次运行为空列表，版本号走 DATA_VERSION', () => {
    const file = createEmptyPluginsFile()
    expect(file.plugins).toEqual([])
    expect(file.version).toBe(1)
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
