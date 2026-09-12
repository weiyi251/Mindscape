// ============================================================================
// 模块说明（中文）
// 主题状态 hook（2026-09-12 新增）。
//
// 背景：设置面板要同时挂在画布页（Board）与空间列表页（SpaceList）——
// 「读偏好 → 切换 → 应用 <html> 类 → 写偏好」这套动作必须只有一份实现，
// 否则两处面板的行为会漂移。底层仍是 core/utils/theme.ts 里的纯函数，
// 不进 Zustand（低频操作，且同一时刻只有一个页面在渲染）。
// ============================================================================

import { useCallback, useEffect, useState } from 'react'

import { applyTheme, loadTheme, saveTheme, toggleTheme } from '@/core/utils/theme'
import type { Theme } from '@/core/utils/theme'

export interface ThemeController {
  /** 当前主题 */
  theme: Theme
  /** 切换主题（应用 + 记忆一并完成） */
  toggle: () => void
}

export function useTheme(): ThemeController {
  // 初始值取上次保存的偏好；main.tsx 已在首帧渲染前应用过一次，这里只是同步状态
  const [theme, setTheme] = useState<Theme>(() => loadTheme())

  // 主题变化 → 应用到 <html> 并存偏好（首帧重复应用一次无副作用）
  useEffect(() => {
    applyTheme(theme)
    saveTheme(theme)
  }, [theme])

  const toggle = useCallback(() => {
    setTheme((current) => toggleTheme(current))
  }, [])

  return { theme, toggle }
}
