// ============================================================================
// 测试说明（中文）：`imageStages.ts` —— 渲染层与判定层之间的属性约定。
// 这些字符串是两边的**口头契约**：改错一处不报错、只是图片不再分档加载，
// 因此用测试把字面值钉死（并说明每一处的用途）。
// ============================================================================

import { describe, expect, it } from 'vitest'

import {
  IMAGE_STAGE_ATTR,
  ORIGINAL_IMG_SELECTOR,
  SOURCE_PATH_ATTR,
  THUMB_IMG_SELECTOR,
} from './imageStages'

describe('imageStages · 渲染层与判定层的属性约定', () => {
  it('原图选择器是 img[data-original-url]（渲染层写入同名属性）', () => {
    expect(ORIGINAL_IMG_SELECTOR).toBe('img[data-original-url]')
  })

  it('缩略图选择器是 img[data-thumb-url]（渲染层只渲染空壳，判定层写 src）', () => {
    expect(THUMB_IMG_SELECTOR).toBe('img[data-thumb-url]')
  })

  it('档位属性是 data-card-image-stage（判定层直写 dataset 维护）', () => {
    expect(IMAGE_STAGE_ATTR).toBe('data-card-image-stage')
  })

  it('原图路径属性是 data-source-path（请求生成缓存缩略图用）', () => {
    expect(SOURCE_PATH_ATTR).toBe('data-source-path')
  })

  it('全部是 data-* 形式，否则 dataset 读不到', () => {
    for (const attr of [SOURCE_PATH_ATTR, IMAGE_STAGE_ATTR]) {
      expect(attr.startsWith('data-')).toBe(true)
    }
    for (const selector of [ORIGINAL_IMG_SELECTOR, THUMB_IMG_SELECTOR]) {
      expect(selector).toMatch(/^img\[data-[a-z-]+\]$/)
    }
  })
})
