// ============================================================================
// 模块说明（中文）
// 「打开原图 / 用系统默认程序打开文件」的编排层（2026-09-21 移动端适配 M1 外抽）。
//
// 原来内联在 Board.tsx 里；M1 要给「降级到文件管理器定位」这一步加平台能力判断
// （Android 没有 reveal_item_in_dir），Board 的行数棘轮只剩 2 行余量，
// 于是整块搬出来 —— 与 renameFileFlow.ts / moveCardFlow.ts 同构。
//
// 链路（第九章 T3.5）：双击或右键「打开原图」→ image 卡开原图、file 卡开文件、
// 便签没有文件直接提示；打开失败（系统未关联该类型）时降级为「在文件管理器中定位」，
// 该降级**只在桌面执行**（平台能力表 revealInExplorer，见 core/system/platformCapabilities.ts）。
//
// 依赖全部以参数注入（不直接 import store / provider），可在 node 环境单测。
// ============================================================================

import type { Card } from '@/core/types'
import { supportsCapability } from '@/core/system/platformCapabilities'
import { toErrorMessage } from '@/core/utils/errorMessage'
import { joinPath } from '@/core/utils/paths'

/** 用户可见文案常量表（集中一处便于校对） */
export const OPEN_CARD_TEXT = {
  /** 便签不落盘，没有可打开的文件 */
  noteHasNoFile: '便签没有关联的文件',
  /** 打开失败但降级成功（仅桌面） */
  revealedInExplorer: '系统未关联该文件类型的打开方式，已在资源管理器中定位',
  /**
   * 移动端（M4 2026-09-21）：交给系统应用打开的通道在安卓三条都走不通
   * （能力表 `openWithSystemApp` 的注释里逐条列了）。右键入口已经按能力隐藏，
   * 这里兜住**双击 / 双击触摸**那条路——它不经过菜单。
   */
  noSystemViewer: '手机端没有「用其他应用打开」的通道，图片请在画布上看',
} as const

export interface OpenCardDeps {
  /** 当前空间的文件夹绝对路径；null = 未打开空间（静默返回） */
  spaceFolder: string | null
  /** image 卡的原图绝对路径（core/board/cardAssets 资源表；未登记时为空串） */
  originalPathOf: (cardId: string) => string
  openWithDefault: (path: string) => Promise<void>
  revealInExplorer: (path: string) => Promise<void>
  /** 平台能力：能否降级到「在文件管理器中定位」（移动端为 false） */
  canRevealInExplorer: boolean
  /** 失败提示（中文，可直接展示） */
  onError: (message: string) => void
}

/**
 * 用系统默认程序打开卡片对应的文件。
 *
 * 路径口径（与铁律②「不搬家」一致，一律指向磁盘上的真实文件）：
 *   · note  → 无文件，提示后返回；
 *   · image → 资源表里的原图绝对路径（可能已被用户移出，为空时按「无文件」处理）；
 *   · file  → 空间文件夹 + 卡片相对路径。
 */
export async function openCardExternally(card: Card, deps: OpenCardDeps): Promise<void> {
  if (!deps.spaceFolder) return

  // M4：移动端根本没有这条通道，别先去撞一次注定失败的 invoke（与菜单入口隐藏互为两道）
  if (!supportsCapability('openWithSystemApp')) {
    deps.onError(OPEN_CARD_TEXT.noSystemViewer)
    return
  }

  const absolutePath =
    card.type === 'note'
      ? ''
      : card.type === 'image'
        ? deps.originalPathOf(card.id)
        : joinPath(deps.spaceFolder, card.filePath)

  if (absolutePath === '') {
    deps.onError(OPEN_CARD_TEXT.noteHasNoFile)
    return
  }

  try {
    await deps.openWithDefault(absolutePath)
  } catch (error) {
    const message = toErrorMessage(error)
    if (!deps.canRevealInExplorer) {
      deps.onError(message)
      return
    }
    try {
      await deps.revealInExplorer(absolutePath)
      deps.onError(OPEN_CARD_TEXT.revealedInExplorer)
    } catch (revealError) {
      deps.onError(toErrorMessage(revealError))
    }
  }
}
