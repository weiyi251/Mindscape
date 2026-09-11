// ============================================================================
// 模块说明（中文）
// 工具栏注册中心单元测试。覆盖 T0.10 的工具栏侧：
//   · 核心工具栏项来自配置数组，可按分组取用
//   · 插件按钮自动追加到末尾；与核心同名时核心优先
//   · 动作转交 actionRegistry，未实现时只提示不崩
//
// 实现任务：T0.10（准备层）。
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { registerToolbarItem, resetPluginCenter } from '@/core/registry/pluginCenter'
import {
  CORE_TOOLBAR_ITEMS,
  TOOLBAR_ACTION,
  buildToolbarItems,
  listCoreToolbarItemsByGroup,
} from '@/core/registry/toolbar'
import { registerAction, resetActions } from '@/core/registry/actionRegistry'

beforeEach(() => {
  resetPluginCenter()
  resetActions()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('核心工具栏配置', () => {
  it('包含文档明确提到的五个按钮', () => {
    expect(CORE_TOOLBAR_ITEMS.map((item) => item.id)).toEqual([
      TOOLBAR_ACTION.undo,
      TOOLBAR_ACTION.redo,
      TOOLBAR_ACTION.resetZoom,
      TOOLBAR_ACTION.zoomToFit,
      TOOLBAR_ACTION.showRemoved,
    ])
  })

  it('按分组取用：编辑类 2 个、视图类 3 个', () => {
    expect(listCoreToolbarItemsByGroup('edit')).toHaveLength(2)
    expect(listCoreToolbarItemsByGroup('view')).toHaveLength(3)
  })

  it('撤销 / 重做带快捷键提示（对应 7.4 规格）', () => {
    const byId = new Map(CORE_TOOLBAR_ITEMS.map((item) => [item.id, item]))
    expect(byId.get(TOOLBAR_ACTION.undo)?.shortcut).toBe('Ctrl+Z')
    expect(byId.get(TOOLBAR_ACTION.redo)?.shortcut).toBe('Ctrl+Shift+Z')
  })
})

describe('buildToolbarItems 聚合', () => {
  it('无插件时输出核心项', () => {
    expect(buildToolbarItems()).toHaveLength(CORE_TOOLBAR_ITEMS.length)
  })

  it('插件按钮追加在核心项之后', () => {
    registerToolbarItem({ id: 'plugin.exportPoster', label: '导出长图', action: () => {} })

    const ids = buildToolbarItems().map((item) => item.id)
    expect(ids.at(-1)).toBe('plugin.exportPoster')
    expect(ids).toHaveLength(CORE_TOOLBAR_ITEMS.length + 1)
  })

  it('插件与核心同名时忽略插件版本并提示', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registerToolbarItem({ id: TOOLBAR_ACTION.undo, label: '插件撤销', action: () => {} })

    const undos = buildToolbarItems().filter((item) => item.id === TOOLBAR_ACTION.undo)
    expect(undos).toHaveLength(1)
    expect(undos[0].label).toBe('撤销')
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe('工具栏动作分发', () => {
  it('未实现时点击只提示，不抛错', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const undo = CORE_TOOLBAR_ITEMS.find((item) => item.id === TOOLBAR_ACTION.undo)

    expect(() => undo?.action()).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('登记实现后点击生效', () => {
    const handler = vi.fn()
    registerAction(TOOLBAR_ACTION.undo, handler)

    CORE_TOOLBAR_ITEMS.find((item) => item.id === TOOLBAR_ACTION.undo)?.action()

    expect(handler).toHaveBeenCalledTimes(1)
  })
})
