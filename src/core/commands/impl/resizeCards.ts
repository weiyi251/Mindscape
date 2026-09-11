// ============================================================================
// 模块说明（中文）
// 「缩放卡片」命令。对应开发计划书 T2.3 与 5.2「缩放卡片」（右下角手柄）。
//
// 与移动命令（moveCards）同一套模式：松手时 DOM 已生效（17.3），
// 这里负责固化尺寸并支持撤销 / 重做。apply 由上层注入（写 boardStore）。
// 实现任务：T2.3 / T2.9。
// ============================================================================

import type { Command } from '../types'

/** 单张卡片的尺寸变更：按下时尺寸 → 松手时尺寸（画布坐标，px） */
export interface CardResizeDelta {
  id: string
  from: { w: number; h: number }
  to: { w: number; h: number }
}

/** 写回层签名：把一组卡片尺寸写入状态（boardStore.setCardSizes） */
export type ApplyCardSizes = (sizes: { id: string; w: number; h: number }[]) => void

/** 尺寸是否真的变了；没变就不产生命令 */
export function hasMeaningfulResize(resizes: CardResizeDelta[]): boolean {
  return resizes.some((resize) => resize.from.w !== resize.to.w || resize.from.h !== resize.to.h)
}

/** 创建「缩放卡片」命令：do 应用 to，undo 应用 from */
export function createResizeCardsCommand(
  resizes: CardResizeDelta[],
  apply: ApplyCardSizes,
): Command {
  return {
    type: 'resize',

    do() {
      apply(resizes.map((resize) => ({ id: resize.id, w: resize.to.w, h: resize.to.h })))
    },

    undo() {
      apply(resizes.map((resize) => ({ id: resize.id, w: resize.from.w, h: resize.from.h })))
    },
  }
}
