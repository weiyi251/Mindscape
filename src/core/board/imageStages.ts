// ============================================================================
// 模块说明（中文）
// 图片卡「两档加载」在渲染层与判定层之间的**唯一约定**（D3，2026-09-20）。
//
// 为什么单独一个文件：渲染层（`core/registry/cardTypes.ts`）需要写这些属性，
// 判定层（`canvas/lazyOriginal.ts`）需要读同一批属性。判定层在 canvas 层，
// 渲染层在 core 层 —— core 只能向下依赖，不能让渲染层反过来 import canvas。
// 于是把这些字符串常量放在 core，两边共用，改一处两边同步（有单测守着）。
//
// 结构约定（渲染层负责建出这个结构，判定层按选择器查找）：
//   <div class="relative ...">              相对定位容器（两层叠放、object-contain 对齐）
//     <img data-thumb-url data-card-image-stage="thumb">     下层：缩略图（初始 src 空）
//     <img data-original-url data-card-image-stage="original" 上层：原图（初始 src 空）
//          data-source-path="D:\..." data-x data-y data-w data-h>
//   </div>
// ============================================================================

/** 原图 img 的属性名（判定层的主驱动选择器） */
export const ORIGINAL_IMG_SELECTOR = 'img[data-original-url]'

/** 缩略图 img 的属性名（判定层写入 src；渲染层只负责渲染出空壳） */
export const THUMB_IMG_SELECTOR = 'img[data-thumb-url]'

/** 原图绝对路径的属性名（请求生成缓存缩略图需要它） */
export const SOURCE_PATH_ATTR = 'data-source-path'

/** 当前档位的属性名（'original' / 'thumb'；由判定层直写 dataset 维护） */
export const IMAGE_STAGE_ATTR = 'data-card-image-stage'
