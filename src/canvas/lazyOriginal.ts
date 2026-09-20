// ============================================================================
// 模块说明（中文）
// 原图 / 缩略图两档加载。对应 17.7「首屏策略」与 17.11（渲染反模式 9）：
//   「视口内卡片优先加载原图，视口外加载缩略图；懒加载」
//
// 【两档的意义（D3：大图内存优化，2026-09-20 用户计划第 4 步）】
//   解码内存 ≈ 宽 × 高 × 4 字节。画布缩到 25% 时卡片在屏幕上只有一两百像素宽，
//   却仍按原图（可能 4000×3000）解码 —— 同屏几十张就是几百 MB。因此：
//   · 卡片**显示得很小**（屏幕宽 < ORIGINAL_ENTER_SCREEN_W）时用缩略图；
//   · 放回**显示得大**（屏幕宽 > ORIGINAL_EXIT_SCREEN_W）时换回原图；
//   · 中间那段是**滞回区**：不切换，避免在临界尺寸上反复换图抖动。
//   缩略图由 `core/board/thumbnailCache.ts` 按需生成（缓存落在应用数据目录）。
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
// 【释放原图为什么用 removeAttribute 而不是 src = ''】
//   `img.src = ''` 会被解析成当前文档 URL 并加载失败 → 触发 error 事件 →
//   分辨率徽章被写成「尺寸不可读」（core/registry/imageResolution.ts）。移除属性
//   不触发 error，徽章保留上一次写好的真实分辨率。
//
// 【为什么「没有缩略图时不释放原图」】
//   缩略图是异步生成的。若一发现「该降档」就把原图清掉，卡片会在生成完成前变空白。
//   所以顺序是：先请求生成 → 生成期间保留原图 → 就绪后（下一帧）才释放。
//
// 【测试策略】
//   判定逻辑（可见区反算 / 相交 / 档位与滞回 / 动作计划）全部是纯函数，可脱离
//   DOM 单测；只有末尾「写 dataset + 写 src」的胶水代码依赖真实 DOM
//   （无需 jsdom 即可保证逻辑正确）。
//
// 实现任务：T1.4（阶段一）→ D3 扩展（2026-09-20）。
// ============================================================================

import { ORIGINAL_IMG_SELECTOR, THUMB_IMG_SELECTOR } from '@/core/board/imageStages'
import { getCachedThumbUrl, requestCachedThumbnail } from '@/core/board/thumbnailCache'

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

/** 图片卡的加载档位：原图 / 缩略图 */
export type ImageStage = 'original' | 'thumb'

/**
 * 进入原图档的屏幕显示宽度阈值（CSS 像素）。
 * 卡片显示宽 ≥ 该值 → 用原图。
 */
export const ORIGINAL_ENTER_SCREEN_W = 260

/**
 * 退回缩略图档的屏幕显示宽度阈值（CSS 像素）。
 * 卡片显示宽 ≤ 该值 → 用缩略图。与 ENTER 之间是滞回区（不切换）。
 */
export const ORIGINAL_EXIT_SCREEN_W = 160

/** 一张图片的判定所需信息（从 dataset 读出，测试可直接构造） */
export interface LazyImageMeta extends CanvasRect {
  /** 原图在 WebView 里可访问的 URL；空串表示没有原图可用 */
  originalUrl: string
  /** 原图绝对路径（用于请求生成缩略图）；空串表示无法生成 */
  sourcePath: string
  /** 当前档位；'' 表示还没定过 */
  stage: ImageStage | ''
}

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

/** dataset 里的档位值 → ImageStage；未知值一律当作「还没定过」 */
function readStage(value: string | undefined): ImageStage | '' {
  return value === 'original' || value === 'thumb' ? value : ''
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
    sourcePath: dataset.sourcePath ?? '',
    stage: readStage(dataset.cardImageStage),
  }
}

/**
 * 按卡片在屏幕上的显示宽度决定目标档位（含滞回）。
 *
 * |   当前档位   |          条件           |   结果   |
 * |--------------|-------------------------|----------|
 * | original     | screenWidth ≤ EXIT(160) | thumb    |
 * | original     | screenWidth >  EXIT     | original |
 * | '' / thumb   | screenWidth ≥ ENTER(260)| original |
 * | '' / thumb   | screenWidth <  ENTER    | thumb    |
 *
 * 非有限值 / 负值一律按 0 处理（→ thumb），不抛错：dataset 来自 DOM，脏值不该让画布崩。
 */
export function stageForScreenWidth(current: ImageStage | '', screenWidth: number): ImageStage {
  // NaN 按 0（无法判定 → 用便宜的缩略图）；负数归 0；Infinity 采信（真的极大）
  const width = Number.isNaN(screenWidth) ? 0 : Math.max(0, screenWidth)

  if (current === 'original') {
    return width <= ORIGINAL_EXIT_SCREEN_W ? 'thumb' : 'original'
  }
  return width >= ORIGINAL_ENTER_SCREEN_W ? 'original' : 'thumb'
}

/** 一次判定的输入（全部来自 DOM 与内存表，测试可直接构造） */
export interface StageItem {
  /** 当前档位（'' = 还没定过） */
  stage: ImageStage | ''
  /** 卡片在屏幕上的显示宽度 = 卡片宽度 × zoom */
  screenWidth: number
  /** 是否落在可见区内 */
  visible: boolean
  /** 是否有可用的原图 URL */
  hasOriginalUrl: boolean
  /** 缩略图是否**可用且能显示**（已就绪 且 页面里确实有缩略图元素） */
  hasThumb: boolean
  /** 缩略图元素当前是否已经写上 src */
  thumbLoaded: boolean
  /** 是否知道原图绝对路径（否则无法请求生成） */
  hasSourcePath: boolean
}

/** 本次要做的 DOM 调整（'unchanged' = 别动，避免无谓的 src 重写与重解码） */
export interface StagePlan {
  /** 原图 img：'url' 写原图、'none' 清空（释放解码内存）、'unchanged' 不动 */
  original: 'url' | 'none' | 'unchanged'
  /** 缩略图 img：'url' 补写、'unchanged' 不动 */
  thumb: 'url' | 'unchanged'
  /** 是否要请求生成缩略图 */
  requestThumb: boolean
}

/**
 * 决定一张图片这一帧该做什么（纯函数）。
 *
 * 三条不变量：
 *   1. **不可见就不预加载原图** —— 视口外的卡片不该解码大图（17.11 反模式 9）；
 *   2. **没有缩略图就不释放原图** —— 否则生成完成前卡片是空白的；
 *   3. **缩略图已就绪才释放原图** —— 释放后画面靠下层缩略图顶着，视觉无跳变。
 */
export function planStage(item: StageItem): StagePlan {
  const desired = stageForScreenWidth(item.stage, item.screenWidth)
  const needThumbSrc = item.hasThumb && !item.thumbLoaded
  const thumb: StagePlan['thumb'] = needThumbSrc ? 'url' : 'unchanged'

  // 目标 = 原图档：可见时加载原图；已是原图的什么都不动
  if (desired === 'original') {
    if (item.stage === 'original') return { original: 'unchanged', thumb, requestThumb: false }
    if (item.visible && item.hasOriginalUrl) {
      return { original: 'url', thumb, requestThumb: false }
    }
    return { original: 'unchanged', thumb, requestThumb: false }
  }

  // 目标 = 缩略图档，且缩略图可用：显示缩略图 + 释放原图
  if (item.hasThumb) {
    return {
      original: item.stage === 'original' ? 'none' : 'unchanged',
      thumb,
      requestThumb: false,
    }
  }

  // 目标 = 缩略图档，但缩略图还没生成：请求生成，本帧保留原图（或先用原图顶上）
  const backupOriginal = item.stage !== 'original' && item.visible && item.hasOriginalUrl
  return {
    original: backupOriginal ? 'url' : 'unchanged',
    thumb: 'unchanged',
    requestThumb: item.hasSourcePath,
  }
}

/**
 * 把每张图片调整到它该有的档位（直接改 DOM，不触发 React 更新）。
 *
 * 卡片渲染时会带坐标 dataset（x/y/w/h）、`data-original-url`、
 * `data-source-path` 与 `data-card-image-stage`；本函数只依赖这些属性。
 *
 * @returns 本次实际加载原图的图片数量（测试 / 调试用）
 */
export function upgradeVisibleImages(root: HTMLElement, view: ViewTransform): number {
  const visible = visibleCanvasRect(view, root.clientWidth, root.clientHeight)
  const elements = Array.from(root.querySelectorAll<HTMLImageElement>(ORIGINAL_IMG_SELECTOR))
  if (elements.length === 0) return 0

  let loaded = 0

  for (const element of elements) {
    const meta = readImageMeta(element.dataset)
    if (!meta) continue

    // 缩略图元素与原图元素同处一个相对定位容器（见 cardTypes.renderImage）
    const thumbElement =
      element.parentElement?.querySelector<HTMLImageElement>(THUMB_IMG_SELECTOR) ?? null
    const thumbUrl = meta.sourcePath ? getCachedThumbUrl(meta.sourcePath) : ''

    const plan = planStage({
      stage: meta.stage,
      screenWidth: meta.w * view.zoom,
      visible: rectsIntersect(meta, visible),
      hasOriginalUrl: meta.originalUrl !== '',
      // 「能显示」才允许释放原图：没有缩略图元素时释放 = 卡片空白
      hasThumb: thumbUrl !== '' && thumbElement !== null,
      thumbLoaded: (thumbElement?.getAttribute('src') ?? '') !== '',
      hasSourcePath: meta.sourcePath !== '',
    })

    if (plan.thumb === 'url' && thumbElement && thumbUrl) {
      thumbElement.src = thumbUrl
    }

    if (plan.original === 'url' && meta.originalUrl) {
      element.src = meta.originalUrl
      element.dataset.cardImageStage = 'original'
      loaded += 1
    } else if (plan.original === 'none') {
      // 释放解码内存（见文件头：不能用 src = ''，会触发 error 让徽章误报）
      element.removeAttribute('src')
      element.dataset.cardImageStage = 'thumb'
    }

    if (plan.requestThumb && meta.sourcePath) {
      requestCachedThumbnail(meta.sourcePath)
    }
  }

  return loaded
}
