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
//
// 【移动端（M4，2026-09-21）】clipboard.rs 的四个命令只在 Windows 分支实现
// （依赖 clipboard-win 是 Windows 专属），安卓上 invoke 一律返回 Err。
// 跨应用**文件**在移动端做不了（能力表 systemClipboardFiles = false），
// 但**纯文本**可以：WebView 自带 `navigator.clipboard` → writeSystemClipboardText。
// 计划原文写的是「装 tauri-plugin-clipboard-manager」，那要多引一个 Rust + Gradle
// 插件依赖（AGENTS.md 未经批准不引新库），零依赖的网页 API 覆盖同一场景，故改道。
// ============================================================================

import { invoke } from '@tauri-apps/api/core'

import { supportsCapability } from '@/core/system/platformCapabilities'
import { isDesktopRuntime } from '@/core/utils/runtime'

/** 本模块的中文提示（与 nativeDialogs 等同级模块一样自带文案常量表） */
export const CLIPBOARD_TEXT = {
  noWebClipboard: '当前环境不提供剪贴板写入接口，未能复制到系统剪贴板',
}

/** `navigator.clipboard` 里本模块用到的那一个方法（node 单测注入假件） */
export interface WebTextClipboard {
  writeText(text: string): Promise<void>
}

/** 把文件列表写入系统剪贴板；返回实际写入的文件数 */
export async function writeClipboardFiles(paths: string[]): Promise<number> {
  return invoke<number>('write_clipboard_files', { paths })
}

/** 把文本写入系统剪贴板（CF_UNICODETEXT） */
export async function writeClipboardText(text: string): Promise<void> {
  await invoke('write_clipboard_text', { text })
}

/**
 * 一次写入「文件列表 + 文本」两种格式（2026-09-18 回归修复）：
 * 资源管理器按 CF_HDROP 粘贴出文件，记事本 / 聊天框按 CF_UNICODETEXT
 * 粘贴出文字 —— 两次独立调用会互相清空剪贴板，必须合在同一命令里。
 * 返回实际写入的文件数；无有效文件时抛中文错误（调用方降级为只写文本）。
 */
export async function writeClipboardFilesAndText(paths: string[], text: string): Promise<number> {
  return invoke<number>('write_clipboard_files_and_text', { paths, text })
}

/**
 * 写纯文本到系统剪贴板 —— **按平台选通道**（M4）。
 *   · 桌面：原生命令（CF_UNICODETEXT，与文件写在同一张剪贴板上）；
 *   · 移动端 / 浏览器：WebView 的 `navigator.clipboard.writeText`。它要求文档聚焦
 *     且处于短暂的用户激活内（所以只能在「用户点了复制」这条调用链里同步发起，
 *     不能在 setTimeout 之后才写）；拿不到接口就如实抛错，不假装成功。
 *
 * `clipboard` 参数只为 node 单测注入而存在，生产调用一律用默认值。
 */
export async function writeSystemClipboardText(
  text: string,
  clipboard: WebTextClipboard | null = webTextClipboard(),
): Promise<void> {
  if (supportsCapability('systemClipboardFiles')) {
    await writeClipboardText(text)
    return
  }
  if (!clipboard) throw new Error(CLIPBOARD_TEXT.noWebClipboard)
  await clipboard.writeText(text)
}

/** 当前环境能拿到的网页剪贴板（node / 非安全上下文下为 null） */
function webTextClipboard(): WebTextClipboard | null {
  const clipboard = (globalThis.navigator as { clipboard?: WebTextClipboard } | undefined)?.clipboard
  return clipboard && typeof clipboard.writeText === 'function' ? clipboard : null
}

/**
 * 读取系统剪贴板里的文件路径列表；剪贴板上没有文件（截图 / 纯文本）时返回 []。
 * 非桌面环境（浏览器 dev / vitest）同样返回 []——那是「无文件可粘贴」的同义场景。
 * ⚠️ 移动端也要挡在这里：`isDesktopRuntime()` 在安卓返回 true（§8 第 10 条），
 * 只看它会白跑一次注定失败的 invoke。
 */
export async function readClipboardFiles(): Promise<string[]> {
  if (!isDesktopRuntime() || !supportsCapability('systemClipboardFiles')) return []
  try {
    const paths = await invoke<string[]>('read_clipboard_files')
    return Array.isArray(paths) ? paths : []
  } catch {
    // 打不开剪贴板等运行期错误按「没有文件」处理：Ctrl+V 还有原生截图粘贴链路兜底
    return []
  }
}
