// ============================================================================
// 模块说明（中文）
// 多选「对齐与分布」的纯几何层（2026-09-20 用户计划 C3）。
//
// 只做纯算术：给定一组卡片的当前矩形与锁定标记，算出每张卡的目标左上角坐标。
// 不读 store、不碰命令栈、不 import 任何上层模块，因此可在 node 环境完整单测
// （本项目不引入 jsdom，见 CONTRIBUTING「测试约定」）。
//
// 两条语义约定（2026-09-20 用户裁决）：
//   · **锁定卡参与对齐、不参与分布** —— 对齐时锁定卡自己不动，但它的边界计入
//     选区包围盒（可作为其他卡对齐的基准）；分布时锁定卡整体退出参与集合，
//     否则它那「被用户钉住」的位置会变成锚点，把其余卡片挤成一堆。
//   · 分布对齐的是**相邻间隙**（与 Figma「水平 / 垂直分布间距」同义），不是中心等距：
//     按主轴排序后**首尾两张保持原位**，中间的卡重新摆放使相邻间隙相等。
//     可用空间不足时间隙为负（卡片允许重叠），但结果恒为有限数。
//
// 坐标系无关：输入输出都是画布坐标下的轴对齐矩形。
// 命令与 UI 分别见 core/commands/impl/moveCards.ts（复用现成的移动命令，不另造一条）
// 与 pages/board/alignCardsFlow.ts。
// ============================================================================

import type { Rect } from './rect'

/** 6 向对齐方式 */
export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'
/** 2 向等距分布方式 */
export type DistributeMode = 'distribute-h' | 'distribute-v'
/** 对齐与分布的统称（菜单二级项直接以它作为动作 id 后缀） */
export type AlignOperation = AlignMode | DistributeMode

/** 参与计算的一张卡片：id + 当前矩形 + 是否锁定（锁定 = 位置冻结） */
export interface AlignItem {
  id: string
  rect: Rect
  locked: boolean
}

/** 一张卡的目标位置（左上角，画布坐标） */
export interface AlignMove {
  id: string
  x: number
  y: number
}

/** 全部对齐方式（顺序即二级菜单里的显示顺序） */
export const ALIGN_MODES: readonly AlignMode[] = [
  'left',
  'hcenter',
  'right',
  'top',
  'vcenter',
  'bottom',
]

/** 全部分布方式（顺序即二级菜单里的显示顺序） */
export const DISTRIBUTE_MODES: readonly DistributeMode[] = ['distribute-h', 'distribute-v']

/** 是否为 6 向对齐（其余按分布处理） */
export function isAlignMode(operation: AlignOperation): operation is AlignMode {
  return (ALIGN_MODES as readonly string[]).includes(operation)
}

/** 对齐至少需要 2 张卡（含锁定卡 —— 它可以当基准） */
export function canAlign(items: readonly AlignItem[]): boolean {
  return items.length >= 2
}

/** 分布至少需要 3 张**未锁定**卡（两张之间没有「中间项」可摆） */
export function canDistribute(items: readonly AlignItem[]): boolean {
  return items.filter((item) => !item.locked).length >= 3
}

/**
 * 计算一次对齐 / 分布需要施加的位移。
 *
 * 返回值只包含**真的要移动**的卡片（位置未变的卡不出现）；不可执行（参与项不足）
 * 或结果恰好原位时返回空数组 —— 调用方据此静默 no-op，不必再判断一次
 * （与 moveCards 的 `hasMeaningfulMove` 同一哲学：不让无意义操作占满撤销栈）。
 */
export function computeAlignMoves(
  items: readonly AlignItem[],
  operation: AlignOperation
): AlignMove[] {
  return isAlignMode(operation) ? alignMoves(items, operation) : distributeMoves(items, operation)
}

/** 6 向对齐：选区包围盒（含锁定卡）作为基准，锁定卡自身位置不变 */
function alignMoves(items: readonly AlignItem[], mode: AlignMode): AlignMove[] {
  if (!canAlign(items)) return []

  // Selection bounding box. Locked cards are frozen but still contribute their
  // edges: aligning everything to a pinned card is exactly what users expect.
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const item of items) {
    minX = Math.min(minX, item.rect.x)
    minY = Math.min(minY, item.rect.y)
    maxX = Math.max(maxX, item.rect.x + item.rect.w)
    maxY = Math.max(maxY, item.rect.y + item.rect.h)
  }

  const moves: AlignMove[] = []
  for (const item of items) {
    if (item.locked) continue
    const { x, y, w, h } = item.rect
    let targetX = x
    let targetY = y
    switch (mode) {
      case 'left':
        targetX = minX
        break
      case 'hcenter':
        targetX = (minX + maxX) / 2 - w / 2
        break
      case 'right':
        targetX = maxX - w
        break
      case 'top':
        targetY = minY
        break
      case 'vcenter':
        targetY = (minY + maxY) / 2 - h / 2
        break
      case 'bottom':
        targetY = maxY - h
        break
    }
    if (targetX !== x || targetY !== y) moves.push({ id: item.id, x: targetX, y: targetY })
  }
  return moves
}

/**
 * 2 向等距分布：跳过锁定卡，按主轴位置升序后首尾固定、中间等间隙。
 * 排序用原生 sort（ES2019 起保证稳定），同坐标的卡保持传入顺序。
 */
function distributeMoves(items: readonly AlignItem[], mode: DistributeMode): AlignMove[] {
  if (!canDistribute(items)) return []

  const horizontal = mode === 'distribute-h'
  const startOf = (rect: Rect) => (horizontal ? rect.x : rect.y)
  const sizeOf = (rect: Rect) => (horizontal ? rect.w : rect.h)

  const sorted = items
    .filter((item) => !item.locked)
    .sort((a, b) => startOf(a.rect) - startOf(b.rect))

  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  // Span runs from the first card's leading edge to the last card's trailing edge,
  // so "first and last stay put" is literally true regardless of their sizes.
  const span = startOf(last.rect) + sizeOf(last.rect) - startOf(first.rect)
  const totalSize = sorted.reduce((sum, item) => sum + sizeOf(item.rect), 0)
  const gap = (span - totalSize) / (sorted.length - 1)

  const moves: AlignMove[] = []
  let cursor = startOf(first.rect) + sizeOf(first.rect) + gap
  for (let index = 1; index < sorted.length - 1; index += 1) {
    const item = sorted[index]
    const x = horizontal ? cursor : item.rect.x
    const y = horizontal ? item.rect.y : cursor
    cursor += sizeOf(item.rect) + gap
    if (x !== item.rect.x || y !== item.rect.y) moves.push({ id: item.id, x, y })
  }
  return moves
}
