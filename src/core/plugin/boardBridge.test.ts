// ============================================================================
// 模块说明（中文）
// boardBridge.ts 的单元测试：注册 / 注销 / 未注册时的空值行为。
//
// createCardFromFile 是异步的（宿主侧要读图片尺寸、登记资源表、走 addCards 命令），
// 因此断言的假实现也返回 Promise。
// ============================================================================

import { afterEach, describe, expect, it, vi } from 'vitest'

import { getPluginBoardBridge, setPluginBoardBridge } from '@/core/plugin/boardBridge'
import type { PluginBoardBridge } from '@/core/plugin/boardBridge'

afterEach(() => {
  setPluginBoardBridge(null)
})

/** 假桥工厂：只覆盖关心的方法，其余给空实现（桥新增能力时这里自动齐全） */
function makeBridge(overrides: Partial<PluginBoardBridge> = {}): PluginBoardBridge {
  return {
    currentSpacePath: () => null,
    createCardFromFile: async () => true,
    createCard: async () => null,
    updateCardContent: async () => false,
    syncCardGeometry: async () => false,
    ...overrides,
  }
}

describe('pluginBoardBridge', () => {
  it('未注册时返回 null（未打开空间的正常情形）', () => {
    expect(getPluginBoardBridge()).toBeNull()
  })

  it('注册后取回同一个实现，注销后回到 null', async () => {
    const bridge = makeBridge({ currentSpacePath: () => 'E:/空间' })

    setPluginBoardBridge(bridge)
    expect(getPluginBoardBridge()).toBe(bridge)
    expect(getPluginBoardBridge()?.currentSpacePath()).toBe('E:/空间')

    setPluginBoardBridge(null)
    expect(getPluginBoardBridge()).toBeNull()
  })

  it('后注册的实现覆盖先前的（Board 重新挂载）', async () => {
    const first = makeBridge({ currentSpacePath: () => 'A' })
    const second = makeBridge({
      currentSpacePath: () => 'B',
      createCardFromFile: vi.fn(async () => true),
    })

    setPluginBoardBridge(first)
    setPluginBoardBridge(second)

    expect(getPluginBoardBridge()).toBe(second)
    expect(getPluginBoardBridge()?.currentSpacePath()).toBe('B')
    await expect(
      getPluginBoardBridge()?.createCardFromFile({
        relativePath: 'a.png',
        absolutePath: 'E:/空间/a.png',
        type: 'image',
      }),
    ).resolves.toBe(true)
  })
})
