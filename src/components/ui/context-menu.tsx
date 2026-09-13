// ============================================================================
// 模块说明（中文）
// 轻量右键菜单浮层（T3.9）。与 modal.tsx 同一策略：自研 ~50 行，不引第三方。
//
// 菜单项数组由调用方组装 —— 卡片菜单来自菜单配置中心
// （registry/menus.ts 的 buildCardMenuFor / buildPartitionMenuFor，配置驱动，
// 本组件不写死任何业务项），本组件只负责「定位 + 渲染 + 关闭」。
//
// 定位：fixed + 视口内收敛（贴近右/下边缘时往回收），避免菜单溢出窗口。
// 关闭：点击菜单外 / Esc / 选中一项。
// ============================================================================

import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface ContextMenuItemData {
  id: string
  label: string
  /** 选中时执行（由调用方闭包注入 ctx） */
  run: () => void
  /** 危险操作（如移除）显示为红色 */
  danger?: boolean
  /** 色板等自定义前缀色块 */
  swatch?: string
  disabled?: boolean
  /** 行内图标（2026-09-13：撤销 / 重做等操作并入右键菜单后需要图形辅助识别） */
  icon?: ReactNode
  /** 在该项之前画一条分隔线（用于把「全局操作」与「针对本体的操作」分开） */
  separatorBefore?: boolean
}

export interface ContextMenuState {
  /** 屏幕（视口）坐标 */
  x: number
  y: number
  items: ContextMenuItemData[]
}

export interface ContextMenuProps {
  state: ContextMenuState | null
  onClose: () => void
}

export function ContextMenu({ state, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  // 点击菜单外关闭（capture 阶段，避免被画布的 pointer 逻辑吃掉）
  useEffect(() => {
    if (!state) return

    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return
      onClose()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [state, onClose])

  if (!state) return null

  // 视口内收敛：先按 1 项 32px 估高，定位后再由浏览器实际尺寸微调
  const estimatedHeight = Math.min(state.items.length, 12) * 32 + 8
  const x = Math.min(state.x, window.innerWidth - 190)
  const y = Math.min(state.y, window.innerHeight - estimatedHeight - 8)

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[160px] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
      style={{ left: x, top: y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {state.items.map((item) => (
        <div key={item.id}>
          {item.separatorBefore ? <div className="my-1 h-px bg-border" /> : null}
          <button
            type="button"
            disabled={item.disabled}
            className={cn(
              'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs',
              'hover:bg-accent hover:text-accent-foreground',
              '[&_svg]:size-3.5 [&_svg]:shrink-0',
              item.danger && 'text-destructive hover:bg-destructive/10',
              item.disabled && 'cursor-default text-muted-foreground hover:bg-transparent',
            )}
            onClick={() => {
              onClose()
              if (!item.disabled) item.run()
            }}
          >
            {item.swatch ? (
              <span
                className="h-3 w-3 shrink-0 rounded-full border border-border"
                style={{ backgroundColor: item.swatch }}
              />
            ) : null}
            {item.icon}
            {item.label}
          </button>
        </div>
      ))}
    </div>
  )
}
