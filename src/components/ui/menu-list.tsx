// ============================================================================
// 模块说明（中文）
// 通用菜单渲染组件。对应 T0.10 验收标准「菜单由配置数组生成，改配置即时反映到 UI」。
//
// 定位：**纯渲染层**，只负责把配置数组画成菜单列表，不含任何业务逻辑。
//   · 数据来源：core/registry/menus.ts 的 buildCardMenuFor / buildPartitionMenuFor
//   · 触发方式：本组件不处理右键定位与浮层开关（那属于阶段二的 Canvas 交互），
//               由调用方决定放在哪里显示（右键浮层 / 侧栏预览 / 演示页均可复用）。
//   · 点击项：调用 item.action(ctx)，并回调 onAfterAction 供调用方关闭浮层 / 记日志。
//
// 之所以做成独立组件而不是写死在画布里的菜单：插件的「尺寸标注」「色彩提取」
// 只要注册一条配置，就能自动出现在这个菜单里（第十三章「准备 3」的收益）。
//
// 实现任务：T0.10（准备层）。
// ============================================================================

import { cn } from '@/lib/utils'
import type { MenuContext } from '@/core/registry/pluginCenter'

/**
 * 菜单项的最小结构。
 * MenuItem（卡片菜单）与 PartitionMenuItem（分区框菜单）都满足此形状，
 * 因此同一个渲染组件可服务两类菜单。
 */
export interface MenuListEntry {
  id: string
  label: string
  action: (ctx: MenuContext) => void
}

export interface MenuListProps {
  /** 菜单项数组（顺序即显示顺序，由配置中心决定） */
  items: MenuListEntry[]
  /** 点击时传给 action 的上下文 */
  ctx: MenuContext
  className?: string
  /** 项被点击后的回调（调用方用它关闭浮层 / 记录日志） */
  onAfterAction?: (item: MenuListEntry) => void
}

/**
 * 渲染菜单列表。
 * 空数组返回 null —— 避免在画布上留下一个空的浮层容器。
 */
export function MenuList({ items, ctx, className, onAfterAction }: MenuListProps) {
  if (items.length === 0) return null

  return (
    <div
      role="menu"
      className={cn(
        'min-w-[168px] rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-md',
        className,
      )}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          data-menu-item-id={item.id}
          className={cn(
            'flex w-full items-center px-3 py-1.5 text-left text-sm',
            'hover:bg-muted focus-visible:bg-muted focus-visible:outline-none',
          )}
          onClick={() => {
            item.action(ctx)
            onAfterAction?.(item)
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
