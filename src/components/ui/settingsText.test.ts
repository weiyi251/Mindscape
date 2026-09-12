// ============================================================================
// 模块说明（中文）
// 设置面板纯函数（updateStatusLine）的单元测试：每种更新状态对应一行可读文案。
// ============================================================================

import { describe, expect, it } from 'vitest'

import { SETTINGS_TEXT, updateStatusLine } from './settingsText'

describe('updateStatusLine', () => {
  it('每种状态都有非空中文文案', () => {
    const statuses = [
      'idle',
      'checking',
      'up-to-date',
      'available',
      'downloading',
      'ready',
      'error',
      'unsupported',
    ] as const
    for (const status of statuses) {
      expect(updateStatusLine(status, '0.3.0').length).toBeGreaterThan(0)
    }
  })

  it('关键状态的文案可区分', () => {
    expect(updateStatusLine('idle', '')).toContain('尚未检查')
    expect(updateStatusLine('checking', '')).toContain('正在检查')
    expect(updateStatusLine('up-to-date', '')).toContain('已是最新')
    expect(updateStatusLine('available', '0.3.0')).toContain('新版本')
    expect(updateStatusLine('error', '')).toContain('失败')
    expect(updateStatusLine('unsupported', '')).toContain('不支持')
  })
})

describe('SETTINGS_TEXT', () => {
  it('文案表完整（防止漏 key）', () => {
    for (const value of Object.values(SETTINGS_TEXT)) {
      expect(String(value).length).toBeGreaterThan(0)
    }
  })
})
