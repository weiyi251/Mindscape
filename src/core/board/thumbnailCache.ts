// ============================================================================
// 模块说明（中文）
// D3（2026-09-20 用户计划第 4 步）：缩略图缓存表 + 按需生成调度器。
//
// 【它解决什么问题】
//   方案 A（2026-09-12 用户裁决）下卡片直接加载原图。缩小到 25% 时屏幕上几十张
//   大图**仍然按原图解码**（解码内存 ≈ 宽 × 高 × 4 字节 × 同屏张数），画布很容易
//   吃到几百 MB。但卡片显示尺寸很小时其实只需要几百像素宽的图 —— 于是：
//   · 低档位（卡片显示得小）用缩略图；
//   · 放大回高档位再换原图。
//   档位判定与滞回在 `canvas/lazyOriginal.ts`（纯函数 + DOM 直写，不进 state）。
//
// 【为什么是模块级内存表】
//   与 `core/board/cardAssets.ts` 同一理由：原图绝对路径是本机运行期派生数据，
//   不落盘、不进 Zustand。这里存的是「原图绝对路径 → 缩略图状态」。
//
// 【落盘位置由 Rust 决定】
//   输出目录是 `%APPDATA%\Mindscape\cache\thumbs\`（Rust 侧 app_data_dir 解析），
//   前端不关心路径、也不写进空间文件夹（方案 A 废弃缩略图的根因就是污染空间目录）。
//
// 【降级与失败】
//   · 非桌面环境（浏览器 dev / vitest）不发 IPC，一律返回空串；
//   · 生成失败（文件损坏 / 已被删）记 `failed` 且**不再重试** —— 判定循环每帧都
//     会问一次，不记住失败就会把 IPC 打爆；
//   · 并发上限 2：生成要解码整张大图，全速并发会把 UI 线程拖住。
// ============================================================================

import { invoke } from '@tauri-apps/api/core'

import { toAssetUrl } from '@/core/utils/media'
import { isDesktopRuntime } from '@/core/utils/runtime'

/** Rust `make_cached_thumbnail` 的返回值（camelCase 与 serde 配置一致） */
interface CachedThumbInfo {
  path: string
  width: number
  height: number
}

/** 一张缩略图的生成状态 */
export type ThumbStatus = 'pending' | 'ready' | 'failed'

interface ThumbEntry {
  status: ThumbStatus
  /** 可放进 <img src> 的 URL（仅 ready 时非空） */
  url: string
}

/** 同时进行的生成任务上限（生成要解码整张大图，并发过高会拖住 UI 线程） */
export const MAX_CONCURRENT_THUMB_JOBS = 2

const entries = new Map<string, ThumbEntry>()
const queue: string[] = []
let runningJobs = 0

/**
 * 取已就绪的缩略图 URL；未请求 / 生成中 / 失败一律返回空串
 * （调用方据此退回原图，绝不显示空白）。
 */
export function getCachedThumbUrl(sourcePath: string): string {
  if (!sourcePath) return ''
  const entry = entries.get(sourcePath)
  return entry?.status === 'ready' ? entry.url : ''
}

/** 该原图的缩略图状态；从未请求过返回 null */
export function thumbStatusOf(sourcePath: string): ThumbStatus | null {
  return entries.get(sourcePath)?.status ?? null
}

/** 正在进行的生成任务数（测试 / 调试用） */
export function activeThumbJobs(): number {
  return runningJobs
}

/** 排队等待生成的任务数（测试 / 调试用） */
export function queuedThumbJobs(): number {
  return queue.length
}

/**
 * 请求生成一张缩略图（幂等：已请求过就直接返回）。
 *
 * @returns 本次是否**新入队**（首次请求 true；已在生成 / 已就绪 / 已失败都 false）
 */
export function requestCachedThumbnail(sourcePath: string): boolean {
  if (!sourcePath) return false
  if (!isDesktopRuntime()) return false
  if (entries.has(sourcePath)) return false

  entries.set(sourcePath, { status: 'pending', url: '' })
  queue.push(sourcePath)
  pump()
  return true
}

/** 清空缓存表与队列（切空间 / 测试用；生成中途的请求结果会被丢弃） */
export function resetThumbnailCache(): void {
  entries.clear()
  queue.length = 0
}

function pump(): void {
  while (runningJobs < MAX_CONCURRENT_THUMB_JOBS && queue.length > 0) {
    const sourcePath = queue.shift()
    if (sourcePath === undefined) break
    runningJobs += 1
    void runJob(sourcePath)
  }
}

async function runJob(sourcePath: string): Promise<void> {
  try {
    const info = await invoke<CachedThumbInfo>('make_cached_thumbnail', { src: sourcePath })
    // reset 之后返回的结果不再写入（避免旧空间的残留条目复活）
    if (entries.has(sourcePath)) {
      entries.set(sourcePath, { status: 'ready', url: toAssetUrl(info.path) })
    }
  } catch {
    // 失败原因（文件损坏 / 被删）对用户无意义 —— 卡片会照常退回原图，这里只记状态
    if (entries.has(sourcePath)) {
      entries.set(sourcePath, { status: 'failed', url: '' })
    }
  } finally {
    runningJobs -= 1
    pump()
  }
}
