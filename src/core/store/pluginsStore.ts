// ============================================================================
// 模块说明（中文）
// 插件列表状态（Zustand）。对应 17.3 的划分：插件列表属低频数据
// （只在启用 / 停用 / 卸载 / 刷新时变化），放 Zustand 完全合适。
//
// 与 pluginHost 的分工：宿主是有状态的服务（读写 plugins.json、动态加载模块），
// 本 store 只是它的**订阅者与转发者** —— 不复制业务逻辑，避免两处状态打架。
//
// `registryVersion` 是给渲染层用的：插件停用后注册表版本号变了，
// 菜单与卡片类型本就是即时查表，UI 只要跟着重渲染即可。
//
// 工厂函数 createPluginsStore(getHost) 便于单元测试注入假宿主。
// ============================================================================

import { create } from 'zustand'

import { getPluginHost } from '@/core/plugin/pluginHost'
import type { PluginHost } from '@/core/plugin/pluginHost'
import type { PluginRecord } from '@/core/plugin/types'
import { getRegistryVersion } from '@/core/registry/pluginCenter'
import { toErrorMessage } from '@/core/utils/errorMessage'

export interface PluginsState {
  /** 插件列表（内置在前，同组按名称） */
  plugins: PluginRecord[]
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** 加载失败的中文提示（plugins.json 损坏、扫描失败） */
  error: string | null
  /** 最近一次操作的失败提示（启用 / 卸载抛出时） */
  actionError: string | null
  /** 正在处理的插件 id（按钮转圈用）；null 表示空闲 */
  pendingId: string | null
  /** 注册表版本号快照（插件启停后供渲染层判断是否需要重取菜单 / 卡片类型） */
  registryVersion: number

  /** 首次进入设置页时调用：初始化宿主并订阅它 */
  load: () => Promise<void>
  enable: (id: string) => Promise<void>
  disable: (id: string) => Promise<void>
  uninstall: (id: string) => Promise<void>
  reload: (id: string) => Promise<void>
  refresh: () => Promise<void>
  clearActionError: () => void
}

/** 宿主读取器；测试可注入假实现 */
export type PluginHostGetter = () => PluginHost

export function createPluginsStore(getHost: PluginHostGetter = getPluginHost) {
  let subscribed = false

  return create<PluginsState>((set) => {
    /** 把宿主的内存态同步进 store */
    function sync(): void {
      const host = getHost()
      set({
        plugins: host.list(),
        error: host.lastError(),
        registryVersion: getRegistryVersion(),
        status: 'ready',
      })
    }

    /** 包一层统一的「操作 → 清错 → 同步」流程 */
    async function run(id: string, action: (host: PluginHost) => Promise<void>): Promise<void> {
      set({ pendingId: id, actionError: null })
      try {
        await action(getHost())
      } catch (error) {
        set({ actionError: toErrorMessage(error) })
      } finally {
        set({ pendingId: null })
        sync()
      }
    }

    return {
      plugins: [],
      status: 'idle',
      error: null,
      actionError: null,
      pendingId: null,
      registryVersion: getRegistryVersion(),

      async load() {
        set({ status: 'loading', error: null })
        try {
          const host = getHost()
          if (!subscribed) {
            host.subscribe(sync)
            subscribed = true
          }
          await host.init()
          sync()
        } catch (error) {
          set({ status: 'error', error: toErrorMessage(error) })
        }
      },

      enable: (id) => run(id, (host) => host.enable(id)),
      disable: (id) => run(id, (host) => host.disable(id)),
      uninstall: (id) => run(id, (host) => host.uninstall(id)),
      reload: (id) => run(id, (host) => host.reload(id)),

      async refresh() {
        set({ actionError: null })
        try {
          await getHost().refresh()
        } catch (error) {
          set({ actionError: toErrorMessage(error) })
        }
        sync()
      },

      clearActionError() {
        set({ actionError: null })
      },
    }
  })
}

/** 应用默认实例 */
export const usePluginsStore = createPluginsStore()
