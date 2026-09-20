// ============================================================================
// 测试说明（中文）
// 原图 / 缩略图两档加载的单元测试（17.7 + D3 大图内存优化）。
//
// 测的是纯逻辑层（可见区反算 / 相交 / 档位与滞回 / 动作计划），不依赖 DOM：
//   —— 判定规则是这段代码唯一容易出错的地方，也是「换掉 IntersectionObserver」
//   与「什么情况下释放原图」两个决策的依据。
//
// 实现任务：T1.4（阶段一）→ D3 扩展（2026-09-20）。
// ============================================================================

import { describe, it, expect } from 'vitest'

import {
  ORIGINAL_ENTER_SCREEN_W,
  ORIGINAL_EXIT_SCREEN_W,
  planStage,
  readImageMeta,
  rectsIntersect,
  stageForScreenWidth,
  visibleCanvasRect,
} from '@/canvas/lazyOriginal'
import type { CanvasRect, StageItem } from '@/canvas/lazyOriginal'

/** 造一份判定输入（默认：未见过的卡、屏幕宽 300、可见、有原图、缩略图已就绪） */
function item(over: Partial<StageItem> = {}): StageItem {
  return {
    stage: '',
    screenWidth: 300,
    visible: true,
    hasOriginalUrl: true,
    hasThumb: true,
    thumbLoaded: true,
    hasSourcePath: true,
    ...over,
  }
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
  it('读取坐标、原图地址、原图路径与档位', () => {
    const parsed = readImageMeta(
      dataset({
        x: '10',
        y: '20',
        w: '240',
        h: '180',
        originalUrl: 'a.jpg',
        sourcePath: 'D:\\s\\a.jpg',
        cardImageStage: 'thumb',
      }),
    )

    expect(parsed).toEqual({
      x: 10,
      y: 20,
      w: 240,
      h: 180,
      originalUrl: 'a.jpg',
      sourcePath: 'D:\\s\\a.jpg',
      stage: 'thumb',
    })
  })

  it('缺可选字段 → 原图地址 / 路径为空串、档位为「还没定过」', () => {
    const parsed = readImageMeta(dataset({ x: '0', y: '0', w: '1', h: '1' }))
    expect(parsed?.originalUrl).toBe('')
    expect(parsed?.sourcePath).toBe('')
    expect(parsed?.stage).toBe('')
  })

  it('档位是未知字符串 → 当作「还没定过」（脏数据不该让判定卡死）', () => {
    expect(readImageMeta(dataset({ x: '0', y: '0', w: '1', h: '1', cardImageStage: '???' }))?.stage)
      .toBe('')
  })

  it('坐标字段缺失或为空串 / 非数字 → 返回 null', () => {
    expect(readImageMeta(dataset({}))).toBeNull()
    expect(readImageMeta(dataset({ x: '', y: '0', w: '1', h: '1' }))).toBeNull()
    expect(readImageMeta(dataset({ x: 'NaN', y: '0', w: '1', h: '1' }))).toBeNull()
  })
})

describe('stageForScreenWidth · 档位与滞回', () => {
  it('首次判定（还没定过）：达到进入阈值用原图，否则用缩略图', () => {
    expect(stageForScreenWidth('', ORIGINAL_ENTER_SCREEN_W)).toBe('original')
    expect(stageForScreenWidth('', ORIGINAL_ENTER_SCREEN_W - 1)).toBe('thumb')
  })

  it('当前是缩略图档：滞回区内**不**升级（避免临界尺寸反复换图）', () => {
    expect(stageForScreenWidth('thumb', ORIGINAL_ENTER_SCREEN_W - 1)).toBe('thumb')
    expect(stageForScreenWidth('thumb', ORIGINAL_ENTER_SCREEN_W)).toBe('original')
  })

  it('当前是原图档：滞回区内**不**降级，缩到退出阈值才降', () => {
    expect(stageForScreenWidth('original', ORIGINAL_EXIT_SCREEN_W + 1)).toBe('original')
    expect(stageForScreenWidth('original', ORIGINAL_EXIT_SCREEN_W)).toBe('thumb')
  })

  it('两个阈值一进一出，且进入阈值大于退出阈值（否则滞回无意义）', () => {
    expect(ORIGINAL_ENTER_SCREEN_W).toBeGreaterThan(ORIGINAL_EXIT_SCREEN_W)
  })

  it('非有限值 / 负数按 0 处理 → 缩略图档，不抛错', () => {
    expect(stageForScreenWidth('', Number.NaN)).toBe('thumb')
    expect(stageForScreenWidth('original', Number.NaN)).toBe('thumb')
    expect(stageForScreenWidth('', -100)).toBe('thumb')
    expect(stageForScreenWidth('original', Number.POSITIVE_INFINITY)).toBe('original')
  })
})

describe('planStage · 动作计划', () => {
  it('该用原图且可见 → 写原图 src', () => {
    expect(planStage(item({ stage: 'thumb', screenWidth: 400 })).original).toBe('url')
  })

  it('该用原图但**不可见** → 不预加载（视口外不解码大图）', () => {
    const plan = planStage(item({ stage: 'thumb', screenWidth: 400, visible: false }))
    expect(plan.original).toBe('unchanged')
  })

  it('已经是原图档 → 不重复写 src', () => {
    const plan = planStage(item({ stage: 'original', screenWidth: 400 }))
    expect(plan.original).toBe('unchanged')
    expect(plan.thumb).toBe('unchanged')
  })

  it('缩小且缩略图就绪 → 释放原图（省解码内存）', () => {
    const plan = planStage(item({ stage: 'original', screenWidth: 80 }))
    expect(plan.original).toBe('none')
    expect(plan.requestThumb).toBe(false)
  })

  it('缩略图就绪但还没写进 img → 顺手补写 src', () => {
    const plan = planStage(item({ stage: 'original', screenWidth: 80, thumbLoaded: false }))
    expect(plan.thumb).toBe('url')
  })

  it('缩小但没有缩略图 → 请求生成，本帧**保留**原图（不留空白）', () => {
    const plan = planStage(item({ stage: 'original', screenWidth: 80, hasThumb: false }))
    expect(plan.original).toBe('unchanged')
    expect(plan.requestThumb).toBe(true)
  })

  it('缩小、没有缩略图、也从未加载过原图 → 先用原图顶上，同时请求生成', () => {
    const plan = planStage(item({ stage: '', screenWidth: 80, hasThumb: false }))
    expect(plan.original).toBe('url')
    expect(plan.requestThumb).toBe(true)
  })

  it('缩小、缩略图已就绪但从未加载过原图 → 直接用缩略图，不加载原图', () => {
    const plan = planStage(item({ stage: '', screenWidth: 80 }))
    expect(plan).toEqual({ original: 'unchanged', thumb: 'unchanged', requestThumb: false })
  })

  it('不知道原图绝对路径 → 无法请求生成，只做能做到的部分', () => {
    const plan = planStage(item({ stage: 'original', screenWidth: 80, hasSourcePath: false, hasThumb: false }))
    expect(plan.requestThumb).toBe(false)
    expect(plan.original).toBe('unchanged')
  })

  it('没有原图 URL（未登记 / 非桌面）→ 不动任何 src，也不请求', () => {
    const plan = planStage(
      item({ stage: '', screenWidth: 80, hasOriginalUrl: false, hasThumb: false, hasSourcePath: false }),
    )
    expect(plan).toEqual({ original: 'unchanged', thumb: 'unchanged', requestThumb: false })
  })

  it('缩略图档且缩略图已写入 → 完全不动 DOM（幂等，避免无谓重解码）', () => {
    const plan = planStage(item({ stage: 'thumb', screenWidth: 80 }))
    expect(plan).toEqual({ original: 'unchanged', thumb: 'unchanged', requestThumb: false })
  })
})
