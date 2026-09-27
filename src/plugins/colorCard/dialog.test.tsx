// ============================================================================
// 模块说明（中文）
// 色卡对话框在窄屏下的触控尺寸（2026-09-28 移动端第三轮：手机上按钮太小点不中）。
//
// 这个面板在安卓上同样能打开（色卡是内置插件），但里面的按钮一直是 `py-0.5 text-[11px]`
// 的 20px 桌面尺寸，色块预设更是 24px —— 手指按上去一半都落空。
//
// 环境仍是 node（不引 jsdom）：静态渲染只跑 useState 初值，组件里的 effect 不会执行，
// 因此不需要 Tauri / 存储。断言的对象是类名，锁两条：
//   1. 所有触控放大的类都带 `max-sm:` 前缀 —— 桌面渲染出来的一字不变（红线 R2）；
//   2. 44px 的档位确实出现在交互元素上（按钮 / 色块 / 取色器）。
// ============================================================================

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import type { PluginHostApi } from '@/core/plugin/types'
import { ColorCardDialog } from './dialog'

/** 与 index.test.tsx 同一套假宿主：本文件只关心布局，动作一律空实现 */
const api = {
  pluginId: 'colorCard',
  registerCardType: vi.fn(),
  registerMenuItem: vi.fn(),
  registerCanvasMenuItem: vi.fn(),
  registerHook: vi.fn(),
  ui: { openDialog: vi.fn(), closeDialog: vi.fn() },
  fs: { writeBytes: vi.fn(), pickDirectory: vi.fn() },
  board: { currentSpacePath: () => null, createCardFromFile: vi.fn() },
  config: { getAll: () => ({}), set: vi.fn() },
} as unknown as PluginHostApi

const markup = () => renderToStaticMarkup(<ColorCardDialog api={api} spacePath={null} />)

describe('色卡对话框（窄屏触控尺寸）', () => {
  it('交互元素在窄屏都有 44px 档（主线按钮 / 色块 / 取色器）', () => {
    const html = markup()
    expect(html).toContain('max-sm:min-h-[44px]')
    expect(html.match(/max-sm:min-h-\[44px\]/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
    expect(html).toContain('max-sm:h-10 max-sm:w-10')
    expect(html).toContain('max-sm:h-11 max-sm:w-14')
  })

  it('放大的类全部带 max-sm: 前缀，桌面尺寸一字不变（R2）', () => {
    const html = markup()
    // 逐条 class 拆成 token：不许出现「不带 max-sm: 前缀的 44px」
    const tokens = [...html.matchAll(/class="([^"]*)"/g)]
      .flatMap((m) => m[1].split(/\s+/))
      .filter(Boolean)
    expect(tokens.filter((t) => t.includes('min-h-[44px]') && !t.startsWith('max-sm:'))).toEqual([])
    // 色块按钮与取色器的原始桌面尺寸必须原封不动地留着
    expect(html).toContain('h-6 w-6 rounded border transition-transform hover:scale-110')
    expect(html).toContain('h-8 w-10 shrink-0 cursor-pointer')
    expect(html).toContain('px-2 py-0.5 text-[11px]')
  })
})
