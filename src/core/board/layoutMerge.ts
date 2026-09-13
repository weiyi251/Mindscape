// ============================================================================
// 模块说明（中文）
// 布局与文件夹内容的合并。对应 T1.6「布局文件读写打通」（布局自 P1-2 起落
// `%APPDATA%\Mindscape\layouts\<空间 id>.json`，与文件夹内容的合并逻辑不变）。
//
// 问题：文件夹是唯一事实来源（用户可能直接往文件夹里丢/删文件），
//   而 layout.json 记的是"上次摆放的样子"。两者必须对得上才能既不丢位置、
//   又能看到新文件。
//
// 策略（以 filePath 为键做匹配）：
//   · 两边都有        → 保留 layout 的位置 / 尺寸 / 备注（用户的劳动成果）
//   · 只在文件夹里有  → 新卡片，接在既有内容**下方**继续用网格铺（不覆盖已有位置）
//   · 只在 layout 里有 → 文件已被删/移走，本次不显示（阶段二 T2.7 起交给 removed 记录处理）
//   · filePath 为空   → 便签等无文件卡片，不参与匹配，原样保留（2026-09-13 修复：重进不再消失）
//
// 纯函数，可单元测试（不依赖 Tauri）。
//
// 实现任务：T1.6（阶段一）。
// ============================================================================

import type { Card } from '@/core/types'
import { nextCardId } from '@/core/utils/id'
import { DEFAULT_GRID_OPTIONS, layoutGrid } from './grid'
import type { GridOptions } from './grid'

export interface MergeResult {
  /** 合并后的卡片：先是有布局记录的（保持原有顺序），再是新扫描到的 */
  cards: Card[]
  /** 本次新增的卡片数（用于状态提示） */
  added: number
  /** layout 里有、而文件夹里已经找不到的卡片（阶段二交给 removed 处理） */
  missing: Card[]
}

/**
 * 把「本次扫描出的卡片」与「layout 里记录的卡片」合并。
 *
 * @param scanned    由 createCardsFromEntries 生成（位置是临时网格位置）
 * @param layoutCards layout.json 里的卡片
 * @param grid       网格参数；新卡片从既有内容下方接着铺
 */
export function mergeScannedWithLayout(
  scanned: readonly Card[],
  layoutCards: readonly Card[],
  grid: Required<GridOptions> = DEFAULT_GRID_OPTIONS,
): MergeResult {
  // 便签等「无文件卡片」（filePath 为空串）只活在 layout 里，不依赖文件夹扫描，
  // 必须原样保留 —— 否则重进空间时会被下面的文件匹配当成「文件已丢失」而整卡丢弃
  // （2026-09-13 修复的 bug：新建便签及其标签 / 备注在退出重进后消失）。
  // 将来插件注册的无文件卡片类型同样按此规则走 layout 恢复。
  const localCards = layoutCards.filter((card) => card.filePath === '')
  const fileCards = layoutCards.filter((card) => card.filePath !== '')

  const savedByPath = new Map(fileCards.map((card) => [card.filePath, card]))

  const kept: Card[] = []
  const fresh: Card[] = []

  for (const card of scanned) {
    const saved = savedByPath.get(card.filePath)
    if (saved) {
      // 位置、尺寸、备注、zIndex、meta 全部以 layout 为准；
      // 只更新 type（防御：同名文件被替换成别的格式时，卡片外观要跟着变）
      kept.push({ ...saved, type: card.type })
    } else {
      fresh.push(card)
    }
  }

  const missing = fileCards.filter((card) => !scanned.some((item) => item.filePath === card.filePath))

  if (fresh.length === 0) {
    return { cards: [...kept, ...localCards], added: 0, missing }
  }

  // 没有任何既有布局：扫描位置即最终位置。
  // ⚠️ 不能重铺 —— T2.5 起分区框卡片按「独立行带」扫描，重铺会打散分组排布、
  //    导致相邻分区框的包围盒相互重叠。
  if (kept.length === 0) {
    return { cards: [...fresh, ...localCards], added: fresh.length, missing }
  }

  // 新卡片接在既有内容的下方，避免与用户已经摆好的卡片重叠
  const bottom = kept.reduce((max, card) => Math.max(max, card.y + card.h), 0)
  const startY = kept.length > 0 ? bottom + grid.gapY : grid.startY

  const positions = layoutGrid(
    fresh.map((card) => ({ w: card.w, h: card.h })),
    { ...grid, startY },
  )

  const usedIds = layoutCards.map((card) => card.id)
  const placed = fresh.map((card, index) => {
    const id = nextCardId(usedIds)
    usedIds.push(id)
    return { ...card, id, x: positions[index].x, y: positions[index].y }
  })

  return { cards: [...kept, ...placed, ...localCards], added: placed.length, missing }
}
