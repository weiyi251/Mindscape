// ============================================================================
// 模块说明（中文）
// 插件注册中心。对应开发计划书 17.8「插件接口签名（第一版必须实现）」，
// 落地第十三章「准备 2」所列的 5 个接口：
//
//   1. registerCardType    —— 卡片类型注册（插件可新增色卡、便签等类型）
//   2. registerMenuItem    —— 右键菜单注册（可按卡片类型区分 + appliesTo 过滤）
//   3. registerToolbarItem —— 工具栏注册
//   4. meta 数据扩展位      —— 直接用 card.meta / partition.meta / layout.extensions，
//                             无需额外接口，故本文件不提供函数
//   5. registerHook        —— 生命周期钩子（7 种事件）
//
// 第一版只提供接口，**不暴露任何插件管理 UI**（对应决策 31）。
// 本模块是插件贡献内容的唯一存放处；核心自带的卡片类型 / 菜单 / 工具栏项
// 分别定义在 cardTypes.ts / menus.ts / toolbar.ts，读取时与本模块的注册内容合并。
//
// 设计取舍：
//   · 重复注册同一个 id：覆盖并 console.warn（不静默），而不是抛错 ——
//     否则开发期 Vite HMR 重跑模块时会直接把应用打挂。
//   · 钩子回调签名用 (payload: unknown) 而非 17.8 写的 any，以满足 no-explicit-any。
// ============================================================================

import type { ReactNode } from 'react'
import type { Card, Connection, Partition } from '@/core/types'

// ---------------------------------------------------------------------------
// 1. 卡片类型注册
// ---------------------------------------------------------------------------

/** 卡片渲染时传入的参数 */
export interface CardRenderProps {
  /** 要渲染的卡片数据 */
  card: Card
  /** 是否处于选中态（渲染层需要据此画选中边框） */
  selected: boolean
}

/** 卡片类型定义（插件接口 1） */
export interface CardTypeDef {
  /** 类型标识，与 card.type 对应 */
  type: string
  /** 渲染函数 */
  render: (props: CardRenderProps) => ReactNode
  /** 该类型自带的菜单项（会与 registerMenuItem 注册的项合并） */
  menu: MenuItem[]
  /** 新建卡片时的默认尺寸 */
  defaultSize: { w: number; h: number }
}

// ---------------------------------------------------------------------------
// 2. 右键菜单注册
// ---------------------------------------------------------------------------

/** 菜单动作的上下文 */
export interface MenuContext {
  /** 当前空间文件夹绝对路径 */
  spacePath: string
  /** 触发菜单的卡片；在画布空白处触发时为 undefined */
  card?: Card
  /** 触发菜单的分区框 */
  partition?: Partition
  /** 触发菜单的连线（断开连接 / 编辑标签用） */
  connection?: Connection
}

/** 菜单项（对应 17.8 接口 2，也是第十三章「准备 3」的配置数组元素） */
export interface MenuItem {
  id: string
  label: string
  /** 不同卡片类型显示不同菜单：返回 false 时该项对该卡片隐藏 */
  appliesTo?: (card: Card) => boolean
  action: (ctx: MenuContext) => void
}

// ---------------------------------------------------------------------------
// 3. 工具栏注册
// ---------------------------------------------------------------------------

export interface ToolbarItemDef {
  id: string
  label: string
  icon?: string
  action: () => void
}

// ---------------------------------------------------------------------------
// 5. 生命周期钩子
// ---------------------------------------------------------------------------

export type HookName =
  | 'cardSelected'
  | 'cardMoved'
  | 'cardCreated'
  | 'cardRemoved'
  | 'partitionRenamed'
  | 'spaceOpened'
  | 'spaceClosed'

/** 钩子回调。payload 由各触发点决定（17.8 原写 any，此处用 unknown 以通过 lint） */
export type HookFn = (payload: unknown) => void

// ---------------------------------------------------------------------------
// 内部存储
// ---------------------------------------------------------------------------

const cardTypes = new Map<string, CardTypeDef>()
const pluginMenuItems = new Map<string, { item: MenuItem; cardType?: string }>()
const toolbarItems = new Map<string, ToolbarItemDef>()
const hookHandlers = new Map<HookName, Set<HookFn>>()

function warnDuplicate(kind: string, id: string): void {
  console.warn(`[pluginCenter] ${kind}「${id}」重复注册，已用新定义覆盖旧定义。`)
}

// ---------------------------------------------------------------------------
// 接口 1：卡片类型
// ---------------------------------------------------------------------------

export function registerCardType(def: CardTypeDef): void {
  if (!def.type) throw new Error('registerCardType 失败：type 不能为空')
  if (cardTypes.has(def.type)) warnDuplicate('卡片类型', def.type)
  cardTypes.set(def.type, def)
}

/** 取插件注册的卡片类型；核心类型由 registry/cardTypes.ts 提供 */
export function getRegisteredCardType(type: string): CardTypeDef | undefined {
  return cardTypes.get(type)
}

/** 列出插件注册的全部卡片类型 */
export function listRegisteredCardTypes(): CardTypeDef[] {
  return [...cardTypes.values()]
}

// ---------------------------------------------------------------------------
// 接口 2：右键菜单
// ---------------------------------------------------------------------------

/**
 * 注册菜单项。
 * @param item     菜单项定义
 * @param cardType 限定只有该类型的卡片显示；不传则对所有卡片显示
 */
export function registerMenuItem(item: MenuItem, cardType?: string): void {
  if (!item.id) throw new Error('registerMenuItem 失败：id 不能为空')
  const key = `${cardType ?? '*'}:${item.id}`
  if (pluginMenuItems.has(key)) warnDuplicate('菜单项', key)
  pluginMenuItems.set(key, { item, cardType })
}

/** 列出插件注册的全部菜单项（含限定类型） */
export function listRegisteredMenuItems(): { item: MenuItem; cardType?: string }[] {
  return [...pluginMenuItems.values()]
}

/**
 * 取某张卡片应该显示的**插件菜单项**（已按 cardType 与 appliesTo 过滤）。
 * 核心菜单项由 registry/menus.ts 负责合并。
 */
export function getPluginMenuItemsForCard(card: Card): MenuItem[] {
  const result: MenuItem[] = []
  for (const { item, cardType } of pluginMenuItems.values()) {
    if (cardType !== undefined && cardType !== card.type) continue
    if (item.appliesTo && !item.appliesTo(card)) continue
    result.push(item)
  }
  return result
}

// ---------------------------------------------------------------------------
// 接口 3：工具栏
// ---------------------------------------------------------------------------

export function registerToolbarItem(item: ToolbarItemDef): void {
  if (!item.id) throw new Error('registerToolbarItem 失败：id 不能为空')
  if (toolbarItems.has(item.id)) warnDuplicate('工具栏项', item.id)
  toolbarItems.set(item.id, item)
}

export function listRegisteredToolbarItems(): ToolbarItemDef[] {
  return [...toolbarItems.values()]
}

// ---------------------------------------------------------------------------
// 接口 4：数据扩展位
// ---------------------------------------------------------------------------

// 17.8 明确：直接用 card.meta / partition.meta / layout.extensions，无需额外接口。
// 相关类型见 core/types.ts（Meta / zMetaSchema）。

// ---------------------------------------------------------------------------
// 接口 5：生命周期钩子
// ---------------------------------------------------------------------------

/** 注册钩子（17.8 签名：返回 void）。需要注销请用 unregisterHook。 */
export function registerHook(name: HookName, fn: HookFn): void {
  let set = hookHandlers.get(name)
  if (!set) {
    set = new Set()
    hookHandlers.set(name, set)
  }
  set.add(fn)
}

export function unregisterHook(name: HookName, fn: HookFn): void {
  hookHandlers.get(name)?.delete(fn)
}

/**
 * 触发钩子。单个回调抛错不会影响其他回调（插件互不连坐）。
 * @returns 实际被调用的回调数量
 */
export function emitHook(name: HookName, payload: unknown): number {
  const set = hookHandlers.get(name)
  if (!set) return 0

  let called = 0
  for (const fn of set) {
    try {
      fn(payload)
      called += 1
    } catch (error) {
      console.error(`[pluginCenter] 钩子「${name}」的回调抛错，已跳过：`, error)
    }
  }
  return called
}

/** 列出某钩子已注册的回调数量（调试 / 测试用） */
export function countHookHandlers(name: HookName): number {
  return hookHandlers.get(name)?.size ?? 0
}

// ---------------------------------------------------------------------------
// 测试 / 开发辅助
// ---------------------------------------------------------------------------

/**
 * 清空插件注册中心。
 * 仅供单元测试与开发期 HMR 使用，业务代码不应调用。
 */
export function resetPluginCenter(): void {
  cardTypes.clear()
  pluginMenuItems.clear()
  toolbarItems.clear()
  hookHandlers.clear()
}
