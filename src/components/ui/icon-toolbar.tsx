// ============================================================================
// 模块说明（中文）
// 可折叠图标工具栏（2026-09-12 用户裁决）。
//
// 需求原话：「将这些 UI 控件统一放置在一个可折叠的工具栏中，工具栏内的所有 UI 控件
// 均使用纯图标形式表示，不显示文字标签。」——对应画布页顶栏的 撤销 / 重做 / 新建便签
// （以及「已移除视图」下的 恢复选中）。
//
// 设计要点：
//   · **纯图标**：按钮上不出现任何文字，语义由原生 `title`（悬浮提示）+ `aria-label`
//     （无障碍）承担；「恢复选中」的张数不写成文字，改用右上角计数徽标保留信息；
//   · **可折叠**：收起后只剩手柄，顶栏不会被按钮占满；展开 / 收起偏好由调用方持久化
//     （`TOOLBAR_PREF_KEY`），默认展开（不藏功能）；
//   · 折叠只隐藏按钮 —— 键盘快捷键（Ctrl+Z / Ctrl+Shift+Z）与右键菜单不受影响；
//   · 组件本身不持有任何状态、不碰命令系统，items 与 expanded 全部由调用方传入，
//     因此可被别的工具栏复用（后续若把「返回列表」等也收进来，只需改调用方）。
// ============================================================================

import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { ChevronsLeftIcon, ChevronsRightIcon } from './icons'

/** 展开 / 收起偏好的 localStorage key（由调用方读写） */
export const TOOLBAR_PREF_KEY = 'mindscape.boardToolbar'

export interface IconToolbarItem {
  /** 稳定标识（列表 key） */
  id: string
  /** 无障碍名与悬浮提示；按钮上**不**显示文字 */
  label: string
  icon: ReactNode
  onClick: () => void
  /** 右上角计数徽标（如「恢复选中」的张数）——用数字代替文字标签 */
  badge?: number
}

export interface IconToolbarProps {
  items: IconToolbarItem[]
  /** false = 收起（只留折叠手柄） */
  expanded: boolean
  onToggle: () => void
  className?: string
}

/**
 * 按钮 32×32，容器固定 h-9（36px）—— 与顶栏其它按钮（Button 的 h-9）**等高对齐**；
 * 高度用显式 h-9 + `px-0.5`，而不是四周 p-0.5：后者叠加 border 会变成 38px，比邻居高 2px（实测过）。
 * `[&_svg]:size-4` 把图标统一成 16px，和 Button 里的图标一致。
 */
const BUTTON_CLASS =
  'relative flex h-8 w-8 shrink-0 items-center justify-center rounded text-foreground/70 transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&_svg]:size-4 [&_svg]:shrink-0'

export function IconToolbar({ items, expanded, onToggle, className }: IconToolbarProps) {
  return (
    <div
      data-icon-toolbar=""
      className={cn(
        'flex h-9 shrink-0 items-center gap-0.5 rounded-md border border-border bg-background px-0.5',
        className,
      )}
    >
      {/* 折叠手柄：箭头指向**按下后整块内容移动的方向**。
          工具栏在顶栏里靠右对齐，所以收起 = 内容向右缩回去（»）、展开 = 向左铺开（«）。
          ⚠️ 2026-09-12 用户实测反馈方向反了，已按上述规则对调（原来写成了左侧面板的约定）。 */}
      <button
        type="button"
        onClick={onToggle}
        title={expanded ? '收起工具栏' : '展开工具栏'}
        aria-label={expanded ? '收起工具栏' : '展开工具栏'}
        aria-expanded={expanded}
        className={BUTTON_CLASS}
      >
        {expanded ? <ChevronsRightIcon /> : <ChevronsLeftIcon />}
      </button>

      {expanded
        ? items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={item.onClick}
              title={item.label}
              aria-label={item.label}
              className={BUTTON_CLASS}
            >
              {item.icon}
              {item.badge !== undefined && item.badge > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 min-w-[14px] rounded-full bg-primary px-0.5 text-center text-[9px] font-medium leading-[14px] text-primary-foreground">
                  {item.badge}
                </span>
              ) : null}
            </button>
          ))
        : null}
    </div>
  )
}
