// ============================================================================
// 模块说明（中文）
// 插件系统的类型定义（纯类型，无运行时逻辑）。
//
// 分三层：
//   · 插件包自身    —— PluginManifest（manifest.json 的形状，见 manifest.ts）
//   · 宿主侧状态    —— PluginState / PluginSource / PluginRecord（设置页列表消费）
//   · 插件可见能力  —— PluginHostApi（activate(api) 注入的那个对象）
//
// 与 docs/插件功能实施方案.md §2 的对应关系：
//   §2.1 插件包结构（manifest.json + index.js）
//   §2.3 生命周期六态状态机 → PluginState
//   §4   归属与注销         → PluginContributions（摘要，明细在 pluginCenter）
//
// ⚠️ 本文件刻意只放类型：任何运行时逻辑（状态迁移判定、文案）都在
//    lifecycle.ts / pluginText.ts，以便在 node 环境直接单测。
// ============================================================================

import type { ReactNode } from 'react'

import type { PluginApi } from '@/core/registry/pluginCenter'

/** 插件来源 */
export type PluginSource =
  /** 随应用一起打包，编译期就在（只能禁用，不能卸载） */
  | 'builtin'
  /** 用户放进 %APPDATA%\Mindscape\plugins\<id>\ 的外部插件 */
  | 'external'

/**
 * 插件生命周期状态（六态状态机，方案 §2.3）。
 *
 *   discovered ──校验失败──→ invalid
 *        └──校验通过──→ installed ──启用──→ active
 *                                     ↑        │
 *                                     └─停用── inactive
 *   任一状态激活/运行抛错 ──→ error
 */
export type PluginState =
  /** 已发现，尚未校验 */
  | 'discovered'
  /** 清单或入口不合规，永不激活 */
  | 'invalid'
  /** 校验通过，当前未启用 */
  | 'installed'
  /** 已启用（activate 已调用，注册已生效） */
  | 'active'
  /** 曾经启用，现已被停用（注册已回收） */
  | 'inactive'
  /** 激活或运行出错（注册已回收，详情里带中文原因） */
  | 'error'

/** 插件贡献摘要（个数值；明细由 pluginCenter.listPluginContributions 提供） */
export interface PluginContributions {
  cardTypes: number
  menuItems: number
  canvasMenuItems: number
  toolbarItems: number
  hooks: number
}

/** 添加到画布的卡片请求（插件建卡能力的入参） */
export interface CreateCardInput {
  /** 空间内相对路径（写入 card.filePath） */
  relativePath: string
  /** 绝对路径（用于读取图片尺寸、写入资产缓存） */
  absolutePath: string
  /** 卡片类型（插件注册的类型 id，或核心三类型之一） */
  type: string
  /** 画布坐标；省略时由宿主放在视口中心 */
  x?: number
  y?: number
  w?: number
  h?: number
  /**
   * 插件私有数据。**由插件自己按 id 命名空间组织**（如 `{ 'vendor.plugin': {...} }`），
   * 宿主做浅合并写入 card.meta —— 宿主不认识各个插件，不可能替它们决定嵌套层级。
   */
  meta?: Record<string, unknown>
  /**
   * 是否记入撤销历史（默认 true）。
   *
   * ⚠️ 由插件现画的二进制文件（如色卡 PNG）应传 false：撤销一条 addCards 命令
   * 会删除它记录的文件，而 redo 需要「源文件」才能重新复制 —— 插件生成的图没有源文件，
   * 于是 undo 删掉用户刚要的图、redo 再也造不回来。卡片本身仍可被正常移除。
   */
  undoable?: boolean
}

/** 宿主提供给插件的能力（activate(api) 的入参） */
export interface PluginHostApi extends PluginApi {
  /** 对话框：插件自己渲染内容，宿主负责挂载与关闭 */
  ui: {
    openDialog: (title: string, render: () => ReactNode) => void
    closeDialog: () => void
  }
  /** 文件能力 */
  fs: {
    /** 按字节写文件到目标目录（重名自动加序号），返回实际写入的绝对路径 */
    writeBytes: (destDir: string, fileName: string, bytes: Uint8Array) => Promise<string>
    /** 弹出目录选择框；取消或非桌面环境返回 null */
    pickDirectory: (title: string) => Promise<string | null>
  }
  /** 画布能力（由 pages/Board.tsx 注册的桥接实现，未打开空间时返回空值） */
  board: {
    currentSpacePath: () => string | null
    /**
     * 在画布上加一张「已存在于硬盘」的卡片；成功返回 true。
     *
     * 为什么是异步：宿主需要读图片原始尺寸、登记资源表、再走 addCards 命令 ——
     * 这几步一步都不能省（省了卡片就没有正确的宽高比 / 图片显示不出来）。
     * 未打开画布、或桥接被拒绝时返回 false（插件据此给用户一句中文说明）。
     */
    createCardFromFile: (input: CreateCardInput) => Promise<boolean>
  }
  /** 插件私有配置（存在 plugins.json，卸载不清除） */
  config: {
    getAll: () => Record<string, unknown>
    /** 合并式写入（浅合并），立即落盘 */
    set: (patch: Record<string, unknown>) => Promise<void>
  }
}

/** 宿主侧的插件运行记录（设置页列表直接消费） */
export interface PluginRecord {
  id: string
  name: string
  version: string
  description: string
  author: string
  source: PluginSource
  /** 外部插件的安装目录（绝对路径）；内置插件为 null */
  installDir: string | null
  /** 入口文件名（相对安装目录） */
  main: string
  state: PluginState
  /** 状态补充说明（中文；失败时是原因，正常时是贡献摘要） */
  detail: string
  /** 贡献摘要 */
  contributions: PluginContributions
  /** 插件私有配置 */
  config: Record<string, unknown>
}

/** 内置插件描述（编译期常量；`src/plugins/builtinPlugins.ts` 提供） */
export interface BuiltinPluginDescriptor {
  /** 与 manifest.json 完全一致的元信息（内置插件不读文件，直接内联） */
  manifest: {
    id: string
    name: string
    version: string
    description: string
    author: string
    main: string
  }
  /** 插件的入口：注册行为写在这里（内置插件不经动态 import） */
  activate: (api: PluginHostApi) => void | Promise<void>
  /** 可选：停用前的清理（宿主已自动回收注册，这里只处理插件自己的外部资源） */
  deactivate?: () => void | Promise<void>
}
