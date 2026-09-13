// ============================================================================
// 模块说明（中文）
// pluginUiStore.ts 的单元测试：打开 / 覆盖 / 关闭插件对话框。
// ============================================================================

import { beforeEach, describe, expect, it } from 'vitest'

import { closePluginDialog, openPluginDialog, usePluginUiStore } from '@/core/store/pluginUiStore'

beforeEach(() => {
  usePluginUiStore.setState({ dialog: null })
})

describe('pluginUiStore', () => {
  it('初始为空', () => {
    expect(usePluginUiStore.getState().dialog).toBeNull()
  })

  it('openDialog 带上归属与标题，closeDialog 清空', () => {
    const render = () => null
    openPluginDialog({ pluginId: 'com.example.color-card', title: '新建色卡', render })

    const dialog = usePluginUiStore.getState().dialog
    expect(dialog).toEqual({ pluginId: 'com.example.color-card', title: '新建色卡', render })

    closePluginDialog()
    expect(usePluginUiStore.getState().dialog).toBeNull()
  })

  it('同时只允许一个对话框：后开的覆盖先开的', () => {
    openPluginDialog({ pluginId: 'a', title: 'A', render: () => null })
    openPluginDialog({ pluginId: 'b', title: 'B', render: () => null })

    expect(usePluginUiStore.getState().dialog?.pluginId).toBe('b')
  })
})
