// ============================================================================
// 模块说明（中文）
// 待办卡片插件的**纯逻辑**：条目数据模型、meta 读写、布局几何（高度 / 锚点）。
//
// 数据存放约定（与 noteColor / hoverLabel 同一思路 —— meta 是 4.2 的自由扩展位）：
//   card.meta.items        —— 条目数组 [{ id, text, done }]（本插件自管的私有数据）
//   card.meta.itemAnchors  —— 条目 id → 行中心相对卡片顶边的 y 偏移
//
//   其中 itemAnchors 是 **core 的通用协议**（core/board/cardMeta.ts 的
//   itemAnchorsOfMeta）：插件自算偏移写入，连线端点计算只查表不认识本插件 ——
//   这是「core 不认识具体插件」铁律下的分工。
//
// 2026-09-18（长文本换行修复）：条目文本改为**多行自动换行**，行高不再恒定 ——
//   第 0 行可能 24px、第 1 行可能 48px，任何「行数 × 步进」的算术都必然与真实
//   渲染错位（连线点偏离条目、卡片撑不下内容）。因此几何改由 view 挂载后实测
//   DOM（measure.ts）并经画布桥 syncCardGeometry 写回；
//   这里的高度与锚点只剩「还没渲染过时的估算初值」这一处职责。
// 内容本身的提交（输入 / 勾选 / 增删）仍走 updateCardContent，一条命令可撤销。
// ============================================================================

import { ITEM_ANCHORS_META_KEY } from '@/core/board/cardMeta'
import type { Meta } from '@/core/types'

/** 单条待办（meta.items 的元素） */
export interface TodoItem {
  /** 条目 id（卡片内唯一；连线 fromItem / toItem 用它定位到行） */
  id: string
  /** 待办内容 */
  text: string
  /** 完成态（复选框打勾） */
  done: boolean
}

/** 条目数组在 meta 里的键名 */
export const TODO_ITEMS_META_KEY = 'items'

/** 卡片标题在 meta 里的键名（2026-09-18 用户需求：待办卡支持标题） */
export const TODO_TITLE_META_KEY = 'title'

/**
 * 完成项的排列策略（2026-09-18 用户需求：完成项自动置底或置顶，可自定义）。
 *   · 'none'   —— 不重排（默认，保持用户手动排序）；
 *   · 'bottom' —— 已完成条目移到列表底部；
 *   · 'top'    —— 已完成条目移到列表顶部。
 */
export type TodoCompletedPlacement = 'none' | 'bottom' | 'top'

/** placement 在 meta 里的键名 */
export const TODO_PLACEMENT_META_KEY = 'completedPlacement'

// ---------------------------------------------------------------------------
// 布局常量（画布像素；view.tsx 的样式必须与这里对齐 —— 锚点 / 高度靠它们算）
// ---------------------------------------------------------------------------

/** 新建卡片默认宽度 */
export const TODO_DEFAULT_W = 220
/** 上下内边距 */
export const TODO_PAD_TOP = 10
export const TODO_PAD_BOTTOM = 10
/** 单行高度估算（条目行与添加行同高）—— **只是估算**：用于新建卡片的初始尺寸 */
export const TODO_ROW_HEIGHT = 28
/** 行间视觉间隔（仅观感；真正的行间隔由 view 的 flex gap 决定） */
export const TODO_ROW_GAP = 2
/** 行步进 = 行高 + 间隔（仅供上面的估算使用） */
export const TODO_ROW_STEP = TODO_ROW_HEIGHT + TODO_ROW_GAP
/**
 * 卡片最小高度：上内边距 + 一行 + 下内边距。
 * 空卡片也要能容纳底部添加行的完整高度，否则新建出来就被裁掉半行。
 */
export const TODO_MIN_HEIGHT = TODO_PAD_TOP + TODO_ROW_HEIGHT + TODO_PAD_BOTTOM

/**
 * **估算**卡片高度：上内边距 + 条目行（按步进）+ 底部添加行 + 下内边距。
 * 空卡片也保留添加行（一建出来就能开始输入）。
 *
 * ⚠️ 2026-09-18 起这只是**初始尺寸**：条目文本支持换行后行高不再恒定，
 * 卡片挂载后由 `measure.ts` 实测 DOM 并把真实高度同步回画布（api.board.syncCardGeometry）。
 */
export function todoCardHeight(itemCount: number): number {
  const rows = Math.max(itemCount, 0)
  return TODO_PAD_TOP + rows * TODO_ROW_STEP + TODO_ROW_HEIGHT + TODO_PAD_BOTTOM
}

/**
 * **估算**条目锚点表：第 i 行的中心相对卡片顶边的 y 偏移。
 *
 * ⚠️ 同样是初值（理由见 todoCardHeight）：真正生效的是实测值。
 * 之所以还留着它，是为了让 meta 在卡片还没渲染过（比如刚撤销到旧状态、
 * 视图尚未挂载）时也有一份大致正确的锚点，连线不至于飞到卡片外。
 */
export function todoItemAnchors(items: TodoItem[]): Record<string, number> {
  const anchors: Record<string, number> = {}
  items.forEach((item, index) => {
    anchors[item.id] = TODO_PAD_TOP + index * TODO_ROW_STEP + TODO_ROW_HEIGHT / 2
  })
  return anchors
}

// ---------------------------------------------------------------------------
// meta 读写
// ---------------------------------------------------------------------------

/**
 * 从 meta 读条目列表。脏数据兜底：不是数组 / 元素不合规的条目剔除、
 * 字段类型不对的取缺省 —— 视图层绝不因落盘数据损坏而崩溃。
 */
export function todosOfMeta(meta: Meta): TodoItem[] {
  const raw = meta[TODO_ITEMS_META_KEY]
  if (!Array.isArray(raw)) return []
  const items: TodoItem[] = []
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id : ''
    if (id === '') continue
    items.push({
      id,
      text: typeof record.text === 'string' ? record.text : '',
      done: record.done === true,
    })
  }
  return items
}

/**
 * 生成带条目列表的 meta 快照（不改动原对象）：items 与 itemAnchors **成对写入**
 * —— 锚点表必须始终与条目列表一致，否则连线端点会错位。
 */
export function metaWithTodos(meta: Meta, items: TodoItem[]): Meta {
  return { ...meta, [TODO_ITEMS_META_KEY]: items, [ITEM_ANCHORS_META_KEY]: todoItemAnchors(items) }
}

/**
 * 新条目工厂：id 取现有 `t<数字>` 的最大值 + 1（连续且不与现存条目冲突；
 * 中间被删除的号码可以复用 —— id 只要求卡片内唯一，不承载历史含义）。
 */
export function newTodoItem(existing: TodoItem[], text: string): TodoItem {
  let max = 0
  for (const item of existing) {
    const match = /^t(\d+)$/.exec(item.id)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return { id: `t${max + 1}`, text, done: false }
}

// ---------------------------------------------------------------------------
// 标题与完成项排列（2026-09-18 用户需求）
// ---------------------------------------------------------------------------

/**
 * 从 meta 读卡片标题：非字符串 / 纯空白一律返回空串（= 无标题）。
 * 视图层对空串不渲染标题行内容（见 view.tsx）。
 */
export function titleOfMeta(meta: Meta): string {
  const raw = meta[TODO_TITLE_META_KEY]
  return typeof raw === 'string' ? raw.trim() : ''
}

/**
 * 生成带标题的 meta 快照（不改动原对象）。标题为空串时**删键**——
 * 与 noteColor 同一策略：meta 里不残留空字符串脏数据。
 */
export function metaWithTitle(meta: Meta, title: string): Meta {
  const next = { ...meta }
  const trimmed = title.trim()
  if (trimmed === '') delete next[TODO_TITLE_META_KEY]
  else next[TODO_TITLE_META_KEY] = trimmed
  return next
}

/**
 * 从 meta 读完成项排列策略：脏数据（非法值）兜底 'none'。
 */
export function placementOfMeta(meta: Meta): TodoCompletedPlacement {
  const raw = meta[TODO_PLACEMENT_META_KEY]
  return raw === 'bottom' || raw === 'top' ? raw : 'none'
}

/**
 * 生成带排列策略的 meta 快照。'none' 时删键（默认值不落盘，数据更干净）。
 */
export function metaWithPlacement(meta: Meta, placement: TodoCompletedPlacement): Meta {
  const next = { ...meta }
  if (placement === 'none') delete next[TODO_PLACEMENT_META_KEY]
  else next[TODO_PLACEMENT_META_KEY] = placement
  return next
}

/**
 * 条目的**显示顺序**：按排列策略把完成项沉底 / 浮顶（稳定排序 ——
 * 同组内的相对顺序不变，用户手动拖出来的次序得以保留）。
 * 数据顺序（items 本身）不被改动：重排是渲染派生，切回 'none' 即还原。
 */
export function orderedTodoItems(items: TodoItem[], placement: TodoCompletedPlacement): TodoItem[] {
  if (placement === 'none') return items
  const pending = items.filter((item) => !item.done)
  const done = items.filter((item) => item.done)
  return placement === 'bottom' ? [...pending, ...done] : [...done, ...pending]
}

/**
 * 拖动排序：把 dragId 的条目移到 targetId 当前所在的位置（其余条目次序平移）。
 * 纯函数，找不到 id 时原样返回新数组（视图拖一个已删条目不至于崩）。
 */
export function reorderTodos(items: TodoItem[], dragId: string, targetId: string): TodoItem[] {
  const from = items.findIndex((item) => item.id === dragId)
  const to = items.findIndex((item) => item.id === targetId)
  if (from === -1 || to === -1 || from === to) return items
  const next = [...items]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}
