// ============================================================================
// 模块说明（中文）
// 插件宿主：把「插件」从一堆文件变成可用能力的**编排层**。
// 对应 docs/插件功能实施方案.md §2.3（六态状态机）与 §8 阶段 3/6/7。
//
// 它负责五件事，别的模块都不负责：
//   1. 发现   —— 内置插件（编译期描述符）+ 外部插件（扫描 %APPDATA%\Mindscape\plugins）
//   2. 校验   —— 外部插件读 manifest.json 过 zod（manifest.ts）
//   3. 激活   —— 动态 import（或直接调用内置 activate）→ 注入 PluginHostApi
//   4. 停用   —— disposePlugin 回收注册，再让插件 deactivate
//   5. 卸载   —— 停用 + 递归删除安装目录，**保留插件配置**
//
// 与 pluginCenter 的分工：本文件不做注册表的增删，只调 createPluginApi /
// disposePlugin；注册表始终是唯一真相。
//
// 可测性：磁盘扫描、目录删除、模块导入全部可在 PluginHostOptions 里注入假实现，
// 因此本模块能在 node 环境完整单测（不读真实磁盘、不起 Tauri）。
//
// ⚠️ 插件抛错只影响自己：激活失败会回收它半途注册的内容并把状态置为 error，
//    其他插件与宿主不受影响。
// ============================================================================

import { exists, readDir, readTextFile } from '@tauri-apps/plugin-fs'

import { disposePlugin, listPluginContributions } from '@/core/registry/pluginCenter'
import { localStorageProvider } from '@/core/storage/LocalFolderProvider'
import { toErrorMessage } from '@/core/utils/errorMessage'
import { basenameOf, joinPath } from '@/core/utils/paths'
import { assertDesktopRuntime } from '@/core/utils/runtime'
import { canEnable, canUninstall } from './lifecycle'
import type { PluginManifest } from './manifest'
import { parseManifest } from './manifest'
import { buildPluginApi } from './pluginApi'
import { loadPluginModule } from './pluginLoader'
import type { PluginLoaderOptions, PluginModule } from './pluginLoader'
import { contributionsLine, pluginStateLabel } from './pluginText'
import { createEmptyPluginsFile, createPluginsFileGateway, getPluginsRootDir } from './pluginStoreFile'
import type { PluginsFileGateway, PluginStateEntry } from './pluginStoreFile'
import type {
  BuiltinPluginDescriptor,
  PluginContributions,
  PluginHostApi,
  PluginRecord,
  PluginSource,
  PluginState,
} from './types'

/** 外部插件目录里清单的文件名（固定，方案 §2.1） */
export const MANIFEST_FILE = 'manifest.json'

const EMPTY_CONTRIBUTIONS: PluginContributions = {
  cardTypes: 0,
  menuItems: 0,
  canvasMenuItems: 0,
  hooks: 0,
}

/** 扫描到的一个外部插件候选（尚未校验） */
export interface ExternalPluginCandidate {
  /** 插件安装目录（绝对路径） */
  installDir: string
  /** manifest.json 的原始文本 */
  manifestText: string
}

export interface PluginHostOptions {
  /** 内置插件（编译期常量，来自 src/plugins/builtinPlugins.ts） */
  builtins?: BuiltinPluginDescriptor[]
  /** plugins.json 网关；默认真实 Tauri fs */
  gateway?: PluginsFileGateway
  /** 动态加载选项（入口 URL 解析 + 导入器），测试注入假实现 */
  loader?: PluginLoaderOptions
  /** 扫描外部插件；默认扫描 %APPDATA%\Mindscape\plugins */
  scanExternal?: () => Promise<ExternalPluginCandidate[]>
  /** 读取某个插件目录下的清单文本（reload 用）；默认读真实磁盘 */
  readManifest?: (installDir: string) => Promise<string | null>
  /** 递归删除插件目录；默认走 Rust delete_dir */
  removeDir?: (dir: string) => Promise<void>
}

/** 宿主内部的一个插件运行时 */
interface Runtime {
  record: PluginRecord
  /** 内置插件的编译期描述符（有它就不走动态加载） */
  builtin?: BuiltinPluginDescriptor
  /** 外部插件的清单（激活时要用它拼入口路径） */
  manifest?: PluginManifest
  /** 已加载的模块（停用时调 deactivate） */
  module?: PluginModule
}

export interface PluginHost {
  /** 启动时调用一次：读状态 → 登记内置 → 扫描外部 → 激活上次启用的 */
  init: () => Promise<void>
  /** 当前全部插件（内置在前，同组按名称） */
  list: () => PluginRecord[]
  /** 启动期/刷新期的中文错误提示（plugins.json 损坏、扫描失败）；正常为 null */
  lastError: () => string | null
  enable: (id: string) => Promise<void>
  disable: (id: string) => Promise<void>
  uninstall: (id: string) => Promise<void>
  /** 重新读取磁盘上的清单并重载（外部插件的「更新」） */
  reload: (id: string) => Promise<void>
  /** 重新扫描外部插件目录 */
  refresh: () => Promise<void>
  /** 订阅变更（设置页 UI 用它触发重渲染） */
  subscribe: (listener: () => void) => () => void
}

// ---------------------------------------------------------------------------
// 真实实现（默认）
// ---------------------------------------------------------------------------

/** 读某个插件目录下的 manifest.json 文本；文件不存在返回 null */
async function readManifestText(installDir: string): Promise<string | null> {
  const manifestPath = joinPath(installDir, MANIFEST_FILE)
  if (!(await exists(manifestPath))) return null
  return readTextFile(manifestPath)
}

/** 默认扫描：%APPDATA%\Mindscape\plugins\<id>\manifest.json */
async function defaultScanExternal(): Promise<ExternalPluginCandidate[]> {
  assertDesktopRuntime()

  const root = await getPluginsRootDir()
  if (!(await exists(root))) return []

  const dirEntries = await readDir(root)
  const candidates: ExternalPluginCandidate[] = []

  for (const dirEntry of dirEntries) {
    if (dirEntry.isDirectory === false) continue
    const installDir = joinPath(root, dirEntry.name)
    try {
      const manifestText = await readManifestText(installDir)
      // 没有清单的目录直接跳过（可能只是用户随手放的文件夹）
      if (manifestText !== null) candidates.push({ installDir, manifestText })
    } catch (error) {
      // 单个目录读失败不影响其他插件（与 list_dir 的容错策略一致）
      console.error(`[pluginHost] 读取插件目录失败：${installDir}`, error)
    }
  }
  return candidates
}

/** 默认删除：走 Rust delete_dir（递归删目录，能力清单里唯一一个） */
async function defaultRemoveDir(dir: string): Promise<void> {
  await localStorageProvider.deleteDir(dir)
}

/** 内置描述符 → 清单形状（激活时统一按 manifest 处理） */
function descriptorToManifest(descriptor: BuiltinPluginDescriptor): PluginManifest {
  return {
    id: descriptor.manifest.id,
    name: descriptor.manifest.name,
    version: descriptor.manifest.version,
    description: descriptor.manifest.description,
    author: descriptor.manifest.author,
    main: descriptor.manifest.main,
  }
}

// ---------------------------------------------------------------------------
// 工厂
// ---------------------------------------------------------------------------

export function createPluginHost(options: PluginHostOptions = {}): PluginHost {
  const builtins = options.builtins ?? []
  const gateway = options.gateway ?? createPluginsFileGateway(localStorageProvider)
  const loaderOptions = options.loader
  const scanExternal = options.scanExternal ?? defaultScanExternal
  const readManifest = options.readManifest ?? readManifestText
  const removeDir = options.removeDir ?? defaultRemoveDir

  const runtimes = new Map<string, Runtime>()
  const listeners = new Set<() => void>()
  /** plugins.json 的内存镜像（唯一真相，任何改动后整体落盘） */
  let entries: PluginStateEntry[] = []
  let loadError: string | null = null

  function notify(): void {
    for (const listener of listeners) listener()
  }

  /** 取（必要时创建）某个插件的状态记录 */
  function entryOf(id: string): PluginStateEntry {
    let entry = entries.find((item) => item.id === id)
    if (!entry) {
      entry = { id, enabled: false, source: 'external', version: '0.0.0', dir: null, config: {} }
      entries.push(entry)
    }
    return entry
  }

  async function persist(): Promise<void> {
    try {
      const file = createEmptyPluginsFile()
      file.plugins = entries
      await gateway.save(file)
    } catch (error) {
      // 落盘失败不阻断内存态（UI 仍反映本次操作），下次操作会再试
      console.error('[pluginHost] 保存插件状态失败：', error)
    }
  }

  /** 非激活状态：曾经加载成功过 → 已停用；否则 → 已安装 */
  function stateFor(entry: PluginStateEntry): PluginState {
    if (entry.enabled) return 'installed'
    return entry.version !== '0.0.0' ? 'inactive' : 'installed'
  }

  function buildRecord(params: {
    id: string
    source: PluginSource
    name: string
    version: string
    description?: string
    author?: string
    installDir: string | null
    main?: string
    state: PluginState
    detail: string
  }): PluginRecord {
    return {
      id: params.id,
      name: params.name,
      version: params.version,
      description: params.description ?? '',
      author: params.author ?? '',
      source: params.source,
      installDir: params.installDir,
      main: params.main ?? 'index.js',
      state: params.state,
      detail: params.detail,
      contributions: listPluginContributions(params.id),
      config: { ...entryOf(params.id).config },
    }
  }

  function markActive(runtime: Runtime): void {
    const contributions = listPluginContributions(runtime.record.id)
    runtime.record = {
      ...runtime.record,
      state: 'active',
      contributions,
      detail: contributionsLine(contributions) || '已启用（未注册任何内容）',
    }
  }

  function markInactive(runtime: Runtime): void {
    runtime.record = {
      ...runtime.record,
      state: 'inactive',
      contributions: { ...EMPTY_CONTRIBUTIONS },
      detail: '',
    }
  }

  /** 登记内置插件（不激活） */
  function registerBuiltins(): void {
    for (const descriptor of builtins) {
      const id = descriptor.manifest.id

      // 首次登记（plugins.json 里还没有这条记录）时把内置插件**默认设为启用**：
      // 它是随应用一起发布的第一方能力（如色卡），要求用户先去设置页点一次
      // 「启用」才能用，属多余的摩擦。已登记过的记录一律尊重用户的选择
      // （enabled 保持原值），所以「用户在设置页停用它」不会被启动流程改回去。
      // 外部插件不受影响 —— 用户从别处拿来的插件应先看清再启用。
      const isFirstSeen = !entries.some((item) => item.id === id)

      const entry = entryOf(id)
      entry.source = 'builtin'
      entry.dir = null
      if (isFirstSeen) entry.enabled = true

      const existing = runtimes.get(id)
      if (existing && existing.record.state === 'active') {
        existing.builtin = descriptor
        continue
      }

      runtimes.set(id, {
        builtin: descriptor,
        record: buildRecord({
          id,
          source: 'builtin',
          name: descriptor.manifest.name,
          version: descriptor.manifest.version,
          description: descriptor.manifest.description,
          author: descriptor.manifest.author,
          installDir: null,
          main: descriptor.manifest.main,
          state: stateFor(entry),
          detail: '',
        }),
      })
    }
  }

  /** 扫描外部插件目录并与现有运行时合并 */
  async function scanAndMergeExternal(): Promise<void> {
    const candidates = await scanExternal()
    const seen = new Set<string>()

    for (const candidate of candidates) {
      const parsed = parseManifest(candidate.manifestText)
      // 清单不合格时用目录名当 id，好让用户能看见并卸载这个坏插件
      const id = parsed.ok ? parsed.data.id : basenameOf(candidate.installDir)
      if (!id) continue
      seen.add(id)

      const entry = entryOf(id)
      entry.source = 'external'
      entry.dir = candidate.installDir

      const existing = runtimes.get(id)
      // 正在运行的插件：只刷新元信息，不动它的注册
      if (existing && existing.record.state === 'active') {
        if (parsed.ok) {
          existing.manifest = parsed.data
          existing.record = {
            ...existing.record,
            name: parsed.data.name,
            version: parsed.data.version,
            description: parsed.data.description,
            author: parsed.data.author,
            installDir: candidate.installDir,
            main: parsed.data.main,
          }
        }
        continue
      }

      if (!parsed.ok) {
        runtimes.set(id, {
          record: buildRecord({
            id,
            source: 'external',
            name: `（清单无效）${basenameOf(candidate.installDir)}`,
            version: entry.version,
            installDir: candidate.installDir,
            state: 'invalid',
            detail: parsed.error,
          }),
        })
        continue
      }

      const manifest = parsed.data
      runtimes.set(id, {
        manifest,
        record: buildRecord({
          id,
          source: 'external',
          name: manifest.name,
          version: manifest.version,
          description: manifest.description,
          author: manifest.author,
          installDir: candidate.installDir,
          main: manifest.main,
          state: stateFor(entry),
          detail: '',
        }),
      })
    }

    // 安装目录已消失的外部插件：回收注册并移出列表（配置留在 plugins.json 里）
    for (const [id, runtime] of [...runtimes]) {
      if (runtime.record.source !== 'external' || seen.has(id)) continue
      disposePlugin(id)
      runtimes.delete(id)
    }
  }

  async function init(): Promise<void> {
    loadError = null

    try {
      const interpreted = await gateway.load()
      entries = interpreted.file.plugins
      if (interpreted.corrupted) {
        loadError = `${interpreted.error ?? 'plugins.json 解析失败'}；原文件已备份为 plugins.json.bak，本次以空列表启动。`
      }
    } catch (error) {
      loadError = toErrorMessage(error)
      entries = []
    }

    runtimes.clear()
    registerBuiltins()

    try {
      await scanAndMergeExternal()
    } catch (error) {
      loadError = loadError ?? toErrorMessage(error)
    }

    // 激活上次处于启用状态的插件（顺序即列表顺序，保证行为可预期）
    for (const runtime of [...runtimes.values()]) {
      if (entryOf(runtime.record.id).enabled) {
        await enable(runtime.record.id)
      }
    }
    notify()
  }

  async function enable(id: string): Promise<void> {
    const runtime = runtimes.get(id)
    if (!runtime) throw new Error(`找不到插件「${id}」`)
    if (runtime.record.state === 'active') return

    if (!canEnable(runtime.record)) {
      throw new Error(
        `插件「${runtime.record.name}」当前状态为「${pluginStateLabel(runtime.record.state)}」，无法启用`,
      )
    }

    const entry = entryOf(id)

    try {
      const manifest = runtime.builtin
        ? descriptorToManifest(runtime.builtin)
        : runtime.manifest
      if (!manifest) throw new Error('缺少插件清单，无法启用')

      const module: PluginModule = runtime.builtin
        ? { activate: runtime.builtin.activate, deactivate: runtime.builtin.deactivate }
        : await loadPluginModule(runtime.record.installDir as string, manifest, loaderOptions)

      const api: PluginHostApi = buildPluginApi({
        id,
        name: runtime.record.name,
        getConfig: () => entryOf(id).config,
        setConfig: async (patch) => {
          Object.assign(entryOf(id).config, patch)
          runtime.record = { ...runtime.record, config: { ...entryOf(id).config } }
          await persist()
          notify()
        },
      })

      await module.activate(api)

      runtime.module = module
      markActive(runtime)
      entry.enabled = true
      entry.version = runtime.record.version
      await persist()
    } catch (error) {
      // 失败时把半途注册的内容全部回收 —— 插件之间互不连坐
      disposePlugin(id)
      runtime.module = undefined
      runtime.record = {
        ...runtime.record,
        state: 'error',
        detail: toErrorMessage(error),
        contributions: { ...EMPTY_CONTRIBUTIONS },
      }
      entry.enabled = false
      await persist()
    }

    notify()
  }

  async function disable(id: string): Promise<void> {
    const runtime = runtimes.get(id)
    if (!runtime) throw new Error(`找不到插件「${id}」`)
    if (runtime.record.state !== 'active') return

    // 先回收注册（注册的逆操作），再让插件清理自己的外部资源
    disposePlugin(id)

    if (runtime.module?.deactivate) {
      try {
        await runtime.module.deactivate()
      } catch (error) {
        console.error(`[pluginHost] 插件「${id}」的 deactivate 抛错：`, error)
      }
    }

    runtime.module = undefined
    markInactive(runtime)
    entryOf(id).enabled = false
    await persist()
    notify()
  }

  async function uninstall(id: string): Promise<void> {
    const runtime = runtimes.get(id)
    if (!runtime) throw new Error(`找不到插件「${id}」`)
    if (!canUninstall(runtime.record)) {
      throw new Error('内置插件随应用一起发布，不能卸载，只能停用')
    }

    await disable(id)

    const dir = runtime.record.installDir
    if (dir) await removeDir(dir)

    // 只删安装目录；**保留配置**（方案 §3：插件数据不随卸载删除）
    const entry = entryOf(id)
    entry.enabled = false
    entry.dir = null
    runtimes.delete(id)

    await persist()
    notify()
  }

  async function reload(id: string): Promise<void> {
    const runtime = runtimes.get(id)
    if (!runtime) throw new Error(`找不到插件「${id}」`)
    if (runtime.record.source !== 'external') {
      throw new Error('内置插件随应用更新，无需重新加载')
    }

    const wasActive = runtime.record.state === 'active'
    if (wasActive) await disable(id)

    const installDir = runtime.record.installDir
    let manifest: PluginManifest | undefined
    let reason: string | null = null

    if (!installDir) {
      reason = '插件安装目录已不存在'
    } else {
      try {
        const text = await readManifest(installDir)
        if (text === null) {
          reason = `安装目录里没有 ${MANIFEST_FILE}`
        } else {
          const parsed = parseManifest(text)
          if (parsed.ok) manifest = parsed.data
          else reason = parsed.error
        }
      } catch (error) {
        reason = toErrorMessage(error)
      }
    }

    if (!manifest) {
      runtime.record = {
        ...runtime.record,
        state: 'invalid',
        detail: reason ?? '清单不可用',
        contributions: { ...EMPTY_CONTRIBUTIONS },
      }
      runtimes.set(id, runtime)
      await persist()
      notify()
      return
    }

    // 重载后：原本在跑 → 已停用；原本没跑 → 仍是「已安装」。
    // entry.version 只在**成功激活**时写入（见 enable），这里不改，
    // 否则一个从未启用过的插件会被误标成「已停用」。
    const nextState: PluginState = wasActive ? 'inactive' : 'installed'
    runtimes.set(id, {
      manifest,
      record: buildRecord({
        id,
        source: 'external',
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        author: manifest.author,
        installDir,
        main: manifest.main,
        state: nextState,
        detail: '',
      }),
    })

    if (wasActive) await enable(id)
    await persist()
    notify()
  }

  async function refresh(): Promise<void> {
    loadError = null
    try {
      await scanAndMergeExternal()
    } catch (error) {
      loadError = toErrorMessage(error)
    }
    notify()
  }

  function list(): PluginRecord[] {
    return [...runtimes.values()]
      .map((runtime) => runtime.record)
      .sort((a, b) => {
        if (a.source !== b.source) return a.source === 'builtin' ? -1 : 1
        return a.name.localeCompare(b.name, 'zh-Hans-CN')
      })
  }

  return {
    init,
    list,
    lastError: () => loadError,
    enable,
    disable,
    uninstall,
    reload,
    refresh,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

// ---------------------------------------------------------------------------
// 应用级单例
// ---------------------------------------------------------------------------

let defaultHost: PluginHost | null = null

/**
 * 用内置插件清单创建应用级宿主（由 src/plugins/bootstrap.ts 在启动时调用一次）。
 * 必须在**首帧之前**完成登记，否则画布第一次渲染时会看不到插件提供的卡片类型。
 */
export function configurePluginHost(builtins: BuiltinPluginDescriptor[]): PluginHost {
  defaultHost = createPluginHost({ builtins })
  return defaultHost
}

/** 取应用级宿主；尚未配置时返回一个只有外部插件的宿主（浏览器开发态/异常兜底） */
export function getPluginHost(): PluginHost {
  if (!defaultHost) defaultHost = createPluginHost()
  return defaultHost
}

/** 仅供单元测试：清空应用级宿主 */
export function resetPluginHost(): void {
  defaultHost = null
}
