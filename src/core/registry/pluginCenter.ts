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
// 【2026-09-14 插件管理期扩展（对应 docs/插件功能实施方案.md §4）】
// 上一版只有「注册」没有「归属」，因此无法实现「禁用 / 卸载」（不知道该删哪些）。
// 本版做**纯增量**扩展：
//   · pluginOwners      —— 记录「哪个插件登记了哪些条目」，是禁用/卸载的前提
//   · registryVersion   —— 每次注册表变动自增，UI 订阅它以即时重渲染
//   · createPluginApi   —— 插件唯一入口：绑定 pluginId 的注册 API（插件不 import 宿主）
//   · disposePlugin     —— 按 pluginId 整体回收注册（注册的逆操作）
//   · registerCanvasMenuItem —— 画布空白菜单扩展点（新建色卡等插件动作的入口）
//   · HookPayloadMap    —— 7 个钩子的载荷定形（此前 payload 为裸 unknown）
//
// 兼容性：registerX 的**原有签名一律不变**（核心与既有测试继续可用）；
// 归属只对「通过 createPluginApi 注册」的插件生效 —— 这是有意设计：
// 插件必须拿宿主注入的 API，不能自己 import 本模块。
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
  /**
   * 便签行内编辑中（2026-09-13）：便签本体会被一个 bg-transparent 的 textarea
   * 覆盖，渲染层此时**不得**再画正文 / 占位文字（如「（空便签）」）——否则
   * 占位文字透过透明底与用户正在输入的草稿重叠。仅便签类型会用到此标记。
   */
  noteEditing?: boolean
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
  /**
   * 缩放手柄模式（2026-09-17 待办卡片插件引入）：
   *   · 'default'（缺省）—— 右下角手柄（便签另有上 / 下 / 左三边手柄）；
   *   · 'widthOnly' —— 仅左缘中点手柄：宽度用户可调，**高度由插件按内容自适应**
   *     （拖高手柄会破坏自适应），适合内容决定高度的插件卡片。
   */
  resizeHandles?: 'default' | 'widthOnly'
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
  /**
   * 触发菜单时的画布坐标（画布空白菜单提供，2026-09-17 待办卡片引入）。
   * 插件用它把新建内容放在**右键点**上（与「右键新建分区」同体验）；
   * 缺省时插件可交给宿主放视口中心。
   */
  canvasPoint?: { x: number; y: number }
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

/**
 * 画布空白处菜单项（2026-09-14 新增扩展点）。
 * 与卡片菜单项的区别：没有 card 上下文，只会出现在「画布空白右键」里。
 */
export interface CanvasMenuItem {
  id: string
  label: string
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

/**
 * 7 个钩子的载荷形状（2026-09-14 定形）。
 *
 * 以前 payload 是裸 unknown，插件只能靠猜；这里把「宿主埋点时到底传什么」
 * 写成类型，插件端可以 `payload as HookPayloadMap['cardMoved']` 安全收窄。
 * 埋点处请用 `emitHookTyped` 触发，编译器会替我们核对载荷。
 */
export interface HookPayloadMap {
  /** 选中集合变化（含取消选中） */
  cardSelected: { cardId: string; selectedIds: string[] }
  /** 单张卡片移动结束（松手提交一次，不随拖拽过程触发） */
  cardMoved: { cardId: string; x: number; y: number }
  /** 新增卡片（新建 / 拖入 / 粘贴 / 插件建卡） */
  cardCreated: { card: Card }
  /** 卡片被移除（移入 `_已移除`，文件仍在硬盘） */
  cardRemoved: { cardIds: string[] }
  /** 分区框改名成功（硬盘文件夹已同步改名） */
  partitionRenamed: { partitionId: string; previousName: string; nextName: string }
  /** 进入某个空间 */
  spaceOpened: { spacePath: string }
  /** 离开空间（返回列表） */
  spaceClosed: { spacePath: string }
}

// ---------------------------------------------------------------------------
// 内部存储
// ---------------------------------------------------------------------------

const cardTypes = new Map<string, CardTypeDef>()
const pluginMenuItems = new Map<string, { item: MenuItem; cardType?: string }>()
const canvasMenuItems = new Map<string, CanvasMenuItem>()
const toolbarItems = new Map<string, ToolbarItemDef>()
const hookHandlers = new Map<HookName, Set<HookFn>>()

/** 归属登记：插件 id → 该插件登记过的条目（禁用 / 卸载时据此回收） */
type OwnedKind = 'cardType' | 'menuItem' | 'canvasMenuItem' | 'toolbarItem' | 'hook'

interface OwnedRegistration {
  kind: OwnedKind
  /**
   * 注销用的键（与各注册表的键一致）：
   *   cardType       → type
   *   menuItem       → `${cardType ?? '*'}:${id}`
   *   canvasMenuItem → id
   *   toolbarItem    → id
   *   hook           → HookName
   */
  key: string
  /** 仅 kind='hook' 需要：注销时必须传回同一个函数引用 */
  hookFn?: HookFn
  /**
   * 注册时由本插件交出去的那个对象（def / item / fn），注销时用它做**同一性校验**：
   * 只有当注册表里的当前值仍是它，才允许删除。
   *
   * 为什么必须校验：两个插件可能注册同一个 id（Map 单键）。若不校验，
   * 「注销 A」会把 B 后来覆盖上去的定义一起删掉 —— 插件的禁用会波及别的插件，
   * 与「插件抛错只影响自己」的设计原则冲突。
   */
  ref?: unknown
}

const pluginOwners = new Map<string, OwnedRegistration[]>()

/**
 * 注册表版本号。任何注册 / 注销都自增一次。
 * UI（设置页插件列表、菜单）订阅它即可在插件启停后立刻刷新，
 * 不必为「菜单是即时查表」这一事实额外造一套失效通知。
 */
let registryVersion = 0

function warnDuplicate(kind: string, id: string): void {
  console.warn(`[pluginCenter] ${kind}「${id}」重复注册，已用新定义覆盖旧定义。`)
}

function bumpRegistryVersion(): void {
  registryVersion += 1
}

// ---------------------------------------------------------------------------
// 接口 1：卡片类型
// ---------------------------------------------------------------------------

export function registerCardType(def: CardTypeDef): void {
  if (!def.type) throw new Error('registerCardType 失败：type 不能为空')
  if (cardTypes.has(def.type)) warnDuplicate('卡片类型', def.type)
  cardTypes.set(def.type, def)
  bumpRegistryVersion()
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
  bumpRegistryVersion()
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
// 接口 2b：画布空白菜单（2026-09-14 新增）
// ---------------------------------------------------------------------------

export function registerCanvasMenuItem(item: CanvasMenuItem): void {
  if (!item.id) throw new Error('registerCanvasMenuItem 失败：id 不能为空')
  if (canvasMenuItems.has(item.id)) warnDuplicate('画布菜单项', item.id)
  canvasMenuItems.set(item.id, item)
  bumpRegistryVersion()
}

/** 列出插件注册的画布空白菜单项（按注册顺序） */
export function listRegisteredCanvasMenuItems(): CanvasMenuItem[] {
  return [...canvasMenuItems.values()]
}

// ---------------------------------------------------------------------------
// 接口 3：工具栏
// ---------------------------------------------------------------------------

export function registerToolbarItem(item: ToolbarItemDef): void {
  if (!item.id) throw new Error('registerToolbarItem 失败：id 不能为空')
  if (toolbarItems.has(item.id)) warnDuplicate('工具栏项', item.id)
  toolbarItems.set(item.id, item)
  bumpRegistryVersion()
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
  bumpRegistryVersion()
}

export function unregisterHook(name: HookName, fn: HookFn): void {
  hookHandlers.get(name)?.delete(fn)
  bumpRegistryVersion()
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

/**
 * 类型安全的触发入口：载荷由 HookPayloadMap 校验（埋点推荐用这个）。
 * 内部仍是 emitHook，只是把「传错载荷」变成编译期错误。
 */
export function emitHookTyped<K extends HookName>(name: K, payload: HookPayloadMap[K]): number {
  return emitHook(name, payload)
}

/** 列出某钩子已注册的回调数量（调试 / 测试用） */
export function countHookHandlers(name: HookName): number {
  return hookHandlers.get(name)?.size ?? 0
}

// ---------------------------------------------------------------------------
// 归属与版本（插件管理期新增）
// ---------------------------------------------------------------------------

/** 当前注册表版本号。注册 / 注销都会让它自增。 */
export function getRegistryVersion(): number {
  return registryVersion
}

/** 列出某插件登记过的条目种类与数量（设置页「详情」用） */
export function listPluginContributions(pluginId: string): {
  cardTypes: number
  menuItems: number
  canvasMenuItems: number
  toolbarItems: number
  hooks: number
} {
  const owned = pluginOwners.get(pluginId) ?? []
  const count = (kind: OwnedKind) => owned.filter((item) => item.kind === kind).length
  return {
    cardTypes: count('cardType'),
    menuItems: count('menuItem'),
    canvasMenuItems: count('canvasMenuItem'),
    toolbarItems: count('toolbarItem'),
    hooks: count('hook'),
  }
}

/**
 * 插件唯一入口：绑定 pluginId 的注册 API。
 *
 * 插件**不得**直接 import 本模块的 registerX —— 否则宿主无从知道这些条目属于谁，
 * 也就无法「禁用 / 卸载」。宿主在 activate(api) 时把本对象交给插件。
 */
export interface PluginApi {
  /** 当前插件 id（反向域名风格） */
  readonly pluginId: string
  registerCardType: (def: CardTypeDef) => void
  registerMenuItem: (item: MenuItem, cardType?: string) => void
  registerCanvasMenuItem: (item: CanvasMenuItem) => void
  registerToolbarItem: (item: ToolbarItemDef) => void
  registerHook: (name: HookName, fn: HookFn) => void
}

export function createPluginApi(pluginId: string): PluginApi {
  if (!pluginId) throw new Error('createPluginApi 失败：pluginId 不能为空')

  const own = (registration: OwnedRegistration): void => {
    const list = pluginOwners.get(pluginId)
    if (list) list.push(registration)
    else pluginOwners.set(pluginId, [registration])
  }

  return {
    pluginId,
    registerCardType(def) {
      registerCardType(def)
      own({ kind: 'cardType', key: def.type, ref: def })
    },
    registerMenuItem(item, cardType) {
      registerMenuItem(item, cardType)
      own({ kind: 'menuItem', key: `${cardType ?? '*'}:${item.id}`, ref: item })
    },
    registerCanvasMenuItem(item) {
      registerCanvasMenuItem(item)
      own({ kind: 'canvasMenuItem', key: item.id, ref: item })
    },
    registerToolbarItem(item) {
      registerToolbarItem(item)
      own({ kind: 'toolbarItem', key: item.id, ref: item })
    },
    registerHook(name, fn) {
      registerHook(name, fn)
      own({ kind: 'hook', key: name, hookFn: fn, ref: fn })
    },
  }
}

/**
 * 回收某插件的全部注册（「禁用」与「卸载」都先走这一步）。
 * @returns 实际摘除的条目数量
 *
 * 幂等：未登记的插件返回 0，不抛错。
 */
export function disposePlugin(pluginId: string): number {
  const owned = pluginOwners.get(pluginId)
  pluginOwners.delete(pluginId)
  if (!owned || owned.length === 0) return 0

  let removed = 0
  for (const registration of owned) {
    switch (registration.kind) {
      case 'cardType':
        if (cardTypes.get(registration.key) === registration.ref && cardTypes.delete(registration.key)) {
          removed += 1
        }
        break
      case 'menuItem': {
        // 注册表存的是包装对象，比对内部 item 的同一性
        const entry = pluginMenuItems.get(registration.key)
        if (entry?.item === registration.ref && pluginMenuItems.delete(registration.key)) removed += 1
        break
      }
      case 'canvasMenuItem':
        if (
          canvasMenuItems.get(registration.key) === registration.ref &&
          canvasMenuItems.delete(registration.key)
        ) {
          removed += 1
        }
        break
      case 'toolbarItem':
        if (
          toolbarItems.get(registration.key) === registration.ref &&
          toolbarItems.delete(registration.key)
        ) {
          removed += 1
        }
        break
      case 'hook': {
        const set = hookHandlers.get(registration.key as HookName)
        if (set && registration.hookFn && set.delete(registration.hookFn)) removed += 1
        break
      }
    }
  }

  bumpRegistryVersion()
  return removed
}

/** 某插件是否登记过任何条目（测试用） */
export function hasPluginContributions(pluginId: string): boolean {
  return (pluginOwners.get(pluginId)?.length ?? 0) > 0
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
  canvasMenuItems.clear()
  toolbarItems.clear()
  hookHandlers.clear()
  pluginOwners.clear()
  bumpRegistryVersion()
}
