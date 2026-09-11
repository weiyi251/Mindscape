// ============================================================================
// 模块说明（中文）
// 原图懒加载的单元测试。对应 17.7「视口内加载原图、视口外加载缩略图」。
//
// 测的是纯逻辑层（可见区反算 / 相交 / 挑选），不依赖 DOM：
//   —— 判定规则是这段代码唯一容易出错的地方，也是「换掉 IntersectionObserver」的依据。
//
// 实现任务：T1.4（阶段一）。
// ============================================================================

import { describe, it, expect } from 'vitest'

import {
  ORIGINAL_IMG_SELECTOR,
  planUpgrade,
  readImageMeta,
  rectsIntersect,
  visibleCanvasRect,
} from '@/canvas/lazyOriginal'
import type { CanvasRect, LazyImageMeta } from '@/canvas/lazyOriginal'

/** 造一张图片元信息（默认在可见区内、未升级） */
function meta(over: Partial<LazyImageMeta> = {}): LazyImageMeta {
  return { x: 0, y: 0, w: 240, h: 180, originalUrl: 'orig.jpg', upgraded: false, ...over }
}

/** 造一个 dataset（模拟 DOMStringMap） */
function dataset(values: Record<string, string>): DOMStringMap {
  return values as unknown as DOMStringMap
}

describe('visibleCanvasRect', () => {
  it('未缩放未平移 → 就是容器自身尺寸', () => {
    expect(visibleCanvasRect({ zoom: 1, offsetX: 0, offsetY: 0 }, 1000, 800)).toEqual({
      x: 0,
      y: 0,
      w: 1000,
      h: 800,
    })
  })

  it('放大 2 倍并平移 → 可见范围缩小且跟随偏移', () => {
    expect(visibleCanvasRect({ zoom: 2, offsetX: -100, offsetY: -200 }, 1000, 800)).toEqual({
      x: 50,
      y: 100,
      w: 500,
      h: 400,
    })
  })

  it('缩小到 50% → 可见范围变大', () => {
    expect(visibleCanvasRect({ zoom: 0.5, offsetX: 0, offsetY: 0 }, 1000, 800)).toEqual({
      x: 0,
      y: 0,
      w: 2000,
      h: 1600,
    })
  })

  it('正向平移（向右下拖）→ 可见原点变为负值', () => {
    expect(visibleCanvasRect({ zoom: 1, offsetX: 300, offsetY: 100 }, 1000, 800)).toEqual({
      x: -300,
      y: -100,
      w: 1000,
      h: 800,
    })
  })

  it('非法输入（zoom ≤ 0 / 容器尺寸为 0）→ 空矩形，不产生 NaN', () => {
    const rect = visibleCanvasRect({ zoom: 0, offsetX: 0, offsetY: 0 }, 1000, 800)
    expect(rect).toEqual({ x: 0, y: 0, w: 0, h: 0 })
    expect(visibleCanvasRect({ zoom: 1, offsetX: 0, offsetY: 0 }, 0, 800).w).toBe(0)
  })
})

describe('rectsIntersect', () => {
  const base: CanvasRect = { x: 0, y: 0, w: 100, h: 100 }

  it('重叠 → true', () => {
    expect(rectsIntersect(base, { x: 50, y: 50, w: 100, h: 100 })).toBe(true)
  })

  it('完全包含 → true', () => {
    expect(rectsIntersect(base, { x: 10, y: 10, w: 20, h: 20 })).toBe(true)
  })

  it('分离 → false', () => {
    expect(rectsIntersect(base, { x: 200, y: 200, w: 10, h: 10 })).toBe(false)
  })

  it('边缘刚好贴合 → false（贴合等于不可见）', () => {
    expect(rectsIntersect(base, { x: 100, y: 0, w: 50, h: 50 })).toBe(false)
  })
})

describe('readImageMeta', () => {
  it('读取坐标、原图地址与升级状态', () => {
    const parsed = readImageMeta(
      dataset({ x: '10', y: '20', w: '240', h: '180', originalUrl: 'a.jpg', upgraded: '1' }),
    )

    expect(parsed).toEqual({ x: 10, y: 20, w: 240, h: 180, originalUrl: 'a.jpg', upgraded: true })
  })

  it('缺 upgraded 字段 → upgraded 为 false', () => {
    const parsed = readImageMeta(dataset({ x: '0', y: '0', w: '1', h: '1' }))
    expect(parsed?.upgraded).toBe(false)
    expect(parsed?.originalUrl).toBe('')
  })

  it('坐标字段缺失或为空串 → 返回 null', () => {
    expect(readImageMeta(dataset({}))).toBeNull()
    expect(readImageMeta(dataset({ x: '', y: '0', w: '1', h: '1' }))).toBeNull()
    expect(readImageMeta(dataset({ x: 'NaN', y: '0', w: '1', h: '1' }))).toBeNull()
  })
})

describe('planUpgrade', () => {
  const visible: CanvasRect = { x: 0, y: 0, w: 1000, h: 800 }

  it('视口内的未升级图片被挑中', () => {
    const images = [meta({ x: 100, y: 100 }), meta({ x: 5000, y: 100 })]

    expect(planUpgrade(images, visible)).toEqual([0])
  })

  it('已升级的图片不再被挑中（单向升级）', () => {
    const images = [meta({ upgraded: true }), meta({ x: 10, y: 10 })]

    expect(planUpgrade(images, visible)).toEqual([1])
  })

  it('元信息为 null（dataset 残缺）的图片被安全跳过', () => {
    expect(planUpgrade([null, meta()], visible)).toEqual([1])
  })

  it('空数组 → 空结果', () => {
    expect(planUpgrade([], visible)).toEqual([])
  })

  it('平移后原本在视口外的图片变得可见（transform 不影响判定）', () => {
    const images = [meta({ x: 2000, y: 0 })]

    // 画布向左平移 1800px → 可见范围变为 [1800, 2800]
    const shifted = visibleCanvasRect({ zoom: 1, offsetX: -1800, offsetY: 0 }, 1000, 800)

    expect(planUpgrade(images, visible)).toEqual([])
    expect(planUpgrade(images, shifted)).toEqual([0])
  })

  it('放大到 400% 时只有真正可见的卡片被挑中', () => {
    const images = [meta({ x: 0, y: 0 }), meta({ x: 400, y: 0 })]

    // 400% 时可见范围只有 250 × 200 画布像素
    const zoomed = visibleCanvasRect({ zoom: 4, offsetX: 0, offsetY: 0 }, 1000, 800)

    expect(planUpgrade(images, zoomed)).toEqual([0])
  })

  it('全部可见且都未升级 → 全部挑中，顺序与输入一致', () => {
    const images = [meta({ x: 0 }), meta({ x: 300 }), meta({ x: 600 })]

    expect(planUpgrade(images, visible)).toEqual([0, 1, 2])
  })
})

describe('ORIGINAL_IMG_SELECTOR', () => {
  it('是 img[data-original-url]，与渲染层写入的属性名一致', () => {
    expect(ORIGINAL_IMG_SELECTOR).toBe('img[data-original-url]')
  })
})
