// ============================================================================
// 测试说明（中文）：`thumbnailCache.ts`（D3 缩略图缓存表 + 调度器）。
// 环境是 node（不引入 jsdom）—— 本模块只做「内存表 + IPC 调度」，不碰 DOM，
// 因此用假 invoke 即可完整覆盖：入队幂等、并发上限、失败不重试、清空。
// ============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  desktop: vi.fn(() => true),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: h.invoke }))
vi.mock('@/core/utils/runtime', () => ({ isDesktopRuntime: h.desktop }))
vi.mock('@/core/utils/media', () => ({
  toAssetUrl: (path: string) => (path ? `asset://${path}` : ''),
}))

import {
  MAX_CONCURRENT_THUMB_JOBS,
  activeThumbJobs,
  getCachedThumbUrl,
  queuedThumbJobs,
  requestCachedThumbnail,
  resetThumbnailCache,
  thumbStatusOf,
} from './thumbnailCache'

/** 让已排队的 promise 回调跑完（IPC 是异步的，状态更新后于返回值） */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** 可手动完成的 invoke：用于观察并发数与排队情况 */
function deferredInvoke(): Array<(value: unknown) => void> {
  const resolvers: Array<(value: unknown) => void> = []
  h.invoke.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvers.push(resolve)
      }),
  )
  return resolvers
}

beforeEach(() => {
  h.invoke.mockReset()
  h.desktop.mockReset()
  h.desktop.mockReturnValue(true)
  resetThumbnailCache()
})

describe('thumbnailCache · 基础状态机', () => {
  it('从未请求过：状态为 null、URL 为空串', () => {
    expect(thumbStatusOf('C:/space/a.png')).toBeNull()
    expect(getCachedThumbUrl('C:/space/a.png')).toBe('')
    expect(h.invoke).not.toHaveBeenCalled()
  })

  it('首次请求：入队并最终变为 ready，URL 指向缩略图资源', async () => {
    h.invoke.mockResolvedValue({ path: 'C:/cache/abc.webp', width: 640, height: 480 })

    expect(requestCachedThumbnail('C:/space/a.png')).toBe(true)
    expect(thumbStatusOf('C:/space/a.png')).toBe('pending')

    await flush()

    expect(h.invoke).toHaveBeenCalledWith('make_cached_thumbnail', { src: 'C:/space/a.png' })
    expect(thumbStatusOf('C:/space/a.png')).toBe('ready')
    expect(getCachedThumbUrl('C:/space/a.png')).toBe('asset://C:/cache/abc.webp')
  })

  it('重复请求幂等：只发一次 IPC', async () => {
    h.invoke.mockResolvedValue({ path: 'C:/cache/abc.webp', width: 640, height: 480 })

    expect(requestCachedThumbnail('C:/space/a.png')).toBe(true)
    expect(requestCachedThumbnail('C:/space/a.png')).toBe(false)

    await flush()
    expect(requestCachedThumbnail('C:/space/a.png')).toBe(false)
    expect(h.invoke).toHaveBeenCalledTimes(1)
  })

  it('生成失败：记 failed、URL 保持空串、且不再重试（判定循环每帧都会问一次）', async () => {
    h.invoke.mockRejectedValue(new Error('解码图片失败'))

    requestCachedThumbnail('C:/space/broken.png')
    await flush()

    expect(thumbStatusOf('C:/space/broken.png')).toBe('failed')
    expect(getCachedThumbUrl('C:/space/broken.png')).toBe('')
    expect(requestCachedThumbnail('C:/space/broken.png')).toBe(false)
    expect(h.invoke).toHaveBeenCalledTimes(1)
  })

  it('空路径不请求（渲染层在无资源卡上会传空串）', () => {
    expect(requestCachedThumbnail('')).toBe(false)
    expect(h.invoke).not.toHaveBeenCalled()
  })

  it('非桌面环境（浏览器 dev / 测试）：不发 IPC，返回 false', async () => {
    h.desktop.mockReturnValue(false)

    expect(requestCachedThumbnail('C:/space/a.png')).toBe(false)
    await flush()
    expect(h.invoke).not.toHaveBeenCalled()
    expect(getCachedThumbUrl('C:/space/a.png')).toBe('')
  })
})

describe('thumbnailCache · 并发与队列', () => {
  it(`同时在跑的任务不超过 ${MAX_CONCURRENT_THUMB_JOBS} 个，其余排队`, async () => {
    const resolvers = deferredInvoke()
    const paths = ['a', 'b', 'c', 'd', 'e'].map((name) => `C:/space/${name}.png`)

    for (const path of paths) expect(requestCachedThumbnail(path)).toBe(true)
    await flush()

    expect(activeThumbJobs()).toBe(MAX_CONCURRENT_THUMB_JOBS)
    expect(queuedThumbJobs()).toBe(paths.length - MAX_CONCURRENT_THUMB_JOBS)

    // 放行一个 → 队列里的下一个立刻补位
    resolvers[0]({ path: 'C:/cache/0.webp', width: 640, height: 480 })
    await flush()
    expect(activeThumbJobs()).toBe(MAX_CONCURRENT_THUMB_JOBS)
    expect(queuedThumbJobs()).toBe(paths.length - MAX_CONCURRENT_THUMB_JOBS - 1)

    // 全部放行：每放行一个，队列里的下一个立刻补位（resolvers 随之增长）
    let index = 0
    while (index < resolvers.length) {
      resolvers[index]({ path: `C:/cache/${index}.webp`, width: 640, height: 480 })
      index += 1
      await flush()
    }

    expect(queuedThumbJobs()).toBe(0)
    expect(activeThumbJobs()).toBe(0)
  })

  it('reset 清空缓存与队列；清空后旧任务的结果不再写回', async () => {
    const resolvers = deferredInvoke()
    requestCachedThumbnail('C:/space/a.png')
    requestCachedThumbnail('C:/space/b.png')
    await flush()

    resetThumbnailCache()
    expect(thumbStatusOf('C:/space/a.png')).toBeNull()
    expect(queuedThumbJobs()).toBe(0)

    // 已在飞行中的两个任务完成后不得「复活」条目
    resolvers[0]({ path: 'C:/cache/a.webp', width: 640, height: 480 })
    resolvers[1]({ path: 'C:/cache/b.webp', width: 640, height: 480 })
    await flush()

    expect(thumbStatusOf('C:/space/a.png')).toBeNull()
    expect(thumbStatusOf('C:/space/b.png')).toBeNull()
    expect(getCachedThumbUrl('C:/space/a.png')).toBe('')
  })
})
