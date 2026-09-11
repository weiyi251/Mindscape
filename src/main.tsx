// ============================================================================
// 模块说明（中文）
// 前端入口。挂载 React 根组件，并引入全局样式（Tailwind + 主题变量）。
//
// 对应开发计划书 17.2：src/main.tsx 为前端起点。
// ============================================================================

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App'
import { applyTheme, loadTheme } from '@/core/utils/theme'
import '@/styles/globals.css'

// 渲染前恢复上次的主题偏好，避免深色用户启动时闪一帧浅色
applyTheme(loadTheme())

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
