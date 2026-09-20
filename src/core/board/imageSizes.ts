// ============================================================================
// 模块说明（中文）
// 批量读取图片**原始尺寸**（只读图头，不解码全图）。对应 17.7「首屏策略」与
// T1.4「图片按原始宽高比显示」。
//
// 【为什么取代了缩略图批量生成】（2026-09-12 用户裁决：方案 A）
//   原方案为每张图生成无损 WebP 缩略图（thumbnails.ts / make_thumbnail），
//   但 image crate 只支持无损 WebP 编码，照片类缩略图体积与原图同量级，
//   导致空间文件夹被 .mindscape/thumbnails 撑爆。裁决：空间文件夹内不再生成
//   任何缩略图，卡片直接加载原图 —— 卡片宽高比改由 read_image_size 读图头获得
//   （毫秒级、不解码），渲染走 lazyOriginal 的「可见时才加载」机制。
//   回退方式：git revert 本系列提交（Rust 端 make_thumbnail 命令保留未删）。
//
// 【为什么"批量 + 限流"】
//   50 张图同时调 read_image_size 会有 50 次 IPC 往返排队；这里用固定数量的
//   worker 消费同一个队列（默认 6 路并发），把整批耗时压到个位数百毫秒级。
//
// 【容错策略】
//   单张失败（文件损坏 / 无权限 / 扩展名骗人且内容也认不出）不影响整体：记进
//   failed，该卡片退回类型默认尺寸。绝不因为一张坏图就让整个空间打不开。
//
//   ⚠️ 扩展名骗人**本身已不再是失败原因**（2026-09-20 修复）：Rust 侧
//   read_image_size 改为按文件头嗅探真实格式，JPEG 内容 + .png 扩展名也能读出
//   尺寸。此前的现场是「把 JPEG 改名成 .png 放进空间文件夹 → 进空间弹
//   『Invalid PNG signature』→ 卡片退回默认尺寸」。详见 system.rs 的注释与
//   reads_dimensions_when_extension_lies 测试。
//
// 依赖 StorageProvider 抽象，可注入假 provider 单元测试。
//
// 实现任务：T1.4（阶段一，原为缩略图）→ 2026-09-12 重构为尺寸读取（方案 A）。
// ============================================================================

import type { DirEntry, ImageSize, StorageProvider } from '@/core/storage/StorageProvider'
import { isImageFile } from './imageTypes'
import { selectMediaEntries } from './buildCards'

/** 默认并发数：6 路。再高收益递减（单次调用只是读图头，耗时极短） */
export const DEFAULT_IMAGE_CONCURRENCY = 6

/** 批量结果：成功表（文件名 → 原图尺寸）+ 失败表（文件名 → 中文原因） */
export interface ImageSizeBatchResult {
  /** key 为文件名（相对空间文件夹的路径），与 card.filePath 对齐 */
  byName: Map<string, ImageSize>
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

/** 从目录项里筛出「需要读取尺寸」的图片（跳过目录、隐藏文件、非图片） */
export function imageEntries(entries: readonly DirEntry[]): DirEntry[] {
  return selectMediaEntries([...entries]).filter((entry) => isImageFile(entry.name))
}

export interface CollectImageSizesOptions {
  /** 并发数，默认 DEFAULT_IMAGE_CONCURRENCY */
  concurrency?: number
}

/**
 * 为一批图片批量读取**原图尺寸**（Rust 侧只读图片头，不解码全图）。
 *
 * @param entries  该目录的**全部**目录项；内部自行筛出图片
 * @param provider 存储实现
 */
export async function collectImageSizes(
  entries: readonly DirEntry[],
  provider: StorageProvider,
  options: CollectImageSizesOptions = {},
): Promise<ImageSizeBatchResult> {
  const byName = new Map<string, ImageSize>()
  const failed = new Map<string, string>()

  const targets = imageEntries(entries)
  if (targets.length === 0) return { byName, failed }

  // provider 未实现该能力（例如测试用的精简假实现）→ 直接返回空结果，交给调用方兜底
  if (typeof provider.readImageSize !== 'function') {
    return { byName, failed }
  }

  await runWithConcurrency(
    targets,
    options.concurrency ?? DEFAULT_IMAGE_CONCURRENCY,
    async (entry) => {
      try {
        const size = await provider.readImageSize(entry.path)
        byName.set(entry.name, size)
      } catch (error) {
        failed.set(entry.name, error instanceof Error ? error.message : String(error))
      }
    },
  )

  return { byName, failed }
}
