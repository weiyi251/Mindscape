// ============================================================================
// 模块说明（中文）
// 待办卡片的**几何测量**：把「渲染后的真实行位置」变成锚点表与卡片高度。
//
// 为什么算术不够（2026-09-18 修复「长文本被截断、不换行」）：
//   条目文本改成多行自动换行后，行高不再恒定 —— 第 0 行可能 24px、第 1 行可能
//   48px，任何「padTop + index × 步进」的公式都必然与真实渲染错位，
//   表现就是连线点偏离条目、卡片高度撑不下内容。于是几何一律以 DOM 实测为准：
//   每行读 offsetTop / offsetHeight，锚点 = 行的垂直中心，换行 / 字号 /
//   卡片宽度引起的重排都自动被吸收。
//
// 纯函数的边界（可在 node 环境单测的前提）：本模块**只读传进来的鸭子类型对象**，
// 不碰 window / document —— 项目禁 jsdom，依赖注入是唯一出路，
// 真正在浏览器里跑的那几行（取 ref / 挂 ResizeObserver）留在 view.tsx。
// ============================================================================

import { TODO_MIN_HEIGHT, TODO_PAD_BOTTOM } from './todos'

/** 条目行的标记属性：`data-todo-row="<条目 id>"` */
export const TODO_ROW_ATTR = 'data-todo-row'
/** 上面这个属性在 dataset 里的键名（data-todo-row → todoRow） */
const ROW_DATASET_KEY = 'todoRow'

/** 单个条目行的测量结果（相对内容容器顶边，布局像素） */
export interface TodoRowMeasurement {
  /** 条目 id */
  id: string
  /** 行顶边相对容器顶边的 y */
  top: number
  /** 行实际高度（换行后变高） */
  height: number
}

/**
 * 行元素的最小契约（HTMLElement 天然满足；测试可以造假对象）。
 * 只声明测量用得到的三个字段，免得单测为了凑类型去造整个 DOM。
 */
export interface TodoRowElement {
  dataset?: Record<string, string | undefined>
  offsetTop?: number
  offsetHeight?: number
}

/** 内容容器的最小契约 */
export interface TodoRootElement {
  querySelectorAll?: (selector: string) => ArrayLike<TodoRowElement>
  offsetHeight?: number
}

/** 几何同步的结果：锚点表（core 的 itemAnchors 协议）+ 卡片应有高度 */
export interface TodoGeometry {
  /** 条目 id → 行中心相对卡片顶边的 y */
  anchors: Record<string, number>
  /** 内容自然高度（不含人工压缩），作为卡片新高度 */
  height: number
}

/** 半像素取整：DOM 给出整数、行中心通常是 .5，再细就纯属浮点噪声 */
function round(value: number): number {
  return Math.round(value * 2) / 2
}

/** 合法像素值：有限且非负（元素尚未排版时 DOM 会给 0，负值一定是脏数据） */
function pixel(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return value
}

/**
 * 从容器里读出所有条目行的位置与高度。
 * 脏行（无 id / 尚未排版 / 数值异常）直接跳过 —— 宁可这一行没有锚点，
 * 也不能把 NaN 写进 meta，那会让整张卡的连线端点全变成 NaN。
 */
export function measureTodoRows(root: TodoRootElement | null): TodoRowMeasurement[] {
  const nodes = root?.querySelectorAll?.(`[${TODO_ROW_ATTR}]`)
  if (!nodes) return []
  const rows: TodoRowMeasurement[] = []
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    const id = node?.dataset?.[ROW_DATASET_KEY]
    const top = pixel(node?.offsetTop)
    const height = pixel(node?.offsetHeight)
    if (typeof id !== 'string' || id === '' || top === null || height === null) continue
    rows.push({ id, top, height })
  }
  return rows
}

/**
 * 由「行的实测值 + 兜底高度」推出几何：
 *   · 锚点 = 行垂直中心（连线点画在行右缘中点，两者必须重合）
 *   · 高度 = **max(最后一行底边 + 下内边距, 兜底高度)**，再兜一层最小高度。
 *
 * 为什么以行底边为主判据（2026-09-18「拖高均分」改造）：条目区改为 flex 均分后，
 * 容器高度**恒等于 card.h**（被拉伸），「容器自然高度」不再反映内容需要 ——
 * 内容变多时行只是溢出容器（不压缩，见 view 的 shrink-0），唯一可靠的信号是
 * 实测行的底边位置；内容变少时行被拉伸回填，底边 ≈ 容器底边，同样稳定。
 * 容器还没排版（兜底高度 = 0）时退回最小高度，免得卡片被压成一条线。
 */
export function todoGeometryOf(rows: TodoRowMeasurement[], fallbackHeight: number): TodoGeometry {
  const anchors: Record<string, number> = {}
  let bottom = 0
  for (const row of rows) {
    anchors[row.id] = round(row.top + row.height / 2)
    bottom = Math.max(bottom, row.top + row.height)
  }
  const fallback = pixel(fallbackHeight) ?? 0
  const height = Math.max(bottom + TODO_PAD_BOTTOM, fallback, TODO_MIN_HEIGHT)
  return { anchors, height: Math.max(round(height), TODO_MIN_HEIGHT) }
}

/** 容差（px）：小于它的差异不值得写入 —— ResizeObserver 的抖动与自激循环就靠它挡住 */
export const GEOMETRY_TOLERANCE = 0.5

/**
 * 是否需要向画布同步几何。
 *
 * 幂等是硬要求：写入会改 card.h → 触发重渲染 → 测量回调再跑一次，
 * 没有这道闸门就会无限循环（看起来像「卡片自己在抖」）。
 */
export function needsGeometrySync(current: TodoGeometry, next: TodoGeometry): boolean {
  if (Math.abs(current.height - next.height) > GEOMETRY_TOLERANCE) return true
  const keys = new Set([...Object.keys(current.anchors), ...Object.keys(next.anchors)])
  for (const key of keys) {
    const before = current.anchors[key]
    const after = next.anchors[key]
    if (before === undefined || after === undefined) return true
    if (Math.abs(before - after) > GEOMETRY_TOLERANCE) return true
  }
  return false
}
