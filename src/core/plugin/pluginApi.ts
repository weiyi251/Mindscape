// ============================================================================
// 模块说明（中文）
// 插件 API 的**组装层**：把宿主各处能力拼成交给插件的那个对象（PluginHostApi）。
//
// 分工：pluginCenter 提供「注册」那半（createPluginApi，带 pluginId 归属），
// 本文件负责另外四件插件必须靠宿主才能做的事：
//   · ui      —— 弹出插件自己的对话框（走 core/store/pluginUiStore）
//   · fs      —— 按字节写文件（走 StorageProvider，落盘端是 Rust write_file_bytes）
//   · board   —— 当前空间路径 / 在画布上加卡（走 core/plugin/boardBridge，由 Board 注入）
//   · config  —— 插件私有配置（存在 plugins.json，由 pluginHost 读写）
//
// 这一层刻意不做业务判断，只做「把 A 的能力转手给 B」，因此不单测；
// 真实验证发生在设置页与色卡插件的集成路径上。
// ============================================================================

import { open } from '@tauri-apps/plugin-dialog'

import { createPluginApi } from '@/core/registry/pluginCenter'
import { localStorageProvider } from '@/core/storage/LocalFolderProvider'
import { closePluginDialog, openPluginDialog } from '@/core/store/pluginUiStore'
import { isDesktopRuntime } from '@/core/utils/runtime'
import { getPluginBoardBridge } from './boardBridge'
import type { PluginHostApi } from './types'

/** 组装插件 API 需要的外部依赖（由 pluginHost 注入） */
export interface PluginApiContext {
  /** 插件 id */
  id: string
  /** 插件展示名（对话框标题默认用它） */
  name: string
  /** 读取当前配置快照 */
  getConfig: () => Record<string, unknown>
  /** 合并式写入配置并落盘 */
  setConfig: (patch: Record<string, unknown>) => Promise<void>
}

/** 目录选择（桌面端走 dialog 插件；浏览器开发态没有后端，直接返回 null） */
async function pickDirectory(title: string): Promise<string | null> {
  if (!isDesktopRuntime()) return null
  const selected = await open({ directory: true, multiple: false, title })
  return typeof selected === 'string' ? selected : null
}

/** 组装一个插件的完整 API */
export function buildPluginApi(context: PluginApiContext): PluginHostApi {
  const registry = createPluginApi(context.id)

  return {
    ...registry,

    ui: {
      openDialog: (title, render) =>
        openPluginDialog({ pluginId: context.id, title: title || context.name, render }),
      closeDialog: closePluginDialog,
    },

    fs: {
      writeBytes: (destDir, fileName, bytes) =>
        localStorageProvider.writeFileBytes(destDir, fileName, bytes),
      pickDirectory,
    },

    board: {
      currentSpacePath: () => getPluginBoardBridge()?.currentSpacePath() ?? null,
      createCardFromFile: (input) => getPluginBoardBridge()?.createCardFromFile(input) ?? false,
    },

    config: {
      getAll: () => context.getConfig(),
      set: (patch) => context.setConfig(patch),
    },
  }
}
