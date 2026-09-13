// ============================================================================
// 模块说明（中文）
// 「缩放卡片」命令。对应开发计划书 T2.3 与 5.2「缩放卡片」（右下角手柄）。
//
// 与移动命令（moveCards）同一套模式：松手时 DOM 已生效（17.3），
// 这里负责固化尺寸并支持撤销 / 重做。apply 由上层注入（写 boardStore）。
// 2026-09-13 增补：便签的西 / 北边缩放会联动位置，故 Delta 增加可选的
// fromPos / toPos；东 / 南 / 右下角缩放位置不变，字段缺省即兼容旧调用。
// 实现任务：T2.3 / T2.9。
// ============================================================================

import type { Command } from '../types'

/** 单张卡片的尺寸变更：按下时尺寸 → 松手时尺寸（画布坐标，px） */
export interface CardResizeDelta {
  id: string
  from: { w: number; h: number }
  to: { w: number; h: number }
  /** 西 / 北边缩放联动出的位置：按下时左上角（仅位置变化时提供） */
  fromPos?: { x: number; y: number }
  /** 西 / 北边缩放联动出的位置：松手时左上角（仅位置变化时提供） */
  toPos?: { x: number; y: number }
}

/** 写回层签名：把一组卡片尺寸（含可选位置）写入状态（boardStore.setCardSizes） */
export type ApplyCardSizes = (sizes: { id: string; w: number; h: number; x?: number; y?: number }[]) => void

/** 尺寸 / 位置是否真的变了；没变就不产生命令 */
export function hasMeaningfulResize(resizes: CardResizeDelta[]): boolean {
  return resizes.some(
    (resize) =>
      resize.from.w !== resize.to.w ||
      resize.from.h !== resize.to.h ||
      (resize.fromPos !== undefined &&
        resize.toPos !== undefined &&
        (resize.fromPos.x !== resize.toPos.x || resize.fromPos.y !== resize.toPos.y)),
  )
}

/** 创建「缩放卡片」命令：do 应用 to，undo 应用 from（含可选位置） */
export function createResizeCardsCommand(
  resizes: CardResizeDelta[],
  apply: ApplyCardSizes,
): Command {
  return {
    type: 'resize',

    do() {
      apply(
        resizes.map((resize) => ({
          id: resize.id,
          w: resize.to.w,
          h: resize.to.h,
          x: resize.toPos?.x,
          y: resize.toPos?.y,
        })),
      )
    },

    undo() {
      apply(
        resizes.map((resize) => ({
          id: resize.id,
          w: resize.from.w,
          h: resize.from.h,
          x: resize.fromPos?.x,
          y: resize.fromPos?.y,
        })),
      )
    },
  }
}
