// ============================================================================
// 模块说明（中文）
// 临时测试插件 —— 对应开发计划书 T0.9 的验收标准：
//   「写一个临时测试插件，能注册卡片类型 + 菜单项 + 钩子并生效。」
//
// 目录位置（2026-09-14 插件期整理）：本文件已移入 src/plugins/demo/，
// 与 src/plugins/colorCard/ 一起构成「一个插件一个文件夹」的约定 ——
// 见 src/plugins/index.ts 的模块说明。
//
// 本插件的唯一用途是证明 17.8 的插件接口真实可用：
//   · registerCardType    —— 新增一个「色卡」类型（不在核心三种类型之内）
//   · registerMenuItem    —— 新增「导出为图片」「标记为参考」两个菜单项
//   · registerHook        —— 监听 cardMoved 钩子并计数
//   · meta 扩展位          —— 往 card.meta 里写插件私有字段（无需接口）
// （registerToolbarItem 扩展点已于 2026-09-20 移除 —— 宿主没有工具栏渲染端，
//   见 pluginCenter.ts 模块说明；工具栏演示随之删除。）
//
// 重要：它**不在 builtinPlugins.ts 里**，因此不会被应用加载 ——
// 它注册的卡片类型只有占位渲染，出现在用户界面里没有意义。
// 它作为「按 17.8 写法写一遍能否被核心读到」的端到端证据，只在测试里显式调用。
//
// 实现任务：T0.9（准备层）。
// ============================================================================

import { createElement } from 'react'

import type { Card } from '@/core/types'
import {
  registerCardType,
  registerMenuItem,
  registerHook,
  countHookHandlers,
} from '@/core/registry/pluginCenter'
import type { CardTypeDef, MenuItem } from '@/core/registry/pluginCenter'

/** 插件新增的卡片类型标识（核心三种为 image / file / note） */
export const DEMO_CARD_TYPE = 'demo-color-card'

/** 插件往 card.meta 里写的私有字段名（演示 meta 扩展位，无需额外接口） */
export const DEMO_META_KEY = 'demoPlugin'

/** 插件私有 meta 数据的形状 */
export interface DemoMeta {
  /** 色卡的十六进制底色 */
  color: string
  /** 被「标记为参考」的次数 */
  markedCount: number
}

/** 演示用：记录 cardMoved 钩子被触发过多少次 */
export const demoHookState = { cardMovedCount: 0 }

/**
 * 演示用：记录菜单动作最近一次的调用参数。
 * 单元测试据此断言「动作确实跑到了」。
 */
export const demoActionLog: { lastAction: string | null; lastPayload: unknown } = {
  lastAction: null,
  lastPayload: undefined,
}

/** 演示用：把插件私有数据从 card.meta 里取出来（带兜底默认值） */
export function readDemoMeta(card: Card): DemoMeta {
  const raw = card.meta?.[DEMO_META_KEY] as Partial<DemoMeta> | undefined
  return {
    color: raw?.color ?? '#5A7D6A',
    markedCount: raw?.markedCount ?? 0,
  }
}

/** 演示用：写入插件私有数据，返回新的 meta 对象（不修改入参） */
export function writeDemoMeta(card: Card, patch: Partial<DemoMeta>): Record<string, unknown> {
  const current = readDemoMeta(card)
  return { ...card.meta, [DEMO_META_KEY]: { ...current, ...patch } }
}

// ---------------------------------------------------------------------------
// 卡片类型定义
// ---------------------------------------------------------------------------

/** 色卡渲染：第一版仅返回占位内容，真实渲染由 T0.10 之后的渲染层接管 */
export const demoCardTypeDef: CardTypeDef = {
  type: DEMO_CARD_TYPE,
  render: ({ card, selected }) =>
    createElement('div', {
      'data-card-id': card.id,
      'data-selected': selected,
      className: 'demo-color-card',
    }),
  menu: [],
  defaultSize: { w: 160, h: 160 },
}

// ---------------------------------------------------------------------------
// 菜单项定义
// ---------------------------------------------------------------------------

/** 只对核心图片卡片显示的菜单项 */
export const demoExportImageMenuItem: MenuItem = {
  id: 'demo.exportImage',
  label: '导出为图片',
  appliesTo: (card) => card.type === 'image',
  action: (ctx) => {
    demoActionLog.lastAction = 'demo.exportImage'
    demoActionLog.lastPayload = ctx
  },
}

/** 对所有卡片显示的菜单项，但用 appliesTo 排除已标记过的卡片 */
export const demoMarkReferenceMenuItem: MenuItem = {
  id: 'demo.markReference',
  label: '标记为参考',
  appliesTo: (card) => readDemoMeta(card).markedCount < 3,
  action: (ctx) => {
    demoActionLog.lastAction = 'demo.markReference'
    demoActionLog.lastPayload = ctx
  },
}

/** 只对插件自己的色卡类型显示的菜单项（走 registerMenuItem 的 cardType 限定） */
export const demoEditColorMenuItem: MenuItem = {
  id: 'demo.editColor',
  label: '修改底色',
  action: (ctx) => {
    demoActionLog.lastAction = 'demo.editColor'
    demoActionLog.lastPayload = ctx
  },
}

// ---------------------------------------------------------------------------
// 安装
// ---------------------------------------------------------------------------

/**
 * 安装测试插件。
 * 幂等性：重复调用会触发 pluginCenter 的重复注册警告并覆盖，这是预期行为
 * （模拟 Vite HMR 重跑模块的场景），不会抛错。
 */
export function installDemoPlugin(): void {
  registerCardType(demoCardTypeDef)

  // 不限定类型 → 所有卡片可见（是否显示再由各自 appliesTo 决定）
  registerMenuItem(demoExportImageMenuItem, 'image')
  registerMenuItem(demoMarkReferenceMenuItem)

  // 限定为插件自己的色卡类型
  registerMenuItem(demoEditColorMenuItem, DEMO_CARD_TYPE)

  registerHook('cardMoved', () => {
    demoHookState.cardMovedCount += 1
  })
}

/** 测试辅助：重置插件自身的状态计数器 */
export function resetDemoState(): void {
  demoHookState.cardMovedCount = 0
  demoActionLog.lastAction = null
  demoActionLog.lastPayload = undefined
}

/** 测试辅助：当前 cardMoved 钩子的回调数量（用于断言钩子确实注册成功） */
export function demoCardMovedHookCount(): number {
  return countHookHandlers('cardMoved')
}
