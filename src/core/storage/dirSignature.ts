// ============================================================================
// 模块说明（中文）
// 空间文件夹内容签名的前端封装（A1：外部变动感知，2026-09-20 用户计划第 3 步）。
// Rust 端见 `src-tauri/src/commands/dir_signature.rs`。
//
// 使用时机（用户裁决：不做常驻 watch、不做轮询）：
//   · 窗口重新获得焦点时比对一次；
//   · 用户点「重新扫描」时（先比对，由用户决定是否重扫）；
//   · 每次布局落盘成功后**刷新基线** —— 应用自己的操作（拖入 / 移除 / 重命名 /
//     建分区）同样会改变文件夹内容，不刷新基线就会在下次聚焦时误报「外部变动」。
//
// 铁律（17.5 同口径）：错误信息来自 Rust（中文），原样向上抛，由调用方展示。
//
// 【降级约定】非桌面环境（浏览器 dev / vitest）返回 null —— 那不是错误，
// 只是「本环境没有这项能力」（与 readClipboardFiles 同一约定）。
// ============================================================================

import { invoke } from '@tauri-apps/api/core'

import { isDesktopRuntime } from '@/core/utils/runtime'

/** 目录内容签名（字段与 Rust 侧 DirSignature 一致） */
export interface DirSignature {
  /** 内容签名（FNV-1a 64 位十六进制） */
  hash: string
  /** 参与签名的文件数（根目录 + 一层子目录） */
  files: number
  /** 参与签名的一层子目录数 */
  dirs: number
}

/** 检测到的外部变动（供 UI 展示的差异摘要） */
export interface ExternalChange {
  /** 上次已知的文件数 */
  prevFiles: number
  /** 当前文件数 */
  files: number
}

/**
 * 读取目录签名；非桌面环境返回 null。
 * 桌面环境下路径不可访问等真实错误会抛出（中文），由调用方决定是否提示。
 */
export async function readDirSignature(path: string): Promise<DirSignature | null> {
  if (!isDesktopRuntime()) return null
  return invoke<DirSignature>('dir_signature', { path })
}

/**
 * 两个签名是否一致。
 * 任一为 null（次环境不支持 / 还没读到基线）→ 视为「无需报告」，避免误报。
 */
export function sameSignature(a: DirSignature | null, b: DirSignature | null): boolean {
  if (!a || !b) return true
  return a.hash === b.hash && a.files === b.files && a.dirs === b.dirs
}

/**
 * 两次签名之间的「外部变动」摘要；无变动或无法比较时返回 null。
 *
 * 变动的两种形态都能表达：
 *   · 文件数变了（增 / 删）→ prevFiles ≠ files，UI 可显示「12 → 15」；
 *   · 文件数没变但内容变了（改名 / 覆盖）→ 数字相同、hash 不同，UI 用另一种措辞。
 */
export function externalChangeOf(
  baseline: DirSignature | null,
  current: DirSignature | null,
): ExternalChange | null {
  if (!baseline || !current) return null
  if (sameSignature(baseline, current)) return null
  return { prevFiles: baseline.files, files: current.files }
}
