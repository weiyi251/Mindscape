// ============================================================================
// 模块说明（中文）
// manifest.ts 的单元测试：正常清单、字段缺省、以及**安全边界**（id / main）。
// ============================================================================

import { describe, expect, it } from 'vitest'

import {
  isValidPluginId,
  parseManifest,
  serializeManifest,
  zPluginManifestSchema,
} from '@/core/plugin/manifest'

/** 造一个合法清单文本；可用 over 覆盖任意字段 */
function manifestText(over: Record<string, unknown> = {}): string {
  return JSON.stringify({ id: 'com.example.hello', name: '示例插件', version: '1.0.0', ...over })
}

describe('parseManifest', () => {
  it('合法清单：给出规范化结果并补全缺省字段', () => {
    const result = parseManifest(manifestText())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toEqual({
      id: 'com.example.hello',
      name: '示例插件',
      version: '1.0.0',
      description: '',
      author: '',
      main: 'index.js',
    })
  })

  it('保留显式给出的可选字段', () => {
    const result = parseManifest(
      manifestText({ description: '色卡生成', author: 'weiyi251', main: 'plugin.js' }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.description).toBe('色卡生成')
    expect(result.data.author).toBe('weiyi251')
    expect(result.data.main).toBe('plugin.js')
  })

  it('mjs 入口也接受', () => {
    const result = parseManifest(manifestText({ main: 'index.mjs' }))
    expect(result.ok).toBe(true)
  })

  it('空文本给出中文提示', () => {
    const result = parseManifest('   ')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('清单文件为空')
  })

  it('JSON 语法错误给出中文提示', () => {
    const result = parseManifest('{ id: ')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('JSON 解析失败')
  })

  it('缺字段 / 名称空 / 版本空都被拒绝', () => {
    expect(parseManifest(JSON.stringify({ name: 'x', version: '1.0.0' })).ok).toBe(false)
    expect(parseManifest(manifestText({ name: '' })).ok).toBe(false)
    expect(parseManifest(manifestText({ version: '' })).ok).toBe(false)
  })
})

describe('parseManifest 的安全边界（不可信输入）', () => {
  it('id 必须是反向域名风格：大写 / 单段 / 带下划线都被拒', () => {
    for (const bad of ['Hello', 'hello', 'com example', 'com.example_1', '.com.example', 'com..example']) {
      expect(parseManifest(manifestText({ id: bad })).ok, `应拒绝 id=${bad}`).toBe(false)
    }
  })

  it('main 不能含路径分隔符（防路径穿越）', () => {
    for (const bad of ['../evil.js', 'sub/index.js', 'sub\\index.js', '..\\evil.js', 'C:\\evil.js']) {
      expect(parseManifest(manifestText({ main: bad })).ok, `应拒绝 main=${bad}`).toBe(false)
    }
  })

  it('main 必须是 js / mjs', () => {
    expect(parseManifest(manifestText({ main: 'index.ts' })).ok).toBe(false)
    expect(parseManifest(manifestText({ main: 'payload.exe' })).ok).toBe(false)
  })

  it('isValidPluginId 与 schema 的判定一致', () => {
    expect(isValidPluginId('com.example.hello')).toBe(true)
    expect(isValidPluginId('io.github.weiyi251.color-card')).toBe(true)
    expect(isValidPluginId('Bad')).toBe(false)
    expect(isValidPluginId('com.')).toBe(false)
  })

  it('schema 与 parseManifest 的判定一致（同一份规则，不会漂移）', () => {
    const samples = [
      manifestText(),
      manifestText({ id: 'BAD' }),
      manifestText({ main: '../x.js' }),
    ]
    for (const text of samples) {
      expect(zPluginManifestSchema.safeParse(JSON.parse(text)).success).toBe(parseManifest(text).ok)
    }
  })
})

describe('serializeManifest', () => {
  it('两空格缩进 + 末尾换行，且能往返解析', () => {
    const manifest = {
      id: 'com.example.roundtrip',
      name: '往返',
      version: '0.2.0',
      description: '',
      author: '',
      main: 'index.js',
    }
    const text = serializeManifest(manifest)

    expect(text.endsWith('\n')).toBe(true)
    expect(text).toContain('\n  "id"')

    const parsed = parseManifest(text)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.data).toEqual(manifest)
  })
})
