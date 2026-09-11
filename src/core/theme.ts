// ============================================================================
// 模块说明（中文）
// 深色 / 浅色主题（2026-09-11 用户裁决：新增深色模式并记住偏好）。
//
// 机制：
//   · Tailwind 已配置 darkMode: ['class']（17.1 锁定项不动）——
//     主题切换 = 在 <html> 上增删 `dark` 类；
//   · 颜色全部走 globals.css 的语义变量（.dark 覆盖 --background 等），
//     组件无需写 dark: 前缀；
//   · 偏好存 localStorage（key: mindscape-theme），下次启动自动恢复；
//     首次使用默认浅色（第十二章米白基调）。
//
// 纯函数 + 显式 apply，便于单测与在入口处（main.tsx）渲染前应用、避免闪白。
// ============================================================================

export type Theme = 'light' | 'dark'

const THEME_STORAGE_KEY = 'mindscape-theme'

/** 读取已保存的主题偏好；没有或值非法时返回默认浅色 */
export function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
    return saved === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

/** 持久化主题偏好（localStorage 不可用时静默降级为会话内生效） */
export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // 忽略：隐私模式等场景
  }
}

/** 把主题应用到文档根元素（<html class="dark">） */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

/** 切换主题：返回新主题（调用方负责 apply + save） */
export function toggleTheme(current: Theme): Theme {
  return current === 'dark' ? 'light' : 'dark'
}
