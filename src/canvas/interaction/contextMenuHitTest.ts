// ============================================================================
// 模块说明（中文）
// 画布右键菜单的命中判定（2026-09-21 移动端适配 M2 从 Canvas.tsx 外抽）。
//
// 为什么要抽出来：桌面版这套「连线 → 卡片 → 分区 → 空白」的四级判定原本内联在
// `contextmenu` 事件监听里（Canvas.tsx）。移动端把长按当右键用（决策 D4），
// 长按触发点复用的是**同一份判定**，否则两条链路会各自演化 —— 桌面改一处、
// 移动端忘一处，是这类"命中顺序"代码最典型的腐化方式。
//
// Canvas.tsx 有行数棘轮（架构守卫规则 1），外抽之后长按接线才塞得回去。
//
// 判定顺序即优先级，不能调：
//   ① 连线画在卡片之下但有自己的 SVG path，`closest` 到 data-connection-id 即命中；
//   ② 卡片（图片 / 便签 / 插件卡）；
//   ③ 分区框（框体本身，不含标题按钮 —— 那由 click 处理）；
//   ④ 都没命中就是空白（新建便签的落点、以及「粘贴 / 全选」这类画布级操作）。
//
// 属性名由调用方注入（Canvas.tsx 才是那四个 *_ATTR 常量的持有者）：本模块因此
// 不 import 任何组件，纯函数 + 结构化最小 DOM 契约 → node 下用假元素即可测。
//
// 两个出口：hitTestCanvasTarget 只判定，dispatchCanvasContextMenu 判定完顺手分派给
// 上层回调。Canvas.tsx 的两个入口（contextmenu 与长按）都调后者。
// ============================================================================

import type { Point } from './coordinates'

/** 命中结果（调用方按 kind 分派到各自的菜单构造函数） */
export type CanvasContextMenuTarget =
  | { kind: 'connection'; connectionId: string }
  | { kind: 'card'; cardId: string }
  | { kind: 'partition'; partitionId: string }
  | { kind: 'blank' }

/** 四个层级各自用哪个 DOM 属性承载 id */
export interface HitTestAttributes {
  connectionId: string
  cardId: string
  partitionId: string
}

/** 判定所需的最小 DOM 能力（HTMLElement 天然满足，测试用假对象即可） */
export interface HitTestElement {
  closest(selector: string): HitTestElement | null
  getAttribute(name: string): string | null
}

/**
 * 从按下 / 右键的元素向上找它属于哪个画布对象。
 *
 * @param element 事件目标的最近元素（可为 null）
 * @returns 命中的对象；四级都没命中时返回 `{ kind: 'blank' }`
 */
export function hitTestCanvasTarget(
  element: HitTestElement | null,
  attrs: HitTestAttributes,
): CanvasContextMenuTarget {
  if (!element) return { kind: 'blank' }

  const connection = element.closest(`[${attrs.connectionId}]`)
  const connectionId = connection?.getAttribute(attrs.connectionId)
  if (connectionId) return { kind: 'connection', connectionId }

  const card = element.closest(`[${attrs.cardId}]`)
  const cardId = card?.getAttribute(attrs.cardId)
  if (cardId) return { kind: 'card', cardId }

  const partition = element.closest(`[${attrs.partitionId}]`)
  const partitionId = partition?.getAttribute(attrs.partitionId)
  if (partitionId) return { kind: 'partition', partitionId }

  return { kind: 'blank' }
}

/** 分派所需的一整套依赖（调用方用 ref 现取，避免闭包里握住过期集合） */
export interface CanvasContextMenuDispatch<TCard, TPartition> {
  attributes: HitTestAttributes
  /** 已移除视图（T2.8）：灰卡的菜单上面几级照常弹，但空白不弹画布菜单 */
  removedMode: boolean
  findCard: (cardId: string) => TCard | undefined
  findPartition: (partitionId: string) => TPartition | undefined
  onConnection: (connectionId: string, screen: Point) => void
  onCard: (card: TCard, screen: Point) => void
  onPartition: (partition: TPartition, screen: Point) => void
  /** 空白命中（removedMode 时不会被调用）：参数是屏幕坐标，画布坐标由调用方换算 */
  onBlank: (screen: Point) => void
}

/**
 * 命中判定 + 分派一步到位。
 *
 * 命中了对象但集合里找不到它（例如菜单弹出的同一帧卡片被删了）时**静默放弃**，
 * 与桌面版原内联实现的行为一致：宁可不弹，也不弹一个指向不存在对象的菜单。
 */
export function dispatchCanvasContextMenu<TCard, TPartition>(
  element: HitTestElement | null,
  screen: Point,
  deps: CanvasContextMenuDispatch<TCard, TPartition>,
): void {
  const target = hitTestCanvasTarget(element, deps.attributes)

  switch (target.kind) {
    case 'connection':
      deps.onConnection(target.connectionId, screen)
      return
    case 'card': {
      const card = deps.findCard(target.cardId)
      if (card) deps.onCard(card, screen)
      return
    }
    case 'partition': {
      const partition = deps.findPartition(target.partitionId)
      if (partition) deps.onPartition(partition, screen)
      return
    }
    case 'blank':
      if (deps.removedMode) return
      deps.onBlank(screen)
  }
}
