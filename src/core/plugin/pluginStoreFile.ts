// ============================================================================
// 模块说明（中文）
// plugins.json 的读写层。对应方案 §3「状态存储」：
//   位置：%APPDATA%\Mindscape\plugins.json
//   内容：每个插件的启用状态、来源、版本、安装目录、插件私有配置
//
// 为什么走 fs 插件而不是 Rust 命令：与 spaces.json 完全同理 ——
//   17.10 已声明 fs 插件权限，且路径固定在 $DATA 下（capabilities 的
//   `$DATA/Mindscape/**` scope 已覆盖），无需新增任何 Tauri 配置。
//
// 两条刻意的设计：
//   · **插件配置不随卸载删除**：卸载只删安装目录并把 dir 置空，config 原样保留。
//     插件作者的约定是「用户数据（卡片 meta）与插件配置都不该因卸载而蒸发」。
//   · **损坏容错与 spaces.json 一致**：解析失败 → 备份 .bak → 以空表启动，不覆盖原文件。
//
// 【2026-09-20 版本迁移管道】`version` 字段此前只是存了值、没有迁移函数。现补上：
//   · PLUGINS_FILE_VERSION —— plugins.json **自己的** schema 版本（与 layout 的
//     DATA_VERSION 解耦；历史上写入的默认值恰好同为 1，磁盘现存文件无需迁移）；
//   · PLUGIN_FILE_MIGRATIONS —— 升级步骤登记表：`{ from: N }` 表示「把版本 N 的数据
//     升到 N+1」，对 `version >= from` 的数据依次执行；schema 变更时在此追加步骤，
//     老文件在下次加载时自动补齐字段并随下次落盘盖上新版本号；
//   · version 高于 PLUGINS_FILE_VERSION（数据来自更新版本的应用）→ 拒绝加载并给出
//     中文原因，走既有的「标记 corrupted + 备份 .bak」路径，避免旧应用覆盖新数据。
//
// 原子写入复用 core/storage/atomicWrite.ts（.tmp + rename）。
// ============================================================================

import { dataDir, join } from '@tauri-apps/api/path'
import { copyFile, exists, readTextFile } from '@tauri-apps/plugin-fs'
import { z } from 'zod'

import { atomicWriteTextFile } from '@/core/storage/atomicWrite'
import type { ParseResult } from '@/core/types'
import type { StorageProvider } from '@/core/storage/StorageProvider'
import { assertDesktopRuntime } from '@/core/utils/runtime'

/** 应用数据目录名（%APPDATA%\Mindscape） */
const APP_DIR_NAME = 'Mindscape'
/** 外部插件安装目录名（%APPDATA%\Mindscape\plugins） */
export const PLUGINS_DIR_NAME = 'plugins'
/** 插件状态文件名 */
const PLUGINS_FILE_NAME = 'plugins.json'

/**
 * plugins.json 的 schema 版本（2026-09-20 起与 layout 的 DATA_VERSION 解耦）。
 * 历史文件写入的默认值同为 1（此前 default 引用 DATA_VERSION，当时值 = 1），
 * 因此现存文件全部命中「当前版本」，无需任何迁移。
 */
export const PLUGINS_FILE_VERSION = 1

/**
 * plugins.json 里单个插件的状态记录。
 *
 * 与 manifest.json 的分工：manifest.json 是**插件自己声明**的（版本、入口），
 * 本记录是**宿主侧**的状态（是否启用、装在哪、用户配置了什么）。
 * 两者以 id 关联；manifest 是权威来源，本记录只是镜像（便于禁用时不读盘）。
 */
export const zPluginStateEntrySchema = z.object({
  /** 插件 id（与 manifest.id 一致） */
  id: z.string(),
  /** 是否启用 */
  enabled: z.boolean().default(false),
  source: z.enum(['builtin', 'external']).default('external'),
  /** 最后一次成功加载时的版本号（用于「是否有更新」提示） */
  version: z.string().default('0.0.0'),
  /** 外部插件的安装目录绝对路径；卸载后为 null（内置恒为 null） */
  dir: z.string().nullable().default(null),
  /** 插件私有配置（卸载不删除） */
  config: z.record(z.unknown()).default({}),
})
export type PluginStateEntry = z.infer<typeof zPluginStateEntrySchema>

export const zPluginsFileSchema = z.object({
  version: z.number().default(PLUGINS_FILE_VERSION),
  plugins: z.array(zPluginStateEntrySchema).default([]),
})
export type PluginsFile = z.infer<typeof zPluginsFileSchema>

/** 空文件结构（首次运行） */
export function createEmptyPluginsFile(): PluginsFile {
  return zPluginsFileSchema.parse({})
}

// ---------------------------------------------------------------------------
// 纯逻辑：文本 ↔ 结构（可单元测试，不依赖 Tauri）
// ---------------------------------------------------------------------------

function describeIssue(issue: z.ZodIssue): string {
  const path = issue.path.length > 0 ? issue.path.join('.') : '(根)'
  return `${path}: ${issue.message}`
}

/**
 * 一条版本升级步骤：把 `version === from` 的数据升到 `from + 1`。
 * 步骤按 from 递增登记；加载时从「文件里的版本号」开始依次执行。
 * migrate 拿到原始 JSON 对象、返回**新的**对象（不得原地修改）。
 */
export interface PluginFileMigration {
  from: number
  migrate: (raw: Record<string, unknown>) => unknown
}

/**
 * plugins.json 的升级步骤登记表。当前 schema 为第 1 版、无历史版本需要迁移；
 * 未来变更 schema 时在此追加 `{ from: N, migrate }`（from = 旧版本号）。
 */
const PLUGIN_FILE_MIGRATIONS: readonly PluginFileMigration[] = []

export type MigratePluginsResult =
  | { ok: true; data: PluginsFile; /** 执行过迁移 / 盖过版本号时为 true（调用方可据此提前落盘） */ changed: boolean }
  | { ok: false; error: string }

/**
 * 把磁盘上的原始 JSON 迁移到当前 schema：
 * ① 读 version（缺失 / 非数字按 0 处理，即「从未版本化」的最老数据）；
 * ② 高于 PLUGINS_FILE_VERSION → 拒绝（错误信息进 corrupted 路径，见 interpretPluginsText）；
 * ③ 依次执行 from ≥ 当前版本的迁移步骤；
 * ④ zod 解析（补默认值）并**盖上当前版本号** —— 老文件随下次落盘自动升级。
 * @param migrations 可注入（测试用），缺省为生产登记表
 */
export function migratePluginsFile(
  raw: unknown,
  migrations: readonly PluginFileMigration[] = PLUGIN_FILE_MIGRATIONS,
): MigratePluginsResult {
  const version =
    typeof (raw as Record<string, unknown>)?.version === 'number' &&
    Number.isFinite((raw as Record<string, unknown>).version)
      ? ((raw as Record<string, unknown>).version as number)
      : 0

  if (version > PLUGINS_FILE_VERSION) {
    return {
      ok: false,
      error: `数据版本（v${version}）高于当前应用支持的版本（v${PLUGINS_FILE_VERSION}）。文件可能来自更新版本的 Mindscape，已停止加载以避免旧版本覆盖新数据。`,
    }
  }

  let data = raw
  let changed = version !== PLUGINS_FILE_VERSION
  for (const step of migrations) {
    if (step.from >= version) {
      data = step.migrate(data as Record<string, unknown>)
      changed = true
    }
  }

  const result = zPluginsFileSchema.safeParse(data)
  if (!result.success) {
    return { ok: false, error: `数据校验失败：${result.error.issues.map(describeIssue).join('；')}` }
  }
  const stamped =
    result.data.version === PLUGINS_FILE_VERSION
      ? result.data
      : { ...result.data, version: PLUGINS_FILE_VERSION }
  return { ok: true, data: stamped, changed }
}

/** 校验 plugins.json 的文本内容（先迁移，再按当前 schema 解释） */
export function parsePluginsFile(text: string): ParseResult<PluginsFile> {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { ok: false, error: `JSON 解析失败：${(error as Error).message}` }
  }

  const migrated = migratePluginsFile(raw)
  if (!migrated.ok) return { ok: false, error: migrated.error }
  return { ok: true, data: migrated.data }
}

export interface InterpretedPlugins {
  file: PluginsFile
  /** 原文本损坏（解析失败）时为 true，调用方据此执行备份 */
  corrupted: boolean
  /** 损坏原因（中文，可直接展示） */
  error?: string
}

/**
 * 解释 plugins.json 的文本内容。
 * · 空文本 → 视为空列表（文件存在但内容为空不该崩）
 * · 解析失败 → 返回空结构并标记 corrupted，**绝不抛错打断启动**
 */
export function interpretPluginsText(text: string): InterpretedPlugins {
  if (text.trim() === '') {
    return { file: createEmptyPluginsFile(), corrupted: false }
  }

  const parsed = parsePluginsFile(text)
  if (!parsed.ok) {
    return { file: createEmptyPluginsFile(), corrupted: true, error: parsed.error }
  }
  return { file: parsed.data, corrupted: false }
}

/** 序列化：两空格缩进 + 末尾换行（便于用户直接打开查看 / 手改） */
export function serializePluginsFile(file: PluginsFile): string {
  return `${JSON.stringify(file, null, 2)}\n`
}

// ---------------------------------------------------------------------------
// 路径
// ---------------------------------------------------------------------------

/** %APPDATA%\Mindscape */
export async function getPluginDataDir(): Promise<string> {
  return join(await dataDir(), APP_DIR_NAME)
}

/** %APPDATA%\Mindscape\plugins（外部插件安装根目录） */
export async function getPluginsRootDir(): Promise<string> {
  return join(await getPluginDataDir(), PLUGINS_DIR_NAME)
}

/** %APPDATA%\Mindscape\plugins.json */
export async function getPluginsFilePath(): Promise<string> {
  return join(await getPluginDataDir(), PLUGINS_FILE_NAME)
}

// ---------------------------------------------------------------------------
// 读写网关
// ---------------------------------------------------------------------------

export interface PluginsFileGateway {
  load: () => Promise<InterpretedPlugins>
  save: (file: PluginsFile) => Promise<void>
}

/**
 * 创建基于 Tauri fs 插件的网关。
 * @param provider 仅用于 createDir（Rust 命令，幂等创建 %APPDATA%\Mindscape）
 */
export function createPluginsFileGateway(provider: StorageProvider): PluginsFileGateway {
  return {
    async load(): Promise<InterpretedPlugins> {
      assertDesktopRuntime()

      const filePath = await getPluginsFilePath()
      if (!(await exists(filePath))) return { file: createEmptyPluginsFile(), corrupted: false }

      const text = await readTextFile(filePath)
      const interpreted = interpretPluginsText(text)

      if (interpreted.corrupted) {
        // 与 spaces.json 一致：先备份，再让上层用空结构继续（原文件不动）
        await copyFile(filePath, `${filePath}.bak`)
      }
      return interpreted
    },

    async save(file: PluginsFile): Promise<void> {
      assertDesktopRuntime()

      // 目录可能不存在（首次运行），先幂等创建
      await provider.createDir(await getPluginDataDir())
      await atomicWriteTextFile(await getPluginsFilePath(), serializePluginsFile(file))
    },
  }
}
