// ============================================================================
// 模块说明（中文）
// 批量缩略图生成。对应 T1.4 验收标准「首次进空间生成缩略图；二次进入直接读缓存」
// 与 17.7「首屏策略」——上画布前先把每张图的缩略图备好，卡片只显示缩略图。
//
// 【为什么"批量 + 限流"】
//   50 张图同时调 make_thumbnail 会让 Rust 端并发解码 50 张大图，内存峰值直接爆掉
//   （17.11 反模式 9「一次性加载文件夹内所有原图」的同类问题）。
//   这里用固定数量的 worker 消费同一个队列，默认 6 路并发：
//   既吃满多核，又把同时在解码的图片数压在可控范围内。
//
// 【容错策略】
//   单张失败（文件损坏 / 扩展名骗人 / 无权限）不影响整体：记进 failed，卡片退回兜底尺寸。
//   绝不因为一张坏图就让整个空间打不开。
//
// 【缓存】
//   不在这里判断缓存 —— 缓存命中判定在 Rust 侧（hash 含 mtime），前端无脑调用即可。
//   17.7 的「二次进入直接读缓存」由 Rust 的 make_thumbnail 实现，这里天然满足。
//
// 依赖 StorageProvider 抽象，可注入假 provider 单元测试。
//
// 实现任务：T1.4（阶段一）。
// ============================================================================

import type { DirEntry, StorageProvider, ThumbInfo } from '@/core/storage/StorageProvider'
import { isImageFile } from './imageTypes'
import { selectMediaEntries } from './buildCards'

/** 默认并发数：6 路。Rust 侧解码是 CPU 密集，再高收益递减、内存风险上升 */
export const DEFAULT_THUMBNAIL_CONCURRENCY = 6

/** 批量结果：成功表（文件名 → 缩略图信息）+ 失败表（文件名 → 中文原因） */
export interface ThumbnailBatchResult {
  /** key 为文件名（相对空间文件夹的路径） */
  byName: Map<string, ThumbInfo>
  /** key 为文件名，value 为可直接展示的中文原因 */
  failed: Map<string, string>
}

/**
 * 用固定数量的 worker 消费队列，保证同时最多 `limit` 个任务在跑。
 * 单个任务抛错由 `worker` 自行处理（本函数不吞错，会向上抛）。
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return

  const safeLimit = Math.max(1, Math.min(Math.floor(limit), items.length))
  let cursor = 0

  const run = async (): Promise<void> => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      await worker(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: safeLimit }, run))
}

/** 从目录项里筛出「需要生成缩略图」的图片（跳过目录、隐藏文件、非图片） */
export function imageEntries(entries: readonly DirEntry[]): DirEntry[] {
  return selectMediaEntries([...entries]).filter((entry) => isImageFile(entry.name))
}

export interface CollectThumbnailsOptions {
  /** 并发数，默认 DEFAULT_THUMBNAIL_CONCURRENCY */
  concurrency?: number
}

/**
 * 为一批图片生成（或复用缓存的）缩略图。
 *
 * @param entries   该目录的**全部**目录项；内部自行筛出图片
 * @param spacePath 空间文件夹绝对路径（Rust 侧据此决定 .mindscape/thumbnails 的位置）
 * @param provider  存储实现
 */
export async function collectThumbnails(
  entries: readonly DirEntry[],
  spacePath: string,
  provider: StorageProvider,
  options: CollectThumbnailsOptions = {},
): Promise<ThumbnailBatchResult> {
  const byName = new Map<string, ThumbInfo>()
  const failed = new Map<string, string>()

  const targets = imageEntries(entries)
  if (targets.length === 0) return { byName, failed }

  // provider 未实现该能力（例如测试用的精简假实现）→ 直接返回空结果，交给调用方兜底
  if (typeof provider.makeThumbnail !== 'function') {
    return { byName, failed }
  }

  await runWithConcurrency(
    targets,
    options.concurrency ?? DEFAULT_THUMBNAIL_CONCURRENCY,
    async (entry) => {
      try {
        const info = await provider.makeThumbnail(entry.path, spacePath)
        byName.set(entry.name, info)
      } catch (error) {
        failed.set(entry.name, error instanceof Error ? error.message : String(error))
      }
    },
  )

  return { byName, failed }
}
