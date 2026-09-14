// ============================================================================
// 模块说明（中文）
// 图片卡的「实际分辨率」悬浮徽章（2026-09-14 用户要求）：
//   鼠标悬停在图片卡上时，卡片盒**下方外侧**右对齐处淡入一枚等宽字体的
//   「宽 × 高」（像素）标签；移出即隐。见 core/registry/cardTypes.ts 的
//   renderImage（徽章的 JSX 在那边，本模块负责格式化 + DOM 写入）。
//
// 【数据从哪来】方案 A（卡片直接加载原图）下，<img> 的 naturalWidth /
//   naturalHeight 就是原始分辨率 —— 不新增任何持久化字段：老卡片、拖入、
//   粘贴、插件建卡的图全都自动有，覆盖「后续动态加载的图片」零额外接线。
//
// 【三种状态】
//   · 未加载完成（视口外未写 src / 正在加载）→ 徽章保持 hidden，悬停无胶囊；
//   · 加载成功 → 徽章写「宽 × 高」并取消隐藏；
//   · 加载失败（文件损坏 / 被删 / URL 失效）→ 徽章写「尺寸不可读」。
//
// 【为什么直写 DOM 而不走 React state】与 lazyOriginal 同一模式（17.3 精神）：
//   分辨率是「图片加载完成」这个一次性事件的产物，进 state 会让每张图在加载
//   时刻重渲染一次；直写 textContent 零重渲染。React 端渲染的徽章元素**不带
//   children**，因此后续任何重渲染都不会清掉写进去的文本；hidden 类的增删
//   同理由本模块直写。徽章的淡入/淡出本身走纯 CSS group-hover（悬停是高频
//   事件，绝不进 state）。
//
// 纯函数（formatImageResolution）+ 薄 DOM 胶水（writeImageResolutionBadge）：
// 胶水依赖的接口窄到「查询 + 改 class + 写文本」，测试用假对象即可覆盖。
// ============================================================================

/** 徽章元素上的标记属性（渲染层与 DOM 写入层的唯一约定） */
export const IMAGE_RESOLUTION_BADGE_ATTR = 'data-image-resolution'

/** 徽章隐藏用的类名（Tailwind 的 display:none；由本模块用 classList 增删） */
export const IMAGE_RESOLUTION_HIDDEN_CLASS = 'hidden'

/** 加载失败时展示的文案（用户悬停时有明确反馈，而不是一个空标签） */
export const IMAGE_RESOLUTION_UNAVAILABLE = '尺寸不可读'

/**
 * 分辨率文本：「宽 × 高」（像素，与卡片尺寸描述 describeSize 同一格式）。
 * 只有正整数才可展示 —— 0 / 负数 / 小数 / 非有限值一律视为「还没读到有效尺寸」。
 */
export function formatImageResolution(width: number, height: number): string | null {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null
  if (width <= 0 || height <= 0) return null
  return `${width} × ${height}`
}

/** 徽章元素的最小形状（真实 HTMLElement 的窄化视图，测试可造假对象） */
export interface ResolutionBadgeElement {
  classList: { add(name: string): void; remove(name: string): void }
  textContent: string
}

/** 承载徽章的卡片根元素的最小形状 */
export interface ResolutionHostElement {
  querySelector<E extends ResolutionBadgeElement>(selectors: string): E | null
}

/**
 * 把文本写进卡片根元素内的徽章并取消隐藏；找不到徽章时静默跳过。
 * 文本为 null / 空串时不写不显示（语义 =「现在没有可展示的尺寸」，
 * 比如图片尚未加载完成）。
 */
export function writeImageResolutionBadge(
  root: ResolutionHostElement | null,
  text: string | null,
): void {
  if (root === null || text === null || text === '') return
  const badge = root.querySelector<ResolutionBadgeElement>(`[${IMAGE_RESOLUTION_BADGE_ATTR}]`)
  if (badge === null) return
  badge.textContent = text
  badge.classList.remove(IMAGE_RESOLUTION_HIDDEN_CLASS)
}

/**
 * 从 img 向上找到「徽章的宿主」（Card.tsx 的卡片根元素）。
 *
 * ⚠️ 不能直接停在最近的 `[data-card-id]` 上：渲染层的 shell（卡片盒）自己也带
 * `data-card-id`，而徽章渲染在 shell **之外**（shell 有 overflow-hidden 会裁掉
 * 下方外挂部分），两者是兄弟层级 —— 所以要再往上一层。
 */
function badgeHostOf(img: Element): HTMLElement | null {
  const shellEl = img.closest('[data-card-id]')
  const host = shellEl?.parentElement
  return (host as HTMLElement | null) ?? null
}

/**
 * img 的 load 事件处理器（React 合成事件）：读原始分辨率写进徽章。
 * 参数类型刻意收窄成最小结构 —— 真实 React 事件与测试假事件都满足它。
 */
export function handleImageLoad(event: { currentTarget: Element }): void {
  const img = event.currentTarget as HTMLImageElement
  writeImageResolutionBadge(badgeHostOf(img), formatImageResolution(img.naturalWidth, img.naturalHeight))
}

/** img 的 error 事件处理器：徽章显示「尺寸不可读」，不留一个永远空着的标签 */
export function handleImageError(event: { currentTarget: Element }): void {
  writeImageResolutionBadge(badgeHostOf(event.currentTarget), IMAGE_RESOLUTION_UNAVAILABLE)
}
