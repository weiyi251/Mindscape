// ============================================================================
// 模块说明（中文）
// 「锁定 / 解锁卡片」的编排层（2026-09-20 用户要求：摆好版面后防误拖）。
//
// 锁定语义（范围刻意收窄，见 core/board/cardMeta.ts 的 lockedOfMeta 说明）：
// **位置与尺寸冻结** —— 拖不动、拖不小；选中 / 连线 / 右键菜单 / 打开原图照常。
// 所以本动作只是一次 meta 翻转（走既有 setCardMeta 命令，可撤销），
// 不加确认框、不留撤销栈之外的副作用。
//
// 依赖全部以参数注入（不直接 import store / history），可在 node 环境单测。
// ============================================================================

import { lockedOfMeta, metaWithLocked } from '@/core/board/cardMeta'
import { createSetCardMetaCommand } from '@/core/commands/impl/setCardMeta'
import type { ApplyCardMeta } from '@/core/commands/impl/setCardMeta'
import type { Command } from '@/core/commands/types'
import type { Card } from '@/core/types'

export interface CardLockDeps {
  /** 执行命令（Board 传 history.execute，成功后自动入撤销栈） */
  execute: (command: Command) => Promise<void>
  /** 请求落盘（Board 传 writer.schedule） */
  schedule: () => void
  /** 写回层（Board 传 useBoardStore.getState().setCardMeta） */
  applyMeta: ApplyCardMeta
}

/**
 * 翻转单张卡片的锁定状态（可撤销）。
 * 菜单一次只作用于右键的那张卡 —— 锁定是「针对具体位置的意图」，
 * 批量锁定没有明确语义（用户要的是钉住这一张）。
 */
export function toggleCardLock(card: Card, deps: CardLockDeps): Promise<void> {
  const next = !lockedOfMeta(card.meta)
  return deps
    .execute(
      createSetCardMetaCommand(card.id, card.meta, metaWithLocked(card.meta, next), deps.applyMeta),
    )
    .then(() => deps.schedule())
}
