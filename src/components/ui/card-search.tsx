// ============================================================================
// 模块说明（中文）
// 画布搜索浮层（P1-3）：Ctrl+F 唤出，输入关键字 → 显示命中数 → 在命中项之间跳转。
//
// 职责边界：
//   · 本组件是**纯展示 + 事件转发**：匹配（matchCards）、跳转（CanvasApi.centerOn）、
//     选中（onSelectCards）都在 Board 层；命中数据由 Board 整形好传进来（CardSearchItem）；
//   · 键盘：Enter / ↓ 下一个，Shift+Enter / ↑ 上一个，Esc 关闭 —— 全部在浮层内
//     stopPropagation，避免画布的全局快捷键（Ctrl+A 全选卡片、Esc 取消选中、
//     Delete 移除卡片）在「用户其实是在输入框里打字」时误触发；
//   · 定位交给 panelClassName（同 settings-panel 的做法），画布页传顶部居中。
// ============================================================================

import { useEffect, useRef } from 'react'

import type { CardSearchItem } from '@/core/board/search'
import { cn } from '@/lib/utils'
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  SearchIcon,
} from './icons'
import { Button } from './button'

export interface CardSearchPanelProps {
  open: boolean
  query: string
  /** Board 整形好的命中条目（title / 标签 / 摘录） */
  items: CardSearchItem[]
  /** 当前跳转目标下标；-1 表示还没有当前项 */
  activeIndex: number
  /** 定位类（如 `left-1/2 top-3 -translate-x-1/2`）；宽度和外观由本组件固定 */
  panelClassName?: string
  onQueryChange: (value: string) => void
  /** ±1 在命中项之间移动（回绕逻辑在 Board） */
  onStep: (delta: number) => void
  /** 点击结果列表里的某一项 */
  onPick: (index: number) => void
  onClose: () => void
}

export function CardSearchPanel({
  open,
  query,
  items,
  activeIndex,
  panelClassName = '',
  onQueryChange,
  onStep,
  onPick,
  onClose,
}: CardSearchPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const activeRowRef = useRef<HTMLButtonElement | null>(null)

  // 打开时聚焦并全选既有词（再次 Ctrl+F 可以直接改词）；关闭后交还焦点给画布
  useEffect(() => {
    if (open) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [open])

  // 当前项变化（含键盘跳转）时把对应结果滚进可视区
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  if (!open) return null

  const hasActive = activeIndex >= 0 && activeIndex < items.length

  return (
    // onKeyDown 挂在根上：焦点落在结果按钮上时 Esc 也能关掉浮层（stopPropagation 不让画布收到）
    <div
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          event.preventDefault()
          onClose()
        }
      }}
      className={cn(
        'absolute z-30 w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-card shadow-lg',
        panelClassName,
      )}
    >
      {/* 输入行：放大镜 + 输入框 + 计数 + 上一个/下一个/关闭 */}
      <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-2">
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索文件名、便签正文或分区名"
          aria-label="搜索卡片"
          spellCheck={false}
          // 输入框内按下的键一律不再传给画布：Ctrl+A 要全选输入框文本而不是全选卡片
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              onStep(event.shiftKey ? -1 : 1)
              return
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              onStep(1)
              return
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              onStep(-1)
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {items.length === 0 ? '0 项' : hasActive ? `${activeIndex + 1} / ${items.length}` : `${items.length} 项`}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          title="上一个（Shift+Enter）"
          aria-label="上一个命中"
          disabled={!hasActive}
          onClick={() => onStep(-1)}
        >
          <ChevronUpIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          title="下一个（Enter）"
          aria-label="下一个命中"
          disabled={!hasActive}
          onClick={() => onStep(1)}
        >
          <ChevronDownIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          title="关闭（Esc）"
          aria-label="关闭搜索"
          onClick={onClose}
        >
          <CloseIcon />
        </Button>
      </div>

      {/* 结果列表：命中条目 + 命中字段徽标 + 便签摘录 */}
      <div className="max-h-56 overflow-y-auto p-1" role="listbox" aria-label="搜索结果">
        {items.length === 0 ? (
          <p className="px-2.5 py-3 text-xs text-muted-foreground">
            {query.trim() === '' ? '输入关键字，按 Enter 在命中项之间跳转' : '没有匹配的卡片'}
          </p>
        ) : (
          items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              ref={index === activeIndex ? activeRowRef : undefined}
              onClick={() => onPick(index)}
              className={cn(
                'flex w-full flex-col items-start gap-0.5 rounded px-2.5 py-1.5 text-left',
                index === activeIndex ? 'bg-accent' : 'hover:bg-accent/50',
              )}
            >
              <span className="flex w-full items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{item.title}</span>
                {item.fieldLabels.map((label) => (
                  <span
                    key={label}
                    className="shrink-0 rounded border border-border px-1 text-[10px] leading-4 text-muted-foreground"
                  >
                    {label}
                  </span>
                ))}
              </span>
              {item.excerpt !== '' ? (
                <span className="w-full truncate text-xs text-muted-foreground">{item.excerpt}</span>
              ) : null}
            </button>
          ))
        )}
      </div>
    </div>
  )
}
