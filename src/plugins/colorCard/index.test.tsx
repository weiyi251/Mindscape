// ============================================================================
// 模块说明（中文）
// 色卡插件入口（index.tsx）的单元测试。
//
// 验证的是「插件按约定接上了宿主」这件事，而不是界面好不好看：
//   · activate 只注册它该注册的东西（一个画布菜单项），不多不少
//   · 菜单动作真的会请求宿主打开对话框，标题正确
//   · 交出去的 render 函数能产出一个 React 元素（宿主挂载它才有内容）
//
// 用假的 PluginHostApi：真实 API 要 Tauri 与存储，这里只关心调用契约。
// ============================================================================

import { describe, expect, it, vi } from 'vitest'

import type { CanvasMenuItem } from '@/core/registry/pluginCenter'
import type { PluginHostApi } from '@/core/plugin/types'
import { COLOR_CARD_MENU_ITEM_ID, COLOR_CARD_PLUGIN_ID, colorCardPlugin } from './index'
import { COLOR_CARD_TEXT } from './text'

interface Harness {
  api: PluginHostApi
  registered: CanvasMenuItem[]
  opened: { title: string; render: () => unknown }[]
}

function makeHarness(): Harness {
  const registered: Harness['registered'] = []
  const opened: Harness['opened'] = []

  const api = {
    pluginId: COLOR_CARD_PLUGIN_ID,
    registerCardType: vi.fn(),
    registerMenuItem: vi.fn(),
    registerCanvasMenuItem: (item: CanvasMenuItem) => registered.push(item),
    registerHook: vi.fn(),
    ui: {
      openDialog: (title: string, render: () => unknown) => opened.push({ title, render }),
      closeDialog: vi.fn(),
    },
    fs: { writeBytes: vi.fn(), pickDirectory: vi.fn() },
    board: { currentSpacePath: () => null, createCardFromFile: vi.fn() },
    config: { getAll: () => ({}), set: vi.fn() },
  } as unknown as PluginHostApi

  return { api, registered, opened }
}

describe('colorCardPlugin 元信息', () => {
  it('清单字段齐全，id 与导出常量一致', () => {
    const manifest = colorCardPlugin.manifest
    expect(manifest.id).toBe(COLOR_CARD_PLUGIN_ID)
    expect(manifest.name).toBe(COLOR_CARD_TEXT.pluginName)
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(manifest.description).toBe(COLOR_CARD_TEXT.pluginDescription)
    expect(manifest.author).toBe(COLOR_CARD_TEXT.pluginAuthor)
    expect(manifest.main.endsWith('.js')).toBe(true)
  })
})

describe('colorCardPlugin.activate', () => {
  it('只注册一个画布菜单项，不动卡片类型 / 右键菜单 / 工具栏 / 钩子', async () => {
    const harness = makeHarness()

    await colorCardPlugin.activate(harness.api)

    expect(harness.registered).toHaveLength(1)
    expect(harness.registered[0].id).toBe(COLOR_CARD_MENU_ITEM_ID)
    expect(harness.registered[0].label).toBe(COLOR_CARD_TEXT.menuLabel)

    // 不越界注册：这些接口一旦被调用，宿主会在停用时回收更多东西，
    // 而本插件目前确实只需要一个画布菜单入口
    expect(harness.api.registerCardType).not.toHaveBeenCalled()
    expect(harness.api.registerMenuItem).not.toHaveBeenCalled()
    expect(harness.api.registerHook).not.toHaveBeenCalled()
  })

  it('菜单动作请求宿主打开对话框，标题与渲染函数都到位', async () => {
    const harness = makeHarness()
    await colorCardPlugin.activate(harness.api)

    harness.registered[0].action({ spacePath: 'E:\\Mindscape\\空间A' })

    expect(harness.opened).toHaveLength(1)
    expect(harness.opened[0].title).toBe(COLOR_CARD_TEXT.dialogTitle)
    // 交出去的是「能产出 React 元素的函数」，宿主挂载它才有内容
    expect(harness.opened[0].render()).toBeTruthy()
  })
})
