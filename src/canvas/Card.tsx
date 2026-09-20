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

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

import type { Card } from '@/core/types'
import { renderCard, resizeHandleModeFor } from '@/core/registry/cardTypes'
import { cn } from '@/lib/utils'
import { CANVAS_ITEM_ATTR } from './Viewport'

/** 标记「卡片 DOM」的属性：拖拽控制器靠它从事件目标反查卡片 id */
export const CARD_ID_ATTR = 'data-card-id'

/** 搜索命中态（P1-3）：`hit` = 命中但不是当前跳转目标，`active` = 当前跳转目标 */
export type CardSearchState = 'hit' | 'active'

export interface CardViewProps {
  card: Card
  selected: boolean
  /** 把 DOM 引用注册进父级的 Map<cardId, HTMLElement>（17.3） */
  registerEl?: (cardId: string, element: HTMLDivElement | null) => void
  /** 已移除视图（T2.8）：灰底淡入（7.2） */
  grayscale?: boolean
  /** 搜索命中高亮（P1-3）：虚线 = 命中，粗实线 = 当前跳转目标 */
  searchState?: CardSearchState
  /**
   * 便签行内编辑（用户要求替换弹窗）：true 时便签本体被一个同尺寸的
   * textarea 覆盖 —— 卡片盒子、样式、布局完全不动，只是文字变成可编辑。
   */
  noteEditing?: boolean
  /**
   * 结束行内编辑并交出草稿（textarea blur / Esc 触发）。
   * Canvas 收到后清编辑状态并转发持久化（命令 + 防抖落盘在 Board）。
   */
  onNoteEditFinish?: (cardId: string, value: string) => void
  /** 锁定卡片（2026-09-20）：位置与尺寸已冻结，光标与描边给出常态提示 */
  locked?: boolean
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

export function CardView({
  card,
  selected,
  registerEl,
  grayscale = false,
  searchState,
  noteEditing = false,
  onNoteEditFinish,
  locked = false,
}: CardViewProps) {
  // ---- 便签行内编辑（见 props 注释）。草稿放本组件：打字只重渲染这一张卡，
  //      不经过 Canvas / Board 的 state（画布其余部分零感知，17.3 反模式不沾边） ----
  const [noteDraft, setNoteDraft] = useState(card.note)
  const noteInputRef = useRef<HTMLTextAreaElement>(null)

  // 进入编辑时把草稿对齐为卡片当前内容（上次编辑后 card.note 可能已变）
  useEffect(() => {
    if (noteEditing) setNoteDraft(card.note)
  }, [noteEditing, card.note])

  // 进入编辑：聚焦并把光标放到末尾（继续往下写的直觉位置）
  useEffect(() => {
    if (!noteEditing) return
    const element = noteInputRef.current
    if (!element) return
    element.focus()
    element.setSelectionRange(element.value.length, element.value.length)
  }, [noteEditing])

  /** 结束编辑：交出草稿（是否真有改动、怎么入库由 Canvas → Board 判断） */
  const finishNoteEdit = () => {
    onNoteEditFinish?.(card.id, noteDraft)
  }

  /** 缩放手柄模式：default = 右下角（便签另有三边）；widthOnly = 仅左缘；
      widthHeight = 左缘 + 下缘（2026-09-18 待办卡，可拖高） */
  const resizeMode = resizeHandleModeFor(card.type)

  return (
    <div
      ref={(element) => {
        registerEl?.(card.id, element)
      }}
      {...{ [CANVAS_ITEM_ATTR]: '' }}
      {...{ [CARD_ID_ATTR]: card.id }}
      style={cardStyle(card)}
      className={cn(
        // group：给卡片内部的悬停态子元素一个锚点（图片卡的悬浮标记 hoverLabel
        // 靠 group-hover 淡入，见 core/registry/cardTypes.ts 的 hoverLabelChip）。
        // 用纯 CSS 而不是 React 悬停 state —— 悬停是高频事件，进 state 会触发重渲染（17.3）。
        'group absolute left-0 top-0 cursor-grab touch-none select-none rounded-sm bg-card shadow-sm',
        'transition-shadow hover:shadow-md',
        // 跳转目标用更粗的实线，盖过选中态的 2px 描边（两者同色，宽度不叠加以免粗细随类名顺序漂移）
        selected && searchState !== 'active' && 'outline outline-2 outline-primary',
        searchState === 'hit' && 'outline-dashed outline-2 outline-primary/70',
        searchState === 'active' && 'outline outline-4 outline-primary',
        // 锁定卡片（2026-09-20）：位置与尺寸已冻结 —— 光标不再显示「可抓」，
        // 并加一圈浅色虚边作为「已钉住」的常态提示（选择器在 Canvas 侧拦截手势）
        locked && 'cursor-default outline-dashed outline-1 outline-muted-foreground/40',
      )}
    >
      <div
        className="h-full w-full transition-opacity"
        style={grayscale ? { filter: 'grayscale(1)', opacity: 0.75 } : undefined}
      >
        {/* 编辑态把标记传进渲染层：renderNote 收到后不再画占位文字，
            避免透过 bg-transparent 的 textarea 与输入中的草稿重叠 */}
        {renderCard({ card, selected, noteEditing: noteEditing && card.type === 'note' })}
      </div>

      {/* 便签行内编辑：textarea 盖满卡片（inset-0），卡片盒子/样式/布局不变。
          字号行距内边距对齐便签正文（p-2 / text-[18px] / leading-relaxed），
          进出编辑不跳动。pointerdown / dblclick 必须拦下——否则会被画布
          当成拖拽手势（先例：Partition 改名输入框）。
          2026-09-13：data-note-editing 供 Canvas 的根事件分流早退（编辑态
          按下 = 选字/挪光标，不启动拖拽）；select-text 覆盖卡片根
          select-none 的继承（user-select 会被子元素继承，不加则选不中文字） */}
      {noteEditing && card.type === 'note' ? (
        <textarea
          ref={noteInputRef}
          {...{ 'data-note-editing': 'true' }}
          value={noteDraft}
          onChange={(event) => setNoteDraft(event.target.value)}
          onBlur={finishNoteEdit}
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            // 输入框内的按键不再传给画布：Esc 只退出编辑不取消选中、
            // Delete/Backspace 只改文字不移除卡片、Ctrl+A 只全选文本
            event.stopPropagation()
            if (event.key === 'Escape') {
              event.preventDefault()
              finishNoteEdit()
            }
          }}
          spellCheck={false}
          className="absolute inset-0 h-full w-full select-text resize-none rounded-sm border-0 bg-transparent p-2 text-[18px] leading-relaxed text-foreground outline-none"
        />
      ) : null}

      {/* 右下角缩放手柄（5.2：选中后拖右下角手柄）。11.6：仅在选中时出现。
          pointerdown 靠冒泡进入 Viewport 的原生监听，由 Canvas 分流到缩放控制器。
          2026-09-13：补 data-resize-edge="se"，Canvas 统一按 edge 分流。
          2026-09-17：widthOnly 模式（插件高度自适应卡片）不渲染本手柄 ——
          拖高会破坏插件按内容算好的高度 */}
      {selected && resizeMode === 'default' ? (
        <div
          data-resize-handle={card.id}
          data-resize-edge="se"
          className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-full border border-background bg-primary shadow-sm"
        />
      ) : null}

      {/* 便签三向缩放手柄（2026-09-13）：上 / 下 / 左边中点，自由缩放（不锁比例）。
          n / w 拖动时对边固定，位置联动由 cardResizeController 的 edgeResizeOutcome 处理。
          只有便签渲染边手柄 —— 图片必须锁原图比例，四向边缩放与等比约束冲突。
          2026-09-14：**移除右缘中点（e）手柄** —— 该位置让给连接手柄（见下），
          让便签与图片卡片的连线起点表现一致。宽度仍可用左缘中点、右下角手柄调整 */}
      {selected && card.type === 'note' ? (
        <>
          <div
            data-resize-edge="n"
            className="absolute -top-1.5 left-1/2 h-2 w-6 -translate-x-1/2 cursor-ns-resize rounded-full border border-background bg-primary shadow-sm"
          />
          <div
            data-resize-edge="s"
            className="absolute -bottom-1.5 left-1/2 h-2 w-6 -translate-x-1/2 cursor-ns-resize rounded-full border border-background bg-primary shadow-sm"
          />
          <div
            data-resize-edge="w"
            className="absolute -left-1.5 top-1/2 h-6 w-2 -translate-y-1/2 cursor-ew-resize rounded-full border border-background bg-primary shadow-sm"
          />
        </>
      ) : null}

      {/* 右缘中点连接手柄（T3.1：从边缘拖出箭头连到目标卡）。
          仅选中时出现；pointerdown 由 Canvas 分流到连线拖拽，不触发卡片拖动。
          2026-09-14：所有卡片类型统一在**右缘中点** —— 与连线锚点
          （connectionAnchor.rightAnchor：右缘中点）重合，拖出方向即连线走向。
          便签原先为避让 e 向缩放手柄放在右上角，现移除该手柄后回归一致 */}
      {selected ? (
        <div
          data-connect-handle={card.id}
          title="拖到目标卡片创建连线"
          className="absolute -right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 cursor-crosshair rounded-full border border-background bg-primary/80 shadow-sm hover:bg-primary"
        />
      ) : null}

      {/* 左缘中点宽度手柄（2026-09-17 起，widthOnly / widthHeight 模式）：
          widthOnly 只调宽 —— 高度由插件按内容自适应并经桥提交，不允许拖高；
          widthHeight（2026-09-18 待办卡）再补一个下缘高度手柄（见下）。
          w / s 边缩放复用便签同款控制器路径（edgeResizeOutcome），Canvas 零改动 */}
      {selected && (resizeMode === 'widthOnly' || resizeMode === 'widthHeight') ? (
        <div
          data-resize-edge="w"
          className="absolute -left-1.5 top-1/2 h-6 w-2 -translate-y-1/2 cursor-ew-resize rounded-full border border-background bg-primary shadow-sm"
        />
      ) : null}

      {/* 下缘中点高度手柄（2026-09-18 用户需求：待办卡支持拖拽调高）。
          仅 widthHeight 模式渲染；插件侧几何同步「只增不减」——
          拖高留出的空白不会被实测内容高度吃掉，内容长高时照常跟上 */}
      {selected && resizeMode === 'widthHeight' ? (
        <div
          data-resize-edge="s"
          className="absolute -bottom-1.5 left-1/2 h-2 w-6 -translate-x-1/2 cursor-ns-resize rounded-full border border-background bg-primary shadow-sm"
        />
      ) : null}
    </div>
  )
}
