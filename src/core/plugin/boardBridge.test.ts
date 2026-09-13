// ============================================================================
// 模块说明（中文）
// boardBridge.ts 的单元测试：注册 / 注销 / 未注册时的空值行为。
// ============================================================================

import { afterEach, describe, expect, it, vi } from 'vitest'

import { getPluginBoardBridge, setPluginBoardBridge } from '@/core/plugin/boardBridge'
import type { PluginBoardBridge } from '@/core/plugin/boardBridge'

afterEach(() => {
  setPluginBoardBridge(null)
})

describe('pluginBoardBridge', () => {
  it('未注册时返回 null（未打开空间的正常情形）', () => {
    expect(getPluginBoardBridge()).toBeNull()
  })

  it('注册后取回同一个实现，注销后回到 null', () => {
    const bridge: PluginBoardBridge = {
      currentSpacePath: () => 'E:/空间',
      createCardFromFile: () => true,
    }

    setPluginBoardBridge(bridge)
    expect(getPluginBoardBridge()).toBe(bridge)
    expect(getPluginBoardBridge()?.currentSpacePath()).toBe('E:/空间')

    setPluginBoardBridge(null)
    expect(getPluginBoardBridge()).toBeNull()
  })

  it('后注册的实现覆盖先前的（Board 重新挂载）', () => {
    const first: PluginBoardBridge = { currentSpacePath: () => 'A', createCardFromFile: () => false }
    const second: PluginBoardBridge = {
      currentSpacePath: () => 'B',
      createCardFromFile: vi.fn(() => true),
    }

    setPluginBoardBridge(first)
    setPluginBoardBridge(second)

    expect(getPluginBoardBridge()).toBe(second)
    expect(getPluginBoardBridge()?.currentSpacePath()).toBe('B')
    expect(getPluginBoardBridge()?.createCardFromFile({
      relativePath: 'a.png',
      absolutePath: 'E:/空间/a.png',
      type: 'image',
    })).toBe(true)
  })
})
