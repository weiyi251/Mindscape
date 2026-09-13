// ============================================================================
// 模块说明（中文）
// 可拖动浮窗的几何纯函数（2026-09-13 新增，配合 FloatingModal）。
//
// 为什么单独成文件：位置 / 尺寸的收敛规则（最小尺寸、视口内边界、拖动位移、
// 缩放夹紧）是**纯计算**，与 DOM 无关，放这里就能在 node 环境直接单测
// （项目不引入 jsdom，用户裁决 4）。组件里只剩「读指针 → 调这里 → 写 style」。
//
// 约定：位置尺寸统一用 left / top / width / height（fixed 定位，屏幕坐标即视口坐标），
// 不做中心点 / 变换矩阵换算，避免与画布的 ZoomPan 体系混淆。
// ============================================================================

/** 浮窗矩形（fixed 定位，单位 px） */
export interface ModalRect {
  x: number
  y: number
  width: number
  height: number
}

/** 视口尺寸（= window.innerWidth / innerHeight） */
export interface ViewportSize {
  width: number
  height: number
}

/** 与视口四周留白：浮窗永远不贴死屏幕边缘 */
export const MODAL_MARGIN = 8
/** 最小可用尺寸：再小就没有可读内容了 */
export const MODAL_MIN_WIDTH = 400
export const MODAL_MIN_HEIGHT = 280
/** 默认尺寸（首次打开 / 偏好丢失时） */
export const MODAL_DEFAULT_WIDTH = 560
export const MODAL_DEFAULT_HEIGHT = 440
/** 默认垂直位置：略高于正中（视觉上比几何居中舒服，且给下方留出空间） */
const DEFAULT_TOP_RATIO = 0.42

/** 数值兜底：NaN / Infinity → fallback */
function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

/** 视口内可用的最大宽 / 高（两侧留白都扣掉） */
function maxSize(viewport: ViewportSize): { width: number; height: number } {
  return {
    width: Math.max(MODAL_MIN_WIDTH, viewport.width - MODAL_MARGIN * 2),
    height: Math.max(MODAL_MIN_HEIGHT, viewport.height - MODAL_MARGIN * 2),
  }
}

/** 首次打开时的默认矩形：水平居中、略高于垂直居中，尺寸夹进视口 */
export function defaultModalRect(viewport: ViewportSize): ModalRect {
  const limit = maxSize(viewport)
  const width = Math.min(MODAL_DEFAULT_WIDTH, limit.width)
  const height = Math.min(MODAL_DEFAULT_HEIGHT, limit.height)
  // 再走一遍 clampRect：小视口下按比例算出的位置可能落到留白之外
  return clampRect(
    {
      x: Math.round((viewport.width - width) / 2),
      y: Math.round((viewport.height - height) * DEFAULT_TOP_RATIO),
      width,
      height,
    },
    viewport,
  )
}

/**
 * 把矩形整体收敛进视口：宽高夹到 [最小尺寸, 视口可用尺寸]，位置夹到留白之内。
 * 视口缩小（用户拉小窗口）时也靠它把浮窗拉回来，不留在屏幕外。
 */
export function clampRect(rect: ModalRect, viewport: ViewportSize): ModalRect {
  const limit = maxSize(viewport)
  const width = Math.min(
    Math.max(finite(rect.width, MODAL_DEFAULT_WIDTH), MODAL_MIN_WIDTH),
    limit.width,
  )
  const height = Math.min(
    Math.max(finite(rect.height, MODAL_DEFAULT_HEIGHT), MODAL_MIN_HEIGHT),
    limit.height,
  )
  const maxX = Math.max(MODAL_MARGIN, viewport.width - width - MODAL_MARGIN)
  const maxY = Math.max(MODAL_MARGIN, viewport.height - height - MODAL_MARGIN)
  return {
    x: Math.min(Math.max(finite(rect.x, MODAL_MARGIN), MODAL_MARGIN), maxX),
    y: Math.min(Math.max(finite(rect.y, MODAL_MARGIN), MODAL_MARGIN), maxY),
    width,
    height,
  }
}

/**
 * 拖动：按位移平移后收敛进视口。
 * dx / dy 是本次指针相对起点的总位移（不是增量），调用方从拖动起点算，
 * 这样中途被边界夹住后向回转也能立刻跟手。
 */
export function moveRect(
  origin: ModalRect,
  dx: number,
  dy: number,
  viewport: ViewportSize,
): ModalRect {
  return clampRect(
    { ...origin, x: origin.x + finite(dx, 0), y: origin.y + finite(dy, 0) },
    viewport,
  )
}

/**
 * 右下角缩放：保持左上角固定，宽高夹到 [最小尺寸, 到视口边缘为止]。
 * 从左上角的固定点算最大可用尺寸，避免「先放大再被拉回」的跳变。
 */
export function resizeRect(
  origin: ModalRect,
  width: number,
  height: number,
  viewport: ViewportSize,
): ModalRect {
  const maxWidth = Math.max(MODAL_MIN_WIDTH, viewport.width - origin.x - MODAL_MARGIN)
  const maxHeight = Math.max(MODAL_MIN_HEIGHT, viewport.height - origin.y - MODAL_MARGIN)
  return {
    x: origin.x,
    y: origin.y,
    width: Math.min(Math.max(finite(width, origin.width), MODAL_MIN_WIDTH), maxWidth),
    height: Math.min(Math.max(finite(height, origin.height), MODAL_MIN_HEIGHT), maxHeight),
  }
}

/** 读偏好：坏数据（非 JSON / 字段缺失 / 数值非法）一律返回 null，由调用方回落默认 */
export function parseModalRect(raw: string | null | undefined): ModalRect | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const record = parsed as Record<string, unknown>
  const values = [record.x, record.y, record.width, record.height]
  if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) return null
  return {
    x: record.x as number,
    y: record.y as number,
    width: record.width as number,
    height: record.height as number,
  }
}

/** 写偏好（只存四个数字，顺序稳定便于 diff） */
export function serializeModalRect(rect: ModalRect): string {
  return JSON.stringify({
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  })
}

/** 浮窗位置尺寸偏好的键名前缀（不同浮窗各用各的，避免互相覆盖） */
export const FLOATING_MODAL_PREF_PREFIX = 'mindscape.floatingModal.'

/** 拼一个浮窗的位置尺寸偏好键 */
export function floatingModalPrefKey(name: string): string {
  return `${FLOATING_MODAL_PREF_PREFIX}${name}`
}
