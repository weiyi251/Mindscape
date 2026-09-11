// ============================================================================
// 模块说明（中文）
// 对齐吸附的纯计算。对应开发计划书 T2.4 与 11.7「对齐辅助标准」：
//   · 拖动时，附近卡片的边缘 / 中线出现对齐参考线
//   · 松开时自动吸附
//   · 分区框之间同样可对齐（targets 传入分区框矩形即可，接口一致）
//
// 手感关键（关卡二「吸附不抢手」）：吸附阈值以**屏幕像素**为基准，
// 由调用方按当前 zoom 换算成画布阈值 —— 否则缩小后吸不住、放大后到处抢。
//
// 纯函数、无 DOM 依赖，可在 node 测试环境验证。
// 实现任务：T2.4。
// ============================================================================

import type { Point } from './coordinates'

/** 吸附触发距离（屏幕像素）。11.7：要「可感知但不抢手」 */
export const SNAP_THRESHOLD_SCREEN_PX = 6

/** 一条对齐参考线。竖线的 position 是画布 x，横线是画布 y */
export interface GuideLine {
  orientation: 'vertical' | 'horizontal'
  position: number
}

/** 可参与对齐的矩形（卡片 / 分区框通用） */
export interface AlignableBox {
  x: number
  y: number
  w: number
  h: number
}

export interface SnapOutcome {
  /** 吸附修正后的位置 */
  position: Point
  /** 命中的竖直参考线（x 轴对齐），无则 null */
  vertical: GuideLine | null
  /** 命中的水平参考线（y 轴对齐），无则 null */
  horizontal: GuideLine | null
}

/**
 * 计算吸附。
 *
 * 每个轴独立取「|目标线 - 移动线| 最小且 ≤ 阈值」的一对：
 *   x 轴：移动卡的 左 / 中 / 右 ↔ 目标卡的 左 / 中 / 右
 *   y 轴：移动卡的 上 / 中 / 下 ↔ 目标卡的 上 / 中 / 下
 *
 * @param proposed    不做吸附时的位置（屏幕位移换算后的画布坐标）
 * @param movingSize  移动中的卡片尺寸（画布坐标）
 * @param targets     其他可对齐对象（同空间其他卡片 / 分区框）
 * @param threshold   画布坐标下的吸附阈值（= 屏幕阈值 / zoom，由调用方换算）
 */
export function computeSnap(
  proposed: Point,
  movingSize: { w: number; h: number },
  targets: AlignableBox[],
  threshold: number = SNAP_THRESHOLD_SCREEN_PX,
): SnapOutcome {
  let bestX: { delta: number; position: number } | null = null
  let bestY: { delta: number; position: number } | null = null

  const movingX = [proposed.x, proposed.x + movingSize.w / 2, proposed.x + movingSize.w]
  const movingY = [proposed.y, proposed.y + movingSize.h / 2, proposed.y + movingSize.h]

  for (const target of targets) {
    const targetX = [target.x, target.x + target.w / 2, target.x + target.w]
    const targetY = [target.y, target.y + target.h / 2, target.y + target.h]

    for (const movingLine of movingX) {
      for (const targetLine of targetX) {
        const delta = targetLine - movingLine
        if (
          Math.abs(delta) <= threshold &&
          (bestX === null || Math.abs(delta) < Math.abs(bestX.delta))
        ) {
          bestX = { delta, position: targetLine }
        }
      }
    }

    for (const movingLine of movingY) {
      for (const targetLine of targetY) {
        const delta = targetLine - movingLine
        if (
          Math.abs(delta) <= threshold &&
          (bestY === null || Math.abs(delta) < Math.abs(bestY.delta))
        ) {
          bestY = { delta, position: targetLine }
        }
      }
    }
  }

  return {
    position: {
      x: proposed.x + (bestX?.delta ?? 0),
      y: proposed.y + (bestY?.delta ?? 0),
    },
    vertical: bestX ? { orientation: 'vertical', position: bestX.position } : null,
    horizontal: bestY ? { orientation: 'horizontal', position: bestY.position } : null,
  }
}

/** 把屏幕像素阈值换算成画布坐标阈值（zoom 越小，同样的屏幕距离覆盖越多画布单位） */
export function snapThresholdInCanvas(zoom: number): number {
  const safeZoom = zoom > 0 ? zoom : 1
  return SNAP_THRESHOLD_SCREEN_PX / safeZoom
}
