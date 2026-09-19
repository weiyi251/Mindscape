// ============================================================================
// 模块说明（中文）
// lifecycle.ts 的单元测试：六态状态下各动作的可用性判定。
// ============================================================================

import { describe, expect, it } from 'vitest'

import {
  canDisable,
  canEnable,
  canReload,
  canUninstall,
  hasNoContributions,
  isActive,
  isProblematic,
  toggleLabel,
} from '@/core/plugin/lifecycle'
import type { PluginRecord, PluginSource, PluginState } from '@/core/plugin/types'

const EMPTY_CONTRIBUTIONS = {
  cardTypes: 0,
  menuItems: 0,
  canvasMenuItems: 0,
  hooks: 0,
}

function makePlugin(over: Partial<PluginRecord> = {}): PluginRecord {
  return {
    id: 'com.example.demo',
    name: '演示插件',
    version: '1.0.0',
    description: '',
    author: '',
    source: 'builtin' as PluginSource,
    installDir: null,
    main: 'index.js',
    state: 'installed' as PluginState,
    detail: '',
    contributions: { ...EMPTY_CONTRIBUTIONS },
    config: {},
    ...over,
  }
}

describe('isActive', () => {
  it('只有 active 算启用', () => {
    expect(isActive('active')).toBe(true)
    for (const state of ['discovered', 'invalid', 'installed', 'inactive', 'error'] as PluginState[]) {
      expect(isActive(state), state).toBe(false)
    }
  })
})

describe('canEnable', () => {
  it('installed / inactive / error 可启用', () => {
    for (const state of ['installed', 'inactive', 'error'] as PluginState[]) {
      expect(canEnable(makePlugin({ state })), state).toBe(true)
    }
  })

  it('active 已启用、invalid 不过关、discovered 未校验：都不可启用', () => {
    for (const state of ['active', 'invalid', 'discovered'] as PluginState[]) {
      expect(canEnable(makePlugin({ state })), state).toBe(false)
    }
  })
})

describe('canDisable', () => {
  it('只有 active 可停用', () => {
    expect(canDisable(makePlugin({ state: 'active' }))).toBe(true)
    for (const state of ['installed', 'inactive', 'error', 'invalid'] as PluginState[]) {
      expect(canDisable(makePlugin({ state })), state).toBe(false)
    }
  })
})

describe('canUninstall / canReload', () => {
  it('内置插件不能卸载、不能重新加载（随应用走）', () => {
    const builtin = makePlugin({ source: 'builtin' })
    expect(canUninstall(builtin)).toBe(false)
    expect(canReload(builtin)).toBe(false)
  })

  it('外部插件可卸载、可重新加载', () => {
    const external = makePlugin({ source: 'external', installDir: 'E:/data/plugins/x' })
    expect(canUninstall(external)).toBe(true)
    expect(canReload(external)).toBe(true)
  })

  it('是否可卸载只看来源，与状态无关（出错的插件也能卸载）', () => {
    expect(canUninstall(makePlugin({ source: 'external', state: 'error' }))).toBe(true)
    expect(canUninstall(makePlugin({ source: 'external', state: 'invalid' }))).toBe(true)
  })
})

describe('toggleLabel', () => {
  it('启用态显示「停用」，其余显示「启用」', () => {
    expect(toggleLabel(makePlugin({ state: 'active' }))).toBe('停用')
    expect(toggleLabel(makePlugin({ state: 'installed' }))).toBe('启用')
    expect(toggleLabel(makePlugin({ state: 'inactive' }))).toBe('启用')
  })
})

describe('isProblematic', () => {
  it('只有 invalid / error 需要提示用户', () => {
    expect(isProblematic('invalid')).toBe(true)
    expect(isProblematic('error')).toBe(true)
    for (const state of ['discovered', 'installed', 'active', 'inactive'] as PluginState[]) {
      expect(isProblematic(state), state).toBe(false)
    }
  })
})

describe('hasNoContributions', () => {
  it('全 0 才算是「没有注册任何内容」', () => {
    expect(hasNoContributions({ ...EMPTY_CONTRIBUTIONS })).toBe(true)
    expect(hasNoContributions({ ...EMPTY_CONTRIBUTIONS, hooks: 1 })).toBe(false)
    expect(hasNoContributions({ ...EMPTY_CONTRIBUTIONS, cardTypes: 1 })).toBe(false)
  })
})
