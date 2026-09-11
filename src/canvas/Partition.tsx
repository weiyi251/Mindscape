// ============================================================================
// 模块说明（中文）
// 分区框组件。对应开发计划书第六章「分区框（子文件夹）规格」：
//   · 半透明色块 + 顶部标题条（名字 + 折叠按钮）
//   · 折叠后框内卡片隐藏，只留标题条（高度 = PARTITION_TITLE_HEIGHT）
//   · 颜色由 resolvePartitionColor 解析（8 色轮换 / 手动指定）
//   · 双击标题改名（T2.6）：本地编辑态，提交交给上层走五步保护
//
// 【17.3 手感约束】拖框过程中的 x/y 不进 React state —— 组件只按 props
//   渲染静态位置，拖动中由 partitionDragController 直写 DOM transform，
//   松手才经命令系统更新 store。编辑态（是否在改名）是低频 UI 状态，可用 state。
//
// 实现任务：T2.5 / T2.6。
// ============================================================================

import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import type { Partition } from '@/core/types'
import { PARTITION_TITLE_HEIGHT } from '@/core/board/partitions'

/** 标记「分区框元素」的属性名（值 = partition.id） */
export const PARTITION_ID_ATTR = 'data-partition-id'

export interface PartitionViewProps {
  partition: Partition
  /** 已解析的颜色（Canvas 层统一算好，组件保持纯展示） */
  color: string
  /** 注册 DOM 元素（拖框时直写样式用，17.3） */
  registerEl?: (id: string, element: HTMLDivElement | null) => void
  /** 点击折叠按钮 */
  onToggleCollapsed?: (id: string) => void
  /** 提交新名字（第六章保护措施由上层完成；非法输入上层会拒绝并提示） */
  onRename?: (id: string, newName: string) => void
}

export function PartitionView({
  partition,
  color,
  registerEl,
  onToggleCollapsed,
  onRename,
}: PartitionViewProps) {
  const collapsed = partition.collapsed
  const height = collapsed ? PARTITION_TITLE_HEIGHT : partition.h

  // 编辑态是本地 UI 状态：不进 store（17.3：低频但纯展示性的状态不必全局化）
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(partition.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const startEditing = () => {
    setDraft(partition.name)
    setEditing(true)
  }

  const submit = () => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed && trimmed !== partition.name) onRename?.(partition.id, trimmed)
  }

  return (
    <div
      {...{ [PARTITION_ID_ATTR]: partition.id, 'data-canvas-item': '' }}
      ref={(element) => registerEl?.(partition.id, element)}
      className="group absolute left-0 top-0 rounded-lg border will-change-transform"
      style={{
        width: `${partition.w}px`,
        height: `${height}px`,
        transform: `translate3d(${partition.x}px, ${partition.y}px, 0)`,
        borderColor: `${color}66`,
        backgroundColor: `${color}24`,
      }}
    >
      {/* 调整大小手柄（2026-09-11 用户裁决：拖拽边缘改宽高）。
          e = 右缘改宽 / s = 下缘改高 / se = 右下角同调；悬停时显形。
          pointerdown 由 Canvas 的 item 分流统一接管（先于拖框判定） */}
      {(['e', 's', 'se'] as const).map((edge) => (
        <div
          key={edge}
          data-partition-resize={edge}
          className={cn(
            'absolute z-10 rounded-sm bg-primary/0 transition-colors hover:bg-primary/40',
            collapsed && edge !== 'e' ? 'hidden' : '',
            edge === 'e' ? '-right-1 bottom-0 top-0 w-2 cursor-ew-resize' : '',
            edge === 's' ? '-bottom-1 left-0 right-0 h-2 cursor-ns-resize' : '',
            edge === 'se' ? '-bottom-1 -right-1 h-3 w-3 cursor-nwse-resize' : '',
          )}
        />
      ))}

      {/* 标题条：折叠时就是整个框。双击改名绑定在整条标题条上（双击文字 /
          双击标题条空白都生效），折叠按钮单独拦掉 dblclick */}
      <div
        className="flex h-8 items-center gap-1 rounded-t-lg px-2"
        style={{ backgroundColor: `${color}40` }}
        onDoubleClick={startEditing}
      >
        <button
          type="button"
          // ⚠️ 按钮要拦住按下事件，避免触发框拖动 / 画布平移；
          //    也要拦住双击，避免「连点折叠按钮」误入改名状态
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onClick={() => onToggleCollapsed?.(partition.id)}
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] leading-none',
            'text-foreground/70 hover:bg-foreground/10',
          )}
          title={collapsed ? '展开分区' : '折叠分区'}
        >
          {collapsed ? '▶' : '▼'}
        </button>

        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onPointerDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit()
              if (event.key === 'Escape') setEditing(false)
            }}
            onBlur={submit}
            className="min-w-0 flex-1 rounded border border-border bg-background px-1 py-0.5 text-[13px] outline-none"
            autoFocus
          />
        ) : (
          <span
            // select-none：双击是改名手势，别让浏览器顺手选中文字
            className="min-w-0 flex-1 cursor-text select-none truncate text-[13px] font-medium text-foreground/80"
            title={`${partition.name}（双击改名）`}
          >
            {partition.name}
          </span>
        )}
      </div>
    </div>
  )
}
