// ============================================================================
// 模块说明（中文）
// 分区框组件。对应开发计划书第六章「分区框（子文件夹）规格」：
//   · 半透明色块 + 顶部标题条（名字 + 折叠按钮）
//   · 折叠后框内卡片隐藏，只留标题条（高度 = PARTITION_TITLE_HEIGHT）
//   · 颜色由 resolvePartitionColor 解析（8 色轮换 / 手动指定）
//   · 双击标题改名（T2.6）：进入行内编辑态，提交交给上层走五步保护
//
// 【17.3 手感约束】拖框过程中的 x/y 不进 React state —— 组件只按 props
//   渲染静态位置，拖动中由 partitionDragController 直写 DOM transform，
//   松手才经命令系统更新 store。编辑态（是否在改名）是低频 UI 状态，可用 state。
//
// 【改名触发多入口（2026-09-14 修复）】双击标题与右键菜单「重命名分区」都必须进入
//   同一行内编辑态。为避免两个入口各自维护状态导致错位，编辑态改由**父层（Canvas）
//   单一数据源**驱动：`editing` 由 `partition.id === editingPartitionId` 推导，
//   双击标题经 `onBeginEdit` 通知父层置位、提交/取消经 `onRename`/`onCancelEdit`
//   通知父层清位 —— 完全镜像便签的 `beginNoteEdit` 机制。
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
  /** 是否选中（2026-09-12：Ctrl+V 粘贴目标 = 选中的分区，选中时描边高亮） */
  selected?: boolean
  /** 注册 DOM 元素（拖框时直写样式用，17.3） */
  registerEl?: (id: string, element: HTMLDivElement | null) => void
  /** 点击折叠按钮 */
  onToggleCollapsed?: (id: string) => void
  /** 提交新名字（第六章保护措施由上层完成；非法输入上层会拒绝并提示） */
  onRename?: (id: string, newName: string) => void
  /** 是否进入改名编辑态（父层 Canvas 单一数据源驱动；菜单与双击共用） */
  editing?: boolean
  /** 双击标题 → 通知父层把本分区置为编辑态（单一数据源） */
  onBeginEdit?: (id: string) => void
  /** 改名取消（Esc / 与原名相同）→ 通知父层清位 */
  onCancelEdit?: (id: string) => void
}

export function PartitionView({
  partition,
  color,
  selected = false,
  registerEl,
  onToggleCollapsed,
  onRename,
  editing = false,
  onBeginEdit,
  onCancelEdit,
}: PartitionViewProps) {
  const collapsed = partition.collapsed
  const height = collapsed ? PARTITION_TITLE_HEIGHT : partition.h

  // 草稿是本地输入缓冲（仅改名输入框用）；编辑态本身由父层 `editing` 驱动。
  const [draft, setDraft] = useState(partition.name)
  const inputRef = useRef<HTMLInputElement>(null)
  // 每次进入编辑态只初始化一次草稿并聚焦全选（用 ref 防止重渲染反复触发）
  const didInit = useRef(false)

  useEffect(() => {
    if (editing && !didInit.current) {
      didInit.current = true
      setDraft(partition.name)
      // 下一帧再聚焦全选：确保 input 已挂载到 DOM
      requestAnimationFrame(() => inputRef.current?.select())
    }
    if (!editing) didInit.current = false
  }, [editing, partition.name])

  const submit = () => {
    const trimmed = draft.trim()
    // 交付给父层：父层会清 editing 状态并走五步保护。
    // 空输入或与原名相同 → 视为取消，交给 onCancelEdit 清位（不再像旧版直接静默返回）
    if (trimmed && trimmed !== partition.name) onRename?.(partition.id, trimmed)
    else onCancelEdit?.(partition.id)
  }

  return (
    <div
      {...{ [PARTITION_ID_ATTR]: partition.id, 'data-canvas-item': '' }}
      ref={(element) => registerEl?.(partition.id, element)}
      className={cn(
        'group absolute left-0 top-0 rounded-lg border will-change-transform',
        // 选中高亮：主色描边（Ctrl+V 粘贴目标的视觉反馈）
        selected && 'ring-2 ring-primary ring-offset-0',
      )}
      style={{
        width: `${partition.w}px`,
        height: `${height}px`,
        transform: `translate3d(${partition.x}px, ${partition.y}px, 0)`,
        borderColor: selected ? undefined : `${color}66`,
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
          双击标题条空白都生效），折叠按钮单独拦掉 dblclick。
          双击经 onBeginEdit 通知父层置位 editingPartitionId —— 与右键菜单「重命名分区」
          共用同一编辑态（2026-09-14 修复，单一数据源） */}
      <div
        className="flex h-8 items-center gap-1 rounded-t-lg px-2"
        style={{ backgroundColor: `${color}40` }}
        onDoubleClick={() => onBeginEdit?.(partition.id)}
      >
        <button
          type="button"
          // ⚠️ 按钮要拦住按下事件，避免触发框拖动 / 画布平移；
          //    也要拦住双击，避免「连点折叠按钮」误入改名状态
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onClick={() => onToggleCollapsed?.(partition.id)}
          className={cn(
            // 2026-09-12 用户裁决：随分区名字号一起放大（h-5/11px → h-6/12px），保持比例协调
            'flex h-6 w-6 shrink-0 items-center justify-center rounded text-[12px] leading-none',
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
              if (event.key === 'Escape') onCancelEdit?.(partition.id)
            }}
            onBlur={submit}
            // 字号与显示态一致（text-[17px]），改名时不会跳动
            className="min-w-0 flex-1 rounded border border-border bg-background px-1 py-0.5 text-[17px] outline-none"
            autoFocus
          />
        ) : (
          <span
            // select-none：双击是改名手势，别让浏览器顺手选中文字。
            // 2026-09-12 用户裁决：调大文件夹名字号（13px → 15px → 17px）更醒目；
            // 标题条仍是 PARTITION_TITLE_HEIGHT(32px)，17px 行盒（≈24px）放得下，不遮挡
            className="min-w-0 flex-1 cursor-text select-none truncate text-[17px] font-medium text-foreground/90"
            title={`${partition.name}（双击改名）`}
          >
            {partition.name}
          </span>
        )}
      </div>
    </div>
  )
}
