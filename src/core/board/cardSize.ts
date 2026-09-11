// ============================================================================
// 模块说明（中文）
// 图片卡片的初始尺寸计算。对应 T1.4：「图片按原始宽高比显示」。
//
// 策略：把图片等比缩放进一个「长边 = 240px」的方框，
//   宽高比完整保留（4:3 得 240×180、16:9 得 240×135、1:1 得 240×240）。
//   极端比例（超长截图、全景图）额外做两步保护：
//     ① 短边保底 96px —— 否则卡片会细成一条线，看不见也点不中
//     ② 长边上限 720px  —— 短边保底后长边会变长，再收一次，避免撑爆画布
//
// ⚠️ 240 / 96 / 720 均为拟定值（文档只要求「按原始宽高比」，未给尺寸），
//    集中在常量里，按实际观感调整只改一处。
//
// 纯函数，可单元测试。
//
// 实现任务：T1.4（阶段一）。
// ============================================================================

/** 卡片长边目标像素 */
export const CARD_LONG_EDGE = 240
/** 卡片短边保底像素（防止极扁/极长的图变成一条线） */
export const CARD_MIN_SHORT_EDGE = 96
/** 短边保底后允许的长边上限 */
export const CARD_MAX_LONG_EDGE = CARD_LONG_EDGE * 3

export interface CardSize {
  w: number
  h: number
}

/** 尺寸信息缺失时的兜底（与 T0.10 的默认尺寸一致） */
export const FALLBACK_IMAGE_CARD_SIZE: CardSize = { w: 220, h: 220 }

/**
 * 按图片原始宽高计算卡片尺寸。
 * @param width  图片原始宽（须 > 0）
 * @param height 图片原始高（须 > 0）
 */
export function cardSizeForImage(width: number, height: number): CardSize {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { ...FALLBACK_IMAGE_CARD_SIZE }
  }

  const longEdge = Math.max(width, height)
  const scale = CARD_LONG_EDGE / longEdge
  let w = width * scale
  let h = height * scale

  const shortEdge = Math.min(w, h)
  if (shortEdge < CARD_MIN_SHORT_EDGE) {
    const boost = CARD_MIN_SHORT_EDGE / shortEdge
    w *= boost
    h *= boost

    const boostedLong = Math.max(w, h)
    if (boostedLong > CARD_MAX_LONG_EDGE) {
      const shrink = CARD_MAX_LONG_EDGE / boostedLong
      w *= shrink
      h *= shrink
    }
  }

  return { w: Math.round(w), h: Math.round(h) }
}
