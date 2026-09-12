// ============================================================================
// 模块说明（中文）
// 原生弹窗（确认 / 提示）的唯一出口。
//
// 为什么需要这一层（2026-09-12 起）：
//   · 桌面端（Tauri WebView2）有 dialog 插件：弹窗带标题与警告/错误图标，走系统样式；
//   · 浏览器开发态（pnpm dev 直开 http://localhost:1420）没有 Tauri 后端，插件不可用，
//     只能回落到原生 confirm / alert；
//   · 需要用户**输入文本**时两个都不够用，走自研浮层（components/ui/prompt-dialog.tsx）。
//
// 把「当前该用哪个 API」收在这一个文件里，调用点只写一句 confirmDialog / alertDialog，
// 不必各自复制一遍 isDesktopRuntime() 分支。
//
// ⚠️ 架构守卫强制这一点：src 下的 `window.confirm` / `window.alert` / `window.prompt`
// 只允许出现在本文件（见 src/__guards__/architecture.test.ts 规则 2）。
//
// 实现任务：P1-1（架构守卫测试）。
// ============================================================================

import { ask, message } from '@tauri-apps/plugin-dialog'

import { isDesktopRuntime } from '@/core/utils/runtime'

/**
 * 确认框，返回用户是否点了「确认」。
 * 桌面端走 dialog 插件的 ask()（带标题与 warning 图标），浏览器开发态回落原生 confirm()。
 */
export async function confirmDialog(messageText: string, title: string): Promise<boolean> {
  if (isDesktopRuntime()) {
    return ask(messageText, { title, kind: 'warning' })
  }
  return window.confirm(messageText)
}

/**
 * 仅提示、无需回答的弹窗（对应原生 alert）。
 * 失败提示统一用它：桌面端是带 error 图标的系统消息框，浏览器开发态回落原生 alert()。
 */
export async function alertDialog(messageText: string, title: string): Promise<void> {
  if (isDesktopRuntime()) {
    await message(messageText, { title, kind: 'error' })
    return
  }
  window.alert(messageText)
}
