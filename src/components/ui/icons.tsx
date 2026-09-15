// ============================================================================
// 模块说明（中文）
// 通用图标（2026-09-12 新增）。项目未引入图标库（17.1 依赖清单锁定），
// 统一用内联 SVG 实现，零新增依赖 —— 与既有 Connection / Canvas 内的内联 SVG 一致。
//
// 约定：
//   · 只导出组件（react-refresh 规则：组件文件不夹杂常量 / 纯函数）；
//   · 尺寸交给使用处 —— Button 的 `[&_svg]:size-4` 会统一成 16px，也可用 className 覆盖；
//   · 一律 aria-hidden，语义由按钮的 aria-label / title 承担。
//
// 2026-09-12 追加：画布工具栏需要一套纯图标（撤销 / 重做 / 新建便签 / 恢复选中 / 折叠手柄）。
// ============================================================================

import type { ReactNode } from 'react'

export interface IconProps {
  className?: string
}

/** 统一的描边式外壳：24×24 网格、currentColor 描边、圆角端点 */
function StrokeIcon({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/** 加号（2026-09-12：主界面「新建空间」的纯图标入口） */
export function PlusIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </StrokeIcon>
  )
}

/** 齿轮（设置面板入口；Board 与 SpaceList 共用，保证两处入口外观一致） */
export function SettingsIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </StrokeIcon>
  )
}

/** 撤销（工具栏）：向左的回旋箭头 */
export function UndoIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </StrokeIcon>
  )
}

/** 重做（工具栏）：撤销的镜像 */
export function RedoIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </StrokeIcon>
  )
}

/** 新建便签（工具栏）：折角便签 + 加号 */
export function NoteAddIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M4 4h10l6 6v10H4z" />
      <path d="M14 4v6h6" />
      <path d="M9 15h6" />
      <path d="M12 12v6" />
    </StrokeIcon>
  )
}

/** 恢复选中（工具栏，仅「已移除视图」出现）：逆时针回转箭头 */
export function RestoreIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </StrokeIcon>
  )
}

/** 新建分区（画布右键菜单，2026-09-14）：文件夹 + 加号 */
export function FolderAddIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M3 7a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.6.8l1.1 1.4H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M12 10.5v6" />
      <path d="M9 13.5h6" />
    </StrokeIcon>
  )
}

/** 导入（主界面「导入空间」入口）：向下的箭头落进托盘 */
export function ImportIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M12 3v10" />
      <path d="m8 9 4 4 4-4" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </StrokeIcon>
  )
}

/** 放大镜（P1-3：画布搜索浮层的标题区） */
export function SearchIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </StrokeIcon>
  )
}

/** 单箭头向上（P1-3：搜索浮层「上一个命中」） */
export function ChevronUpIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="m18 15-6-6-6 6" />
    </StrokeIcon>
  )
}

/** 单箭头向下（P1-3：搜索浮层「下一个命中」） */
export function ChevronDownIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="m6 9 6 6 6-6" />
    </StrokeIcon>
  )
}

/** 关闭叉（P1-3：搜索浮层关闭按钮；语义由 aria-label 承担） */
export function CloseIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </StrokeIcon>
  )
}

/** 太阳（2026-09-13：顶栏「切换深浅色模式」——当前深色时显示，表示可切到浅色） */
export function SunIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </StrokeIcon>
  )
}

/** 月亮（2026-09-13：顶栏「切换深浅色模式」——当前浅色时显示，表示可切到深色） */
export function MoonIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
    </StrokeIcon>
  )
}

/** 归档盒（2026-09-13：顶栏「显示已移除」——移入 `_已移除` 的卡片仍在硬盘上） */
export function ArchiveIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
      <path d="M10 12h4" />
    </StrokeIcon>
  )
}

/** 左向箭头（2026-09-13：已移除视图下「返回画布」） */
export function ArrowLeftIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </StrokeIcon>
  )
}
