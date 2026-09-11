// ============================================================================
// 模块说明（中文）
// 批量缩略图的单元测试。对应 T1.4 验收标准：
//   「首次进空间生成缩略图；二次进入直接读缓存（验 thumbnails/ 目录）」
//   —— 缓存判定在 Rust 侧，前端这层保证的是「每张图都被请求了一次、失败不拖垮整体」。
//
// 同时守护 17.11 反模式 9（一次性加载所有原图）：并发必须被限住。
//
// 实现任务：T1.4（阶段一）。
// ============================================================================

import { describe, it, expect } from 'vitest'

import {
  DEFAULT_THUMBNAIL_CONCURRENCY,
  collectThumbnails,
  imageEntries,
  runWithConcurrency,
} from '@/core/board/thumbnails'
import type { DirEntry, StorageProvider, ThumbInfo } from '@/core/storage/StorageProvider'

function entry(name: string, isDir = false): DirEntry {
  return { name, path: `D:\\空间\\${name}`, isDir, size: 1024, modifiedAt: 1 }
}

/** 只实现 makeThumbnail 的假 provider */
function thumbProvider(
  impl: (src: string) => Promise<ThumbInfo>,
): StorageProvider {
  return { makeThumbnail: impl } as unknown as StorageProvider
}

describe('imageEntries', () => {
  it('只保留图片，跳过目录 / 隐藏文件 / 非图片', () => {
    const picked = imageEntries([
      entry('a.jpg'),
      entry('b.png'),
      entry('说明.pdf'),
      entry('sub', true),
      entry('.DS_Store'),
      entry('.hidden.png'),
    ])

    expect(picked.map((item) => item.name)).toEqual(['a.jpg', 'b.png'])
  })

  it('空目录 → 空数组', () => {
    expect(imageEntries([])).toEqual([])
  })
})

describe('runWithConcurrency', () => {
  it('全部任务都被执行，且顺序按原数组推进', async () => {
    const done: number[] = []
    await runWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      done.push(item)
    })

    expect(done).toEqual([1, 2, 3, 4, 5])
  })

  it('同时在跑的任务数不超过 limit（17.11 反模式 9 的守卫）', async () => {
    let running = 0
    let peak = 0

    await runWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 1))
      running -= 1
    })

    expect(peak).toBeLessThanOrEqual(4)
    expect(peak).toBeGreaterThan(1) // 确实是并发而不是串行
  })

  it('limit 大于任务数时退化为任务数，不创建空转 worker', async () => {
    let calls = 0
    await runWithConcurrency([1, 2], 10, async () => {
      calls += 1
    })

    expect(calls).toBe(2)
  })

  it('空数组直接返回', async () => {
    let called = false
    await runWithConcurrency([], 4, async () => {
      called = true
    })
    expect(called).toBe(false)
  })
})

describe('collectThumbnails', () => {
  it('每张图片各调一次 make_thumbnail，结果按文件名归位', async () => {
    const called: string[] = []
    const provider = thumbProvider(async (src) => {
      called.push(src)
      return { path: `${src}.webp`, width: 800, height: 600 }
    })

    const result = await collectThumbnails(
      [entry('a.jpg'), entry('b.png'), entry('总平面.pdf')],
      'D:\\空间',
      provider,
    )

    expect(called.sort()).toEqual(['D:\\空间\\a.jpg', 'D:\\空间\\b.png'])
    expect(result.byName.get('a.jpg')).toEqual({ path: 'D:\\空间\\a.jpg.webp', width: 800, height: 600 })
    expect(result.failed.size).toBe(0)
  })

  it('单张失败不影响其余图片，失败原因记入 failed', async () => {
    const provider = thumbProvider(async (src) => {
      if (src.endsWith('bad.jpg')) throw new Error('解码图片失败：损坏的文件')
      return { path: `${src}.webp`, width: 100, height: 100 }
    })

    const result = await collectThumbnails(
      [entry('ok.jpg'), entry('bad.jpg'), entry('also-ok.png')],
      'D:\\空间',
      provider,
    )

    expect([...result.byName.keys()].sort()).toEqual(['also-ok.png', 'ok.jpg'])
    expect(result.failed.get('bad.jpg')).toBe('解码图片失败：损坏的文件')
  })

  it('非 Error 抛出物也能归一化成可展示文本', async () => {
    const provider = thumbProvider(async () => {
      throw '字符串错误'
    })

    const result = await collectThumbnails([entry('a.jpg')], 'D:\\空间', provider)
    expect(result.failed.get('a.jpg')).toBe('字符串错误')
  })

  it('目录里没有图片 → 不调用 provider', async () => {
    let called = 0
    const provider = thumbProvider(async () => {
      called += 1
      return { path: '', width: 0, height: 0 }
    })

    const result = await collectThumbnails([entry('a.pdf'), entry('sub', true)], 'D:\\空间', provider)

    expect(called).toBe(0)
    expect(result.byName.size).toBe(0)
  })

  it('provider 未实现 makeThumbnail（精简假实现）→ 返回空结果而不抛错', async () => {
    const provider = { listDir: async () => [] } as unknown as StorageProvider
    const result = await collectThumbnails([entry('a.jpg')], 'D:\\空间', provider)

    expect(result.byName.size).toBe(0)
    expect(result.failed.size).toBe(0)
  })

  it('并发数可配置，且不超过默认上限', async () => {
    let running = 0
    let peak = 0
    const provider = thumbProvider(async () => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 1))
      running -= 1
      return { path: 'x.webp', width: 1, height: 1 }
    })

    await collectThumbnails(
      Array.from({ length: 12 }, (_, i) => entry(`ref-${i}.jpg`)),
      'D:\\空间',
      provider,
      { concurrency: 3 },
    )

    expect(peak).toBeLessThanOrEqual(3)
    expect(DEFAULT_THUMBNAIL_CONCURRENCY).toBeGreaterThanOrEqual(1)
  })

  it('cache 语义：同一批图片再调一次仍逐张请求（缓存命中由 Rust 侧决定）', async () => {
    let calls = 0
    const provider = thumbProvider(async (src) => {
      calls += 1
      return { path: `${src}.webp`, width: 10, height: 10 }
    })

    await collectThumbnails([entry('a.jpg')], 'D:\\空间', provider)
    await collectThumbnails([entry('a.jpg')], 'D:\\空间', provider)

    expect(calls).toBe(2)
  })
})
