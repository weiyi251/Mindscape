// ============================================================================
// 模块说明（中文）
// 「多选对齐与分布」的编排层（2026-09-20 用户计划 C3）。
//
// 纯几何在 core/geometry/align.ts（六向对齐 + 两向等距分布），本文件只做三件事：
//   ① 把卡片（含 meta.locked）翻译成几何层的输入；
//   ② 把几何结果交给**现成的** moveCards 命令执行 —— 不另造一条「对齐命令」，
//      于是撤销 / 重做 / cardMoved 生命周期钩子 / 落盘全部沿用既有链路；
//   ③ 无可移动位移（已对齐、参与项不足）时静默 no-op，不让空操作占满撤销栈
//      （与拖拽的 hasMeaningfulMove 同一哲学）。
//
// 依赖以参数注入（不直接 import store / history），可在 node 环境单测。
// 菜单接线三处：core/registry/menus.ts 的 CARD_ACTION.align 与文案表、
// pages/board/contextMenus.tsx 的 buildAlignItems、
// pages/board/menuEntries.ts 的二级菜单弹出。
// ============================================================================

import { lockedOfMeta } from '@/core/board/cardMeta'
import { createMoveCardsCommand } from '@/core/commands/impl/moveCards'
import type { ApplyCardPositions, CardMoveDelta } from '@/core/commands/impl/moveCards'
import type { Command } from '@/core/commands/types'
import { computeAlignMoves } from '@/core/geometry/align'
import type { AlignItem, AlignOperation } from '@/core/geometry/align'
import type { Card } from '@/core/types'

export interface AlignCardsDeps {
  /** 执行命令（Board 传 history.execute，成功后自动入撤销栈） */
  execute: (command: Command) => Promise<void>
  /** 请求落盘（Board 传 writer.schedule） */
  schedule: () => void
  /** 写回层（Board 传 useBoardStore.getState().setCardPositions） */
  applyPositions: ApplyCardPositions
}

/** 卡片 → 几何层输入。锁定标记沿用 lockedOfMeta（只认布尔真值，脏数据当未锁定） */
export function alignItemsOf(cards: readonly Card[]): AlignItem[] {
  return cards.map((card) => ({
    id: card.id,
    rect: { x: card.x, y: card.y, w: card.w, h: card.h },
    locked: lockedOfMeta(card.meta),
  }))
}

/** 卡片 id → 当前位置（用于推导命令的 from，undo 才能整组还原） */
function positionsOf(cards: readonly Card[]): Map<string, { x: number; y: number }> {
  return new Map(cards.map((card) => [card.id, { x: card.x, y: card.y }]))
}

/**
 * 执行一次对齐 / 分布（可撤销）。
 * 作用范围由调用方给定（菜单层已按「右键卡是否在选中集合内」解析好 targets）。
 */
export function runAlignCards(
  cards: readonly Card[],
  operation: AlignOperation,
  deps: AlignCardsDeps
): Promise<void> {
  const moves = computeAlignMoves(alignItemsOf(cards), operation)
  if (moves.length === 0) return Promise.resolve()

  const from = positionsOf(cards)
  const deltas: CardMoveDelta[] = []
  for (const move of moves) {
    const origin = from.get(move.id)
    if (!origin) continue
    deltas.push({ id: move.id, from: origin, to: { x: move.x, y: move.y } })
  }
  if (deltas.length === 0) return Promise.resolve()

  return deps
    .execute(createMoveCardsCommand(deltas, deps.applyPositions))
    .then(() => deps.schedule())
}
