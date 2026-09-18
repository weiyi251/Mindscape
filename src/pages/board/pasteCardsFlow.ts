// ============================================================================
// 模块说明（中文）
// 克隆型粘贴的卡片构建（2026-09-18 自 Board.tsx 外抽）：**没有硬盘文件的卡**
// 粘贴时不碰文件系统，直接在数据层克隆 —— 便签与无文件插件卡（待办卡等）
// 共用这一个出口。
//
// 为什么要抽出来：Board 行数棘轮只剩个位数，而这块逻辑（两类卡的克隆规则、
// 「哪些字段跟副本走」的裁决）值得独立单测。文件卡（图片 / 文件）的粘贴
// 走 copyFile + buildIngestedCard，不在这里。
//
// 字段裁决（2026-09-13「粘贴不复制备注与标签」的边界）：
//   · 便签        —— note 就是内容本体，克隆保留；meta 是编辑层，不带；
//   · 无文件插件卡 —— meta 就是内容本体（待办卡的条目清单全在里面），整卡克隆；
//     两者是同一条道理的两面：**内容跟副本走，编辑层不跟**。
// ============================================================================

import { cloneFilelessCard } from '@/core/board/ingest'
import { zCardSchema } from '@/core/types'
import type { Card } from '@/core/types'
import { basenameOf } from '@/core/utils/paths'

/**
 * 由复制源构建「无文件卡」的粘贴副本：换新 id、落到指定画布坐标（坐标取整，
 * 与建卡一致），落点命中分区时分组随目标（不沿用源卡的 group）。
 */
export function clonePastedCard(
  copied: Card,
  id: string,
  x: number,
  y: number,
  groupName: string | null,
): Card {
  // 便签：只带文字内容与尺寸（纯文字，无 meta）
  if (copied.type === 'note') {
    const note = zCardSchema.parse({
      id,
      type: 'note',
      filePath: '',
      originalPath: '',
      x: Math.round(x),
      y: Math.round(y),
      w: copied.w,
      h: copied.h,
      note: copied.note,
    })
    if (groupName) note.group = groupName
    return note
  }
  // 无文件插件卡（待办卡等）：内容全在 meta 里，整卡克隆
  return cloneFilelessCard(copied, id, x, y, groupName)
}

/**
 * 单张卡的**外部剪贴板文本**（2026-09-18 用户裁决：复制到画布之外就是文字）：
 *   · 便签有备注 → 备注正文；
 *   · 待办卡等插件卡 → 条目内容逐行（只认 `meta.items` 数组这个通用形状，
 *     不 import 任何插件 —— 键名是插件自己的约定，core 与本层都不解释含义）；
 *   · 文件 / 图片卡 → 文件名；
 *   · 什么都取不出（空白便签 / 零条目待办）→ 空串，整段跳过 ——
 *     复制一张空卡粘出「note」这种类型代号只会让人困惑。
 */
export function cardToClipboardText(card: Card): string {
  if (card.note.trim() !== '') return card.note.trim()
  const items = card.meta['items']
  if (Array.isArray(items)) {
    const lines = items
      .map((item) =>
        item !== null && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string'
          ? ((item as { text: string }).text.trim())
          : '',
      )
      .filter((text) => text !== '')
    if (lines.length > 0) return lines.join('\n')
  }
  if (card.filePath !== '') return basenameOf(card.filePath)
  return ''
}

/** 多张卡 → 一段一段的文字（段落间空行分隔，与便签多选的外部粘贴一致） */
export function cardsToClipboardText(cards: Card[]): string {
  return cards
    .map(cardToClipboardText)
    .filter((text) => text !== '')
    .join('\n\n')
}
