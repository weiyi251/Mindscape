// ============================================================================
// 模块说明（中文）
// 布局文件的落盘位置与读写（P1-2，2026-09-12 用户裁决）。
//
//   旧：`<空间文件夹>\.mindscape\layout.json` —— 会在用户的空间文件夹里留下隐藏目录
//   新：`%APPDATA%\Mindscape\layouts\<空间 id>.json` —— 空间文件夹回到「只有用户自己的文件」
//
// 【为什么用空间 id 而不是文件夹路径的哈希】
//   id 本来就在 spaces.json 里（由 core/utils/id.ts 生成），不需要另外计算；
//   文件名可读，排查问题时一眼能对上空间；文件夹改名/移动后布局仍然找得到，
//   而「路径哈希」方案一移动就跟丢（用户裁决时选择了 id）。
//
// 【为什么走 fs 插件而不是 Rust 命令】
//   `$DATA/Mindscape/**`（即 %APPDATA%\Mindscape）已在 capabilities 的 fs:scope 白名单里
//   —— spaces.json 走的就是这条路，布局文件只是换个文件名，无需新增 Rust 命令。
//   空间文件夹是用户任选的任意路径，fs 插件无法预置 scope，那部分仍然只能走 Rust 命令。
//
// 【兼容迁移】
//   软件目录里没有布局、但空间文件夹里还留着旧的 `.mindscape\layout.json` 时，
//   读入并写入软件目录。**旧文件一律不删**（铁律③「不静默删除」），只给一句提示。
//
// 实现任务：P1-2。
// ============================================================================

import { exists, readTextFile, rename, writeTextFile } from '@tauri-apps/plugin-fs'

import { parseLayout } from '@/core/types'
import type { StorageProvider } from '@/core/storage/StorageProvider'
import { localStorageProvider } from '@/core/storage/LocalFolderProvider'
import { getSpacesDir } from '@/core/storage/spacesFile'
import { joinPath } from '@/core/utils/paths'
import { assertDesktopRuntime } from '@/core/utils/runtime'

/** 软件目录内的布局子目录名 */
export const LAYOUTS_DIR_NAME = 'layouts'
/** 「导出布局」在用户文件夹里生成的文件名（P1-2 用户裁决） */
export const EXPORTED_LAYOUT_FILE = 'mindscape-layout.json'
/** 旧布局目录名（只用于迁移读取，新流程不再写入） */
export const LEGACY_LAYOUT_DIR = '.mindscape'
/** 旧布局文件名 */
export const LEGACY_LAYOUT_FILE = 'layout.json'

/**
 * 空间 id 能否安全地当文件名用。
 * id 由 createSpace 生成（只含字母数字与下划线），但 spaces.json 是明文、用户可以手改，
 * 所以这里再校验一次，挡住 `..\` 这类路径逃逸。
 */
export function isSafeLayoutKey(spaceId: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(spaceId)
}

/** 空间 id → 布局文件名。非法 id 直接抛错（调用方据此给出中文提示或退回空布局） */
export function layoutFileName(spaceId: string): string {
  if (!isSafeLayoutKey(spaceId)) {
    throw new Error(`空间 id 含非法字符，不能作为布局文件名：${spaceId}`)
  }
  return `${spaceId}.json`
}

/** %APPDATA%\Mindscape\layouts */
export async function getLayoutsDir(): Promise<string> {
  return joinPath(await getSpacesDir(), LAYOUTS_DIR_NAME)
}

/** 软件目录内布局文件的读写出口 */
export interface AppLayoutStore {
  /** 读布局文本；文件不存在（或 id 非法）返回 null */
  read(spaceId: string): Promise<string | null>
  /** 原子写入布局文本（同目录先写 .tmp 再 rename，与 spaces.json 一致） */
  write(spaceId: string, json: string): Promise<void>
  /** 空间文件夹里是否还留着旧布局 `.mindscape\layout.json`（迁移判定用，不读内容） */
  legacyLayoutExists(spacePath: string): Promise<boolean>
}

export function createAppLayoutStore(provider: StorageProvider): AppLayoutStore {
  return {
    async read(spaceId: string): Promise<string | null> {
      assertDesktopRuntime()
      // id 非法时不报错，直接当作「没有布局」——手改过 spaces.json 也不该打不开空间
      if (!isSafeLayoutKey(spaceId)) return null

      const filePath = joinPath(await getLayoutsDir(), layoutFileName(spaceId))
      if (!(await exists(filePath))) return null
      return readTextFile(filePath)
    },

    async write(spaceId: string, json: string): Promise<void> {
      assertDesktopRuntime()

      const dir = await getLayoutsDir()
      // 目录可能不存在（首次在本机保存）——createDir 是幂等的 create_dir_all
      await provider.createDir(dir)

      const filePath = joinPath(dir, layoutFileName(spaceId))
      const tmpPath = `${filePath}.tmp`
      await writeTextFile(tmpPath, json)
      await rename(tmpPath, filePath)
    },

    async legacyLayoutExists(spacePath: string): Promise<boolean> {
      assertDesktopRuntime()
      try {
        // 用 list_dir 判存在，而不是 read_layout：Rust 的 read_layout 在文件缺失时
        // 返回的是「空布局」而不是错误，前端无法据此区分「没有旧布局」与「旧布局是空的」。
        const entries = await provider.listDir(joinPath(spacePath, LEGACY_LAYOUT_DIR))
        return entries.some((entry) => !entry.isDir && entry.name === LEGACY_LAYOUT_FILE)
      } catch {
        // 空间文件夹里没有 .mindscape（新建空间）或目录读不了 → 都当作没有旧布局
        return false
      }
    },
  }
}

/** 目标文件夹里是否有导出布局文件（导入前校验；文件夹读不了时按「没有」处理） */
export async function exportedLayoutExists(provider: StorageProvider, dir: string): Promise<boolean> {
  assertDesktopRuntime()
  try {
    const entries = await provider.listDir(dir)
    return entries.some((entry) => !entry.isDir && entry.name === EXPORTED_LAYOUT_FILE)
  } catch {
    return false
  }
}

/**
 * 把导入文件夹里的导出布局收进软件目录，落实到指定空间 id 下。
 *
 * 做法：copy_file 进软件目录 → 读回校验 → 改名成 `<空间 id>.json`。
 * 用 copy_file 而不是「直接读原文件」：存储层没有「读任意路径文件」的命令，
 * 而 copy_file 的目标目录在 fs 插件 scope 内，之后就能用 fs 插件读与改名。
 * 内容不是合法布局时删掉这次拷贝（不让软件目录里留垃圾），返回 'invalid'。
 */
export async function adoptExportedLayout(
  provider: StorageProvider,
  spaceId: string,
  sourceDir: string,
): Promise<'ok' | 'invalid'> {
  assertDesktopRuntime()

  const layoutsDir = await getLayoutsDir()
  await provider.createDir(layoutsDir)

  // copy_file 遇到同名文件会自动加序号，所以以**返回值**为真实落地路径
  const copiedTo = await provider.copyFile(joinPath(sourceDir, EXPORTED_LAYOUT_FILE), layoutsDir)
  const raw = await readTextFile(copiedTo)

  if (!parseLayout(raw).ok) {
    await provider.deleteFile(copiedTo)
    return 'invalid'
  }

  await rename(copiedTo, joinPath(layoutsDir, layoutFileName(spaceId)))
  return 'ok'
}

/** 从源文件夹移除导出布局文件（内容已在软件目录；调用方必须先征得用户同意） */
export async function removeExportedLayout(provider: StorageProvider, sourceDir: string): Promise<void> {
  assertDesktopRuntime()
  await provider.deleteFile(joinPath(sourceDir, EXPORTED_LAYOUT_FILE))
}

/** 默认实例：与 localStorageProvider 同一风格，上层直接 import；测试时注入假实现 */
export const localLayoutStore: AppLayoutStore = createAppLayoutStore(localStorageProvider)
