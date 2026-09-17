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
