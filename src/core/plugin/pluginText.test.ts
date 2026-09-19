// ============================================================================
// 模块说明（中文）
// pluginText.ts 的单元测试：状态/来源标签、贡献摘要行、列表副标题。
// ============================================================================

import { describe, expect, it } from 'vitest'

import { contributionsLine, pluginStateLabel, pluginSubtitle, pluginSourceLabel } from '@/core/plugin/pluginText'
import type { PluginRecord } from '@/core/plugin/types'

describe('pluginStateLabel', () => {
  it('六态各有中文标签', () => {
    expect(pluginStateLabel('discovered')).toBe('待校验')
    expect(pluginStateLabel('invalid')).toBe('不可用')
    expect(pluginStateLabel('installed')).toBe('已安装')
    expect(pluginStateLabel('active')).toBe('已启用')
    expect(pluginStateLabel('inactive')).toBe('已停用')
    expect(pluginStateLabel('error')).toBe('出错')
  })
})

describe('pluginSourceLabel', () => {
  it('内置 / 外部', () => {
    expect(pluginSourceLabel('builtin')).toBe('内置')
    expect(pluginSourceLabel('external')).toBe('外部')
  })
})

describe('contributionsLine', () => {
  it('只列出数量大于 0 的项，用 · 连接', () => {
    expect(
      contributionsLine({
        cardTypes: 1,
        menuItems: 0,
        canvasMenuItems: 1,
        hooks: 2,
      }),
    ).toBe('卡片类型 1 · 画布菜单项 1 · 生命周期钩子 2')
  })

  it('全 0 时返回空串', () => {
    expect(
      contributionsLine({
        cardTypes: 0,
        menuItems: 0,
        canvasMenuItems: 0,
        hooks: 0,
      }),
    ).toBe('')
  })
})

describe('pluginSubtitle', () => {
  it('拼成「来源 · v版本 · 状态」', () => {
    const plugin: PluginRecord = {
      id: 'com.example.demo',
      name: '演示',
      version: '1.2.3',
      description: '',
      author: '',
      source: 'external',
      installDir: 'E:/plugins/demo',
      main: 'index.js',
      state: 'active',
      detail: '',
      contributions: {
        cardTypes: 1,
        menuItems: 0,
        canvasMenuItems: 0,
        hooks: 0,
      },
      config: {},
    }
    expect(pluginSubtitle(plugin)).toBe('外部 · v1.2.3 · 已启用')
  })
})
