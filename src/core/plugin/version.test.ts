// ============================================================================
// 模块说明（中文）
// version.ts 的单元测试：解析、比较、预发布标识、以及「不合法输入不误报」。
// ============================================================================

import { describe, expect, it } from 'vitest'

import { compareVersion, isNewerVersion, parseVersion } from '@/core/plugin/version'

describe('parseVersion', () => {
  it('解析完整版本号', () => {
    expect(parseVersion('1.2.3')).toEqual({ numbers: [1, 2, 3], prerelease: [] })
  })

  it('允许 v 前缀与缺省段', () => {
    expect(parseVersion('v2')).toEqual({ numbers: [2, 0, 0], prerelease: [] })
    expect(parseVersion('v1.4')).toEqual({ numbers: [1, 4, 0], prerelease: [] })
  })

  it('解析预发布标识与构建元数据（后者被忽略）', () => {
    expect(parseVersion('1.2.0-beta.2')).toEqual({ numbers: [1, 2, 0], prerelease: ['beta', '2'] })
    expect(parseVersion('1.2.3+build.7')).toEqual({ numbers: [1, 2, 3], prerelease: [] })
    expect(parseVersion('1.2.3-rc.1+build.7')).toEqual({
      numbers: [1, 2, 3],
      prerelease: ['rc', '1'],
    })
  })

  it('首尾空白会被忽略', () => {
    expect(parseVersion('  1.0.0  ')).toEqual({ numbers: [1, 0, 0], prerelease: [] })
  })

  it('不合法输入返回 null', () => {
    for (const bad of ['', 'abc', '1.2.3.4', 'x1.2.3', '1..2', '-1.0.0']) {
      expect(parseVersion(bad), bad).toBeNull()
    }
  })
})

describe('compareVersion', () => {
  it('相等', () => {
    expect(compareVersion('1.2.3', '1.2.3')).toBe(0)
    expect(compareVersion('v1.2.3', '1.2.3')).toBe(0)
    expect(compareVersion('1.2', '1.2.0')).toBe(0)
  })

  it('按 主 > 次 > 修订 逐级比较', () => {
    expect(compareVersion('2.0.0', '1.9.9')).toBe(1)
    expect(compareVersion('1.3.0', '1.2.9')).toBe(1)
    expect(compareVersion('1.2.4', '1.2.3')).toBe(1)
    expect(compareVersion('1.2.3', '1.2.4')).toBe(-1)
  })

  it('预发布版小于同号正式版', () => {
    expect(compareVersion('1.2.0-beta', '1.2.0')).toBe(-1)
    expect(compareVersion('1.2.0', '1.2.0-beta')).toBe(1)
  })

  it('预发布标识按 semver 规则比较', () => {
    expect(compareVersion('1.0.0-alpha', '1.0.0-beta')).toBe(-1)
    expect(compareVersion('1.0.0-alpha.1', '1.0.0-alpha.2')).toBe(-1)
    // 数字标识符 < 字母标识符
    expect(compareVersion('1.0.0-1', '1.0.0-alpha')).toBe(-1)
    // 段数少者更小
    expect(compareVersion('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1)
  })

  it('任一非法版本号返回 0（不误报有更新）', () => {
    expect(compareVersion('1.2.3', 'unknown')).toBe(0)
    expect(compareVersion('', '1.0.0')).toBe(0)
  })
})

describe('isNewerVersion', () => {
  it('只在候选更新时返回 true', () => {
    expect(isNewerVersion('1.0.1', '1.0.0')).toBe(true)
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false)
    expect(isNewerVersion('0.9.9', '1.0.0')).toBe(false)
    expect(isNewerVersion('1.0.0', 'not-a-version')).toBe(false)
  })
})
