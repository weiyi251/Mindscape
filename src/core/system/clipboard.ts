// ============================================================================
// 模块说明（中文）
// 系统剪贴板文件互通的前端封装（2026-09-13 用户要求，Rust 端见
// src-tauri/src/commands/clipboard.rs，依赖 clipboard-win 已获用户批准）。
//
//   writeClipboardFiles(paths) —— 文件列表写入系统剪贴板（Windows CF_HDROP），
//                                 资源管理器 / 桌面等外部软件可直接 Ctrl+V
//   writeClipboardText(text)   —— 文本写入系统剪贴板（纯便签复制到外部用）
//   readClipboardFiles()       —— 读系统剪贴板里的文件路径列表；没有文件返回 []
//
// 铁律（17.5 同口径）：错误信息来自 Rust（中文），原样向上抛，由调用方展示。
//
// 【降级约定】readClipboardFiles 在非桌面环境（浏览器 dev / 测试）下 invoke 会
// 失败——这不是用户可见的错误，返回空列表即可（调用方对空列表本来就无动作）。
// 写入方向不降级：失败必须让用户知道「应用内已复制，但外部粘贴不可用」。
// ============================================================================

import { invoke } from '@tauri-apps/api/core'

import { isDesktopRuntime } from '@/core/utils/runtime'

/** 把文件列表写入系统剪贴板；返回实际写入的文件数 */
export async function writeClipboardFiles(paths: string[]): Promise<number> {
  return invoke<number>('write_clipboard_files', { paths })
}

/** 把文本写入系统剪贴板（CF_UNICODETEXT） */
export async function writeClipboardText(text: string): Promise<void> {
  await invoke('write_clipboard_text', { text })
}

/**
 * 读取系统剪贴板里的文件路径列表；剪贴板上没有文件（截图 / 纯文本）时返回 []。
 * 非桌面环境（浏览器 dev / vitest）同样返回 []——那是「无文件可粘贴」的同义场景。
 */
export async function readClipboardFiles(): Promise<string[]> {
  if (!isDesktopRuntime()) return []
  try {
    const paths = await invoke<string[]>('read_clipboard_files')
    return Array.isArray(paths) ? paths : []
  } catch {
    // 打不开剪贴板等运行期错误按「没有文件」处理：Ctrl+V 还有原生截图粘贴链路兜底
    return []
  }
}
