// ============================================================================
// 模块说明（中文）
// 原图懒加载。对应 17.7「首屏策略」：
//   「视口内卡片优先加载原图，视口外加载缩略图；懒加载」
//
// 【为什么不用 IntersectionObserver】
//   文档点的是 IntersectionObserver，但它在"被 CSS transform 缩放/平移的画布"里不成立：
//   IntersectionObserver 的相交判定基于**布局盒**，不应用 CSS transform。
//   画布平移 5000px 后，一张实际可见的卡片仍会被判定为"在视口外"；
//   一张实际已经移出屏幕的卡片仍会被判定为"在视口内"。
//   因此这里改成等价且可控的做法：用当前 zoom/offset 反算出**可见的画布坐标矩形**，
//   再与卡片坐标求交 —— 结果与用户眼睛看到的完全一致，且是纯计算。
//
// 【为什么不用 setState】
//   本模块只读坐标 / 直接写 `img.src`，不产生任何 React 更新（17.3 铁律）。
//   调用点（Canvas）在 controller 的按帧回调里触发它，因此每帧最多跑一次。
//
// 【单向升级】
//   缩略图 → 原图是单向的：一旦某张卡片加载过原图就不回退。
//   回退会造成反复下载与闪烁，收益只有省一点显存，不划算。
//
// 【测试策略】
//   判定逻辑（可见区反算 / 相交 / 挑选）全部是纯函数，可脱离 DOM 单测；
//   只有末尾「写 dataset + 写 src」的胶水代码依赖真实 DOM（无需 jsdom 即可保证逻辑正确）。
//
// 实现任务：T1.4（阶段一）。
// ============================================================================

/** 视口变换（与 ViewportController 的字段一致） */
export interface ViewTransform {
  zoom: number
  /** 画布原点在容器内的平移量（CSS 像素） */
  offsetX: number
  offsetY: number
}

/** 画布坐标系里的一个矩形 */
export interface CanvasRect {
  x: number
  y: number
  w: number
  h: number
}

/** 一张图片的判定所需信息（从 dataset 读出，测试可直接构造） */
export interface LazyImageMeta extends CanvasRect {
  /** 原图在 WebView 里可访问的 URL；空串表示没有原图可用 */
  originalUrl: string
  /** 是否已经升级过 */
  upgraded: boolean
}

/** 带原图懒加载信息的图片元素选择器 */
export const ORIGINAL_IMG_SELECTOR = 'img[data-original-url]'

/** 已升级到原图的标记值（写在 dataset.upgraded 上） */
const UPGRADED_FLAG = '1'

/**
 * 当前可见区域在**画布坐标系**里的矩形。
 *
 * 屏幕坐标 = 画布坐标 × zoom + offset，因此屏幕范围 [0, width] 反解得到：
 *   画布坐标 = (0 - offset) / zoom  到  (width - offset) / zoom
 *
 * @param view            当前视口变换
 * @param viewportWidth   视口容器宽度（CSS 像素）
 * @param viewportHeight  视口容器高度（CSS 像素）
 */
export function visibleCanvasRect(
  view: ViewTransform,
  viewportWidth: number,
  viewportHeight: number,
): CanvasRect {
  if (!(view.zoom > 0) || viewportWidth <= 0 || viewportHeight <= 0) {
    return { x: 0, y: 0, w: 0, h: 0 }
  }

  return {
    // `|| 0` 把 -0 归一成 0：offsetX 为 0 时 0/zoom 会得到 -0，
    // 它在 Object.is 意义下不等于 0，会让断言与缓存键都变得别扭。
    x: -view.offsetX / view.zoom || 0,
    y: -view.offsetY / view.zoom || 0,
    w: viewportWidth / view.zoom,
    h: viewportHeight / view.zoom,
  }
}

/** 两个矩形是否相交（边缘刚好贴合不算相交） */
export function rectsIntersect(a: CanvasRect, b: CanvasRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

/** 严格解析 dataset 里的数字：缺失 / 空串 / 非数字一律视为无效 */
function readNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** 从 dataset 里读出图片元信息；坐标字段缺失或非法时返回 null */
export function readImageMeta(dataset: DOMStringMap): LazyImageMeta | null {
  const x = readNumber(dataset.x)
  const y = readNumber(dataset.y)
  const w = readNumber(dataset.w)
  const h = readNumber(dataset.h)

  if (x === null || y === null || w === null || h === null) return null

  return {
    x,
    y,
    w,
    h,
    originalUrl: dataset.originalUrl ?? '',
    upgraded: dataset.upgraded === UPGRADED_FLAG,
  }
}

/**
 * 挑出本次需要处理的图片下标：未升级过 + 落在可见区内。
 *
 * 纯函数，不碰 DOM。返回「需要打上已升级标记」的下标（升序）。
 * 注意：被挑中的图片里，originalUrl 为空的那部分只打标记、不换 src（见调用方）。
 */
export function planUpgrade(
  images: readonly (LazyImageMeta | null)[],
  visible: CanvasRect,
): number[] {
  const picked: number[] = []

  images.forEach((meta, index) => {
    if (!meta || meta.upgraded) return
    if (!rectsIntersect(meta, visible)) return
    picked.push(index)
  })

  return picked
}

/**
 * 把可见区域内的图片从缩略图升级为原图（直接改 DOM，不触发 React 更新）。
 *
 * 卡片渲染时会带上坐标 dataset（x/y/w/h）与 data-original-url；
 * 本函数只依赖这些属性，不依赖任何 React 状态。
 *
 * @returns 本次实际升级的图片数量（测试 / 调试用）
 */
export function upgradeVisibleImages(root: HTMLElement, view: ViewTransform): number {
  const visible = visibleCanvasRect(view, root.clientWidth, root.clientHeight)
  const elements = Array.from(root.querySelectorAll<HTMLImageElement>(ORIGINAL_IMG_SELECTOR))
  if (elements.length === 0) return 0

  const metas = elements.map((element) => readImageMeta(element.dataset))
  const targets = planUpgrade(metas, visible)

  let upgraded = 0
  for (const index of targets) {
    const element = elements[index]
    const meta = metas[index]
    // 先打标记：即便没有原图也不该在后续每一帧被重复判定
    element.dataset.upgraded = UPGRADED_FLAG
    if (!meta?.originalUrl) continue

    element.src = meta.originalUrl
    upgraded += 1
  }

  return upgraded
}
