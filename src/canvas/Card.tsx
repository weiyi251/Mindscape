// ============================================================================
// 模块说明（中文）
// 卡片组件：画布上的单个卡片容器。对应 T1.4（渲染）/ T2.2（拖动）。
//
// 职责边界（17.3）：
//   · 外层容器只负责「定位 + 命中」：位置用 translate3d（GPU 图层，17.7）；
//   · pointer 事件由 Viewport 的根监听统一捕获（data-canvas-item 命中即交给
//     Canvas 的拖拽控制器），本组件不自行挂事件；
//   · 内层外观完全由卡片类型注册表（cardTypes）决定，不写死任何卡片外观；
//   · 选中态只加边框高亮（11.6），缩放手柄在 T2.3 引入。
// ============================================================================

import type { CSSProperties } from 'react'

import type { Card } from '@/core/types'
import { renderCard } from '@/core/registry/cardTypes'
import { cn } from '@/lib/utils'
import { CANVAS_ITEM_ATTR } from './Viewport'

/** 标记「卡片 DOM」的属性：拖拽控制器靠它从事件目标反查卡片 id */
export const CARD_ID_ATTR = 'data-card-id'

export interface CardViewProps {
  card: Card
  selected: boolean
  /** 把 DOM 引用注册进父级的 Map<cardId, HTMLElement>（17.3） */
  registerEl?: (cardId: string, element: HTMLDivElement | null) => void
  /** 已移除视图（T2.8）：灰底淡入（7.2） */
  grayscale?: boolean
}

/** 卡片外层容器的定位样式（GPU 图层，见文件顶部说明） */
function cardStyle(card: Card): CSSProperties {
  return {
    position: 'absolute',
    left: 0,
    top: 0,
    width: card.w,
    height: card.h,
    transform: `translate3d(${card.x}px, ${card.y}px, 0)`,
    willChange: 'transform',
  }
}

export function CardView({ card, selected, registerEl, grayscale = false }: CardViewProps) {
  return (
    <div
      ref={(element) => {
        registerEl?.(card.id, element)
      }}
      {...{ [CANVAS_ITEM_ATTR]: '' }}
      {...{ [CARD_ID_ATTR]: card.id }}
      style={cardStyle(card)}
      className={cn(
        'absolute left-0 top-0 cursor-grab touch-none select-none rounded-sm bg-card shadow-sm',
        'transition-shadow hover:shadow-md',
        selected && 'outline outline-2 outline-primary',
      )}
    >
      <div
        className="h-full w-full transition-opacity"
        style={grayscale ? { filter: 'grayscale(1)', opacity: 0.75 } : undefined}
      >
        {renderCard({ card, selected })}
      </div>

      {/* 右下角缩放手柄（5.2：选中后拖右下角手柄）。11.6：仅在选中时出现。
          pointerdown 靠冒泡进入 Viewport 的原生监听，由 Canvas 分流到缩放控制器 */}
      {selected ? (
        <div
          data-resize-handle={card.id}
          className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-full border border-background bg-primary shadow-sm"
        />
      ) : null}

      {/* 右缘中点连接手柄（T3.1：从边缘拖出箭头连到目标卡）。
          仅选中时出现；pointerdown 由 Canvas 分流到连线拖拽，不触发卡片拖动 */}
      {selected ? (
        <div
          data-connect-handle={card.id}
          title="拖到目标卡片创建连线"
          className="absolute -right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 cursor-crosshair rounded-full border border-background bg-primary/80 shadow-sm hover:bg-primary"
        />
      ) : null}
    </div>
  )
}
