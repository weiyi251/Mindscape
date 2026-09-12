// ============================================================================
// 模块说明（中文）
// 应用内检查更新 —— 对 Tauri updater 插件的薄封装。
//
// 该能力不在 17 章原定范围内，是经用户批准后引入的（tauri-plugin-updater 为
// Tauri 官方插件）。设计要点：
//   · 检查端点与签名公钥统一配置在 tauri.conf.json 的 plugins.updater，
//     前端不重复声明，避免两处维护；
//   · 二进制必须验签，签名不通过时插件会直接拒绝安装，本模块只负责把失败
//     归一化成可展示的信息；
//   · 非桌面环境（浏览器直接打开 dev 地址）没有 Rust 后端，短路为 unsupported，
//     与 App.tsx 中 isDesktopRuntime 的处理保持一致；
//   · 检查失败一律不向上抛 —— 更新检查出问题绝不该影响应用正常使用。
//
// 本模块只做「调用 + 结果归一化」，不含任何 UI（UI 见 pages/SpaceList.tsx 与
// components/ui/update-dialog.tsx）。
// ============================================================================

import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

import { isDesktopRuntime } from '@/core/utils/runtime'

/** 更新流程涉及的全部中文文案，统一在此维护（组件内不硬编码中文） */
export const UPDATE_TEXT = {
  menuEntry: '检查更新',
  checking: '正在检查更新…',
  upToDate: '已是最新版本',
  unsupported: '当前环境不支持检查更新',
  failed: '检查更新失败',
  available: '发现新版本',
  downloading: '正在下载更新…',
  readyTitle: '更新已安装',
  restartPrompt: '更新已安装，重启应用后生效。',
  confirm: '下载并安装',
  later: '稍后再说',
  restartNow: '立即重启',
  close: '关闭',
} as const

/** 检查结果。用可辨识联合，调用方 switch 即可穷尽处理。 */
export type UpdateCheckResult =
  | { kind: 'unsupported' }
  | { kind: 'up-to-date' }
  | { kind: 'available'; version: string; notes: string; date: string; update: Update }
  | { kind: 'error'; message: string }

/** 下载进度。总长度未知时为 null（服务器未返回 Content-Length）。 */
export type UpdateProgress = { downloaded: number; total: number | null }

/** 已完成读取的字节数；total 为 null 时无法换算百分比 */
export function progressRatio(progress: UpdateProgress): number | null {
  if (!progress.total || progress.total <= 0) return null
  const ratio = progress.downloaded / progress.total
  return ratio < 0 ? 0 : ratio > 1 ? 1 : ratio
}

/**
 * 检查是否有新版本。
 * 任何异常都归一化为 { kind: 'error' }，不向上抛。
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  if (!isDesktopRuntime()) return { kind: 'unsupported' }

  try {
    const update = await check()
    if (!update) return { kind: 'up-to-date' }
    return {
      kind: 'available',
      version: update.version,
      notes: update.body ?? '',
      date: update.date ?? '',
      update,
    }
  } catch (error) {
    return { kind: 'error', message: toMessage(error) }
  }
}

/**
 * 下载并安装更新。
 * ⚠️ Windows 上进入安装阶段后，安装器会结束当前进程，
 * 因此该 Promise 可能不会正常 resolve —— 不要在其后放置必须执行的逻辑。
 */
export async function downloadAndInstall(
  update: Update,
  onProgress?: (progress: UpdateProgress) => void
): Promise<void> {
  let downloaded = 0
  let total: number | null = null

  await update.downloadAndInstall((event) => {
    if (event.event === 'Started') {
      total = event.data.contentLength ?? null
      onProgress?.({ downloaded: 0, total })
      return
    }
    if (event.event === 'Progress') {
      downloaded += event.data.chunkLength
      onProgress?.({ downloaded, total })
    }
  })
}

/** 重启应用，使已安装的更新生效 */
export async function restartApp(): Promise<void> {
  await relaunch()
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
