// ============================================================================
// 模块说明（中文）
// spaces.json 的读写层。对应开发计划书 4.1：
//   位置：%APPDATA%\Mindscape\spaces.json
//   内容：我有哪些空间、各自的文件夹在哪
//
// 为什么用 fs 插件而不是 Rust 命令：
//   17.5 的命令清单里没有 spaces.json 的读写命令（read_layout/write_layout 针对的是
//   空间文件夹内的内容），而 17.10 明确声明了 fs 插件权限 ——
//   说明文档的意图就是「固定路径的应用元数据走 fs 插件，空间文件夹内的内容走 Rust 命令」。
//   空间文件夹是用户任选的任意路径，fs 插件无法预置 scope，所以那部分必须走 Rust。
//   （P1-2 起画布布局也落在家目录下 `$DATA/Mindscape/layouts/`，与 spaces.json 同样走 fs 插件，
//     见 `core/storage/appLayoutStore.ts` —— 空间文件夹里只剩用户自己的文件。）
//
// 路径拿法：`$DATA`（Tauri 的 BaseDirectory::Data）在 Windows 上就是 %APPDATA%，
//   与本文件在 capabilities 里声明的 scope（$DATA/Mindscape/**）严格对应。
//   前端用 `dataDir()` 拿同一个值，两边必须保持一致，否则会报 forbidden path。
//
// 原子写入：与 17.6 对 layout.json 的要求一致 —— 先写 .tmp 再 rename，防写坏。
// 损坏容错：解析失败 → 原文件备份为 spaces.json.bak → 返回空结构（不覆盖、不丢数据）。
//
// 实现任务：T1.1（阶段一）。
// ============================================================================

import { dataDir, join } from '@tauri-apps/api/path'
import { copyFile, exists, readTextFile } from '@tauri-apps/plugin-fs'

import { atomicWriteTextFile } from '@/core/storage/atomicWrite'
import { createEmptySpacesFile, parseSpacesFile } from '@/core/types'
import type { Space, SpacesFile } from '@/core/types'
import type { StorageProvider } from '@/core/storage/StorageProvider'
import { assertDesktopRuntime } from '@/core/utils/runtime'

/** 应用数据目录名（%APPDATA%\Mindscape） */
const SPACES_DIR_NAME = 'Mindscape'
/** 空间元数据文件名 */
const SPACES_FILE_NAME = 'spaces.json'

/** %APPDATA%\Mindscape */
export async function getSpacesDir(): Promise<string> {
  return join(await dataDir(), SPACES_DIR_NAME)
}

/** %APPDATA%\Mindscape\spaces.json */
async function getSpacesFilePath(): Promise<string> {
  return join(await getSpacesDir(), SPACES_FILE_NAME)
}

// ---------------------------------------------------------------------------
// 纯逻辑：文本 → 结构（可单元测试，不依赖 Tauri）
// ---------------------------------------------------------------------------

export interface InterpretedSpaces {
  file: SpacesFile
  /** 原文本损坏（解析失败）时为 true，调用方据此执行备份 */
  corrupted: boolean
  /** 损坏原因（中文，可直接展示） */
  error?: string
}

/**
 * 解释 spaces.json 的文本内容。
 * · 空文本 → 视为空列表（首次运行：文件存在但内容为空也不该崩）
 * · 解析失败 → 返回空结构并标记 corrupted，**绝不抛错打断启动**
 */
export function interpretSpacesText(text: string): InterpretedSpaces {
  if (text.trim() === '') {
    return { file: createEmptySpacesFile(), corrupted: false }
  }

  const parsed = parseSpacesFile(text)
  if (!parsed.ok) {
    return { file: createEmptySpacesFile(), corrupted: true, error: parsed.error }
  }
  return { file: parsed.data, corrupted: false }
}

/** 排序：最近打开的在最前（4.1 的 lastOpenedAt 字段就是为此） */
export function sortSpacesByLastOpened(spaces: Space[]): Space[] {
  return [...spaces].sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt))
}

/**
 * 列表展示排序（P1-5）：**收藏 → 最近打开**。
 * 收藏的空间永远排在未收藏前面，各自内部再按 lastOpenedAt 倒序；
 * 同组内时间相同的保持原有相对顺序（Array.prototype.sort 稳定）。
 * 旧数据经 zod parse 后 favorite 恒为 boolean，无需特判。
 */
export function sortSpacesForList(spaces: Space[]): Space[] {
  return [...spaces].sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1
    return b.lastOpenedAt.localeCompare(a.lastOpenedAt)
  })
}

/** 序列化：两空格缩进 + 末尾换行，便于用户直接打开查看/手改 */
export function serializeSpacesFile(file: SpacesFile): string {
  return `${JSON.stringify(file, null, 2)}\n`
}

// ---------------------------------------------------------------------------
// 读写网关
// ---------------------------------------------------------------------------

export interface SpacesFileGateway {
  load(): Promise<InterpretedSpaces>
  save(file: SpacesFile): Promise<void>
}

/**
 * 创建基于 Tauri fs 插件的网关。
 * @param provider 仅用于 createDir（Rust 命令，幂等创建 %APPDATA%\Mindscape）
 */
export function createSpacesFileGateway(provider: StorageProvider): SpacesFileGateway {
  return {
    async load(): Promise<InterpretedSpaces> {
      // 浏览器里没有 Rust 后端与 fs 插件，先给出可执行的中文提示
      assertDesktopRuntime()

      const filePath = await getSpacesFilePath()
      const fileExists = await exists(filePath)
      if (!fileExists) return { file: createEmptySpacesFile(), corrupted: false }

      const text = await readTextFile(filePath)
      const interpreted = interpretSpacesText(text)

      if (interpreted.corrupted) {
        // 与 layout.json 一致：先备份，再让上层用空结构继续（原文件不动）
        await copyFile(filePath, `${filePath}.bak`)
      }
      return interpreted
    },

    async save(file: SpacesFile): Promise<void> {
      assertDesktopRuntime()

      // 目录可能不存在（首次运行），先幂等创建
      await provider.createDir(await getSpacesDir())

      const filePath = await getSpacesFilePath()
      // 原子写（.tmp + rename）统一走 core/storage/atomicWrite.ts，与布局文件同一实现
      await atomicWriteTextFile(filePath, serializeSpacesFile(file))
    },
  }
}
