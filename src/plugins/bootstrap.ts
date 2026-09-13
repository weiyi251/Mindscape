// ============================================================================
// 模块说明（中文）
// 插件系统的启动引导：用内置清单配置应用级宿主，并完成一次 init。
//
// 在 main.tsx 里于挂载 React 之前调用一次。刻意**不 await**：
//   · 需要「首帧前就位」的注册目前只有卡片类型（渲染时查表），而内置色卡插件
//     只注册画布菜单项 —— 菜单是右键时才组装的（pages/board/contextMenus.tsx
//     每次点开都重新查表），晚一拍注册不会漏项；
//   · 而 init 里有磁盘 I/O（读 plugins.json、扫描外部插件目录），
//     阻塞首帧去等它是纯粹的启动变慢。
//   将来若有插件要注册卡片类型，把 `await` 加回来即可（或按方案 §8 的
//   「同步预注册 + 异步补齐」两步走）。
//
// 异常兜底：插件系统坏掉**绝不能**让应用起不来 —— 这里吞掉异常只记日志。
// 用户在设置页会看到「插件加载失败」的中文提示（pluginHost.lastError）。
// ============================================================================

import { configurePluginHost } from '@/core/plugin/pluginHost'
import type { PluginHost } from '@/core/plugin/pluginHost'
import { BUILTIN_PLUGINS } from './builtinPlugins'

/**
 * 初始化插件系统。
 * @returns 应用级宿主实例（便于测试与将来在别处使用）
 */
export async function bootstrapPlugins(): Promise<PluginHost> {
  const host = configurePluginHost(BUILTIN_PLUGINS)
  try {
    await host.init()
  } catch (error) {
    console.error('[plugins] 插件初始化失败：', error)
  }
  return host
}
