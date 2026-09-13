// ============================================================================
// 模块说明（中文）
// 外部插件的**动态加载**：把安装目录里的入口文件变成一个可用的 ES module。
// 对应方案 §6（阶段 6「动态加载外部插件」）。
//
// 通道：Rust/fs 侧只负责「告诉我们文件在哪」，真正把代码变成模块的是
//   Tauri 的 asset 协议 + 原生动态 import：
//     %APPDATA%\Mindscape\plugins\<id>\index.js
//       → convertFileSrc()  →  http://asset.localhost/.../index.js
//       → import(/* @vite-ignore */ url)  →  { activate, deactivate }
//
// 为什么不新增依赖、也不改 Tauri 配置：
//   tauri.conf.json 的 csp=null、assetProtocol.scope=["**"] 早已放开，
//   capabilities 的 fs:scope 也含 $DATA/Mindscape/**（方案 §6 已核实）。
//
// 可测性：入口 URL 的解析与导入器都可在 options 里注入假实现，
// 因此本模块能在 node 环境直接单测，不需要真的起 Tauri。
// ============================================================================

import { convertFileSrc } from '@tauri-apps/api/core'

import { toErrorMessage } from '@/core/utils/errorMessage'
import { joinPath } from '@/core/utils/paths'
import type { PluginManifest } from './manifest'
import type { PluginHostApi } from './types'

/** 插件入口模块必须导出的形状 */
export interface PluginModule {
  /** 插件入口：所有注册行为写在这里（宿主注入 api） */
  activate: (api: PluginHostApi) => void | Promise<void>
  /** 可选：宿主回收注册之后调用的清理钩子（释放插件自己的外部资源） */
  deactivate?: () => void | Promise<void>
}

/** 把入口 URL 变成模块的导入器（默认是原生动态 import） */
export type PluginModuleImporter = (entryUrl: string) => Promise<unknown>

/**
 * 默认导入器。
 * `@vite-ignore` 是必需的：否则 Vite 会尝试静态分析这个运行时才确定的 URL 并报错。
 */
export const defaultPluginImporter: PluginModuleImporter = (entryUrl) =>
  import(/* @vite-ignore */ entryUrl)

/** 入口文件的绝对路径（纯函数：只做拼接，便于单测） */
export function pluginEntryPath(installDir: string, main: string): string {
  return joinPath(installDir, main)
}

/** 判断动态导入回来的值是否是可用的插件模块 */
export function isPluginModule(value: unknown): value is PluginModule {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { activate?: unknown; deactivate?: unknown }
  if (typeof candidate.activate !== 'function') return false
  if (candidate.deactivate !== undefined && typeof candidate.deactivate !== 'function') return false
  return true
}

export interface PluginLoaderOptions {
  /** 绝对路径 → 可 import 的 URL；默认走 Tauri asset 协议 */
  resolveUrl?: (absolutePath: string) => string
  /** 模块导入器；默认原生动态 import */
  importer?: PluginModuleImporter
}

/**
 * 加载插件入口模块。
 *
 * @throws 中文错误（可直接展示给用户）：
 *   · 入口文件不存在 / 语法错误 / 顶层抛错 → 「入口加载失败：…」
 *   · 入口没有导出 activate            → 「未导出 activate(api) 函数」
 */
export async function loadPluginModule(
  installDir: string,
  manifest: PluginManifest,
  options: PluginLoaderOptions = {},
): Promise<PluginModule> {
  const resolveUrl = options.resolveUrl ?? convertFileSrc
  const importer = options.importer ?? defaultPluginImporter

  const entryPath = pluginEntryPath(installDir, manifest.main)

  let loaded: unknown
  try {
    loaded = await importer(resolveUrl(entryPath))
  } catch (error) {
    throw new Error(`插件「${manifest.id}」入口加载失败：${toErrorMessage(error)}`)
  }

  if (!isPluginModule(loaded)) {
    throw new Error(`插件「${manifest.id}」的入口 ${manifest.main} 未导出 activate(api) 函数`)
  }
  return loaded
}
