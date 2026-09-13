// ============================================================================
// 模块说明（中文）
// 前端入口。挂载 React 根组件，并引入全局样式（Tailwind + 主题变量）。
//
// 对应开发计划书 17.2：src/main.tsx 为前端起点。
// ============================================================================

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App'
import { bootstrapPlugins } from '@/plugins'
import { applyTheme, loadTheme } from '@/core/utils/theme'
import '@/styles/globals.css'

// 渲染前恢复上次的主题偏好，避免深色用户启动时闪一帧浅色
applyTheme(loadTheme())

// 插件系统启动（登记内置插件 + 读 plugins.json + 扫描外部插件目录）。
// 刻意不 await：init 里有磁盘 I/O，阻塞首帧去等它只是让启动变慢；
// 而目前内置插件只注册画布菜单项 —— 菜单是右键时才查表组装的
// （pages/board/contextMenus.tsx），晚一拍注册不会漏项。
// 详见 src/plugins/bootstrap.ts 的模块说明。
void bootstrapPlugins()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
