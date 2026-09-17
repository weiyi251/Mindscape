// ============================================================================
// 模块说明（中文）
// 待办卡片的**界面**：条目行列表 + 底部添加行。
//
// 每一行 = 复选框 + 多行文本 + 删除按钮（悬停显形）+ 连线点。
// 交互与手感的关键决策（17.3 高频不进 state 的精神）：
//   · 文本是非受控的（defaultValue）：打字过程零重渲染，失焦 / Esc
//     才把整份条目列表经桥提交（updateCardContent，一条命令可撤销）；
//   · 复选框 / 删除是低频操作：onClick 直接提交；
//   · 连线点是原生 data-connect-handle / data-connect-item 标记 ——
//     pointerdown 由 Canvas 的根监听分流到连线拖拽控制器，本组件不挂任何事件。
//
// 【为什么改成实测驱动】（2026-09-18 修复「长文本被截断、不换行」）
//   条目文本支持多行换行后行高不再恒定，任何「行数 × 步进」的算术都会与真实渲染
//   错位。于是布局改为：
//     ① 输入框（textarea）按内容自动增高（scrollHeight 直写 DOM，不进 state）；
//     ② 内容层是文档流，行自然排布；
//     ③ 用 ResizeObserver 盯住「内容层高度 + 每一行高度」，变化后实测
//        （measure.ts）并调 api.board.syncCardGeometry 把高度与锚点写回画布。
//   高度不在提交（commit）里处理：它是布局的派生结果，不是用户动作 ——
//   撤销 / 重做回滚 meta 后行数自然变化，这条通道会自动把高度纠正回来。
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'

import { itemAnchorsOfMeta } from '@/core/board/cardMeta'
import type { Card } from '@/core/types'
import type { PluginHostApi } from '@/core/plugin/types'
import { measureTodoRows, needsGeometrySync, todoGeometryOf } from './measure'
import { TODO_CARD_TEXT } from './text'
import { TODO_PAD_TOP, TODO_PAD_BOTTOM, metaWithTodos, newTodoItem, todosOfMeta } from './todos'
import type { TodoItem } from './todos'

export interface TodoCardViewProps {
  card: Card
  /** 宿主注入的完整 API（render 由 activate 闭包捕获传入 —— 插件不 import 宿主） */
  api: PluginHostApi
}

// ---------------------------------------------------------------------------
// 输入框自适应高度（纯 DOM 操作，不走 React state）
// ---------------------------------------------------------------------------

/**
 * 让 textarea 的高度贴合内容：先把 height 置 auto 才能量出「内容真正需要多高」，
 * 再把 scrollHeight 写回去（Tailwind 的 border-box 保证此处不需要减 padding）。
 */
function autoGrow(el: HTMLTextAreaElement): void {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

/**
 * 批量重算容器内所有输入框的高度。
 * 卡片被拖窄 → 同一句话占的行数变多 → 每一行的输入框都要重新贴合。
 */
function growAllTextareas(root: Element | null): void {
  if (!root) return
  for (const node of Array.from(root.querySelectorAll('textarea'))) {
    autoGrow(node as HTMLTextAreaElement)
  }
}

// ---------------------------------------------------------------------------
// 卡片主体
// ---------------------------------------------------------------------------

export function TodoCardView({ card, api }: TodoCardViewProps) {
  /** 本地条目状态是编辑期的真源；提交后与 card.meta.items 靠「上次提交指纹」对账 */
  const [items, setItems] = useState<TodoItem[]>(() => todosOfMeta(card.meta))
  const [draft, setDraft] = useState('')
  /** 最近一次本地提交的序列化指纹：区分「撤销 / 重做的外部变化」与「自己刚提交的」 */
  const lastCommittedRef = useRef(JSON.stringify(items))
  /** 内容层：它的自然高度就是卡片应有的高度（外层固定 card.h，会裁切） */
  const contentRef = useRef<HTMLDivElement>(null)

  // 撤销 / 重做会让 card.meta.items 回到旧状态：只有当外部数据与最近一次本地
  // 提交不一致时才采纳（避免把用户正在编辑的内容冲掉）
  useEffect(() => {
    const incoming = JSON.stringify(todosOfMeta(card.meta))
    if (incoming !== lastCommittedRef.current) {
      lastCommittedRef.current = incoming
      setItems(todosOfMeta(card.meta))
    }
  }, [card.meta])

  /**
   * 几何同步：把「实测到的行位置与内容高度」写回画布。
   * 三条触发路径都收敛到这里 —— 文本换行、条目增删、卡片宽度变化（拖手柄）。
   */
  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    let frame = 0

    const sync = () => {
      frame = 0
      // 先让输入框贴合当前宽度下的行数，再量 —— 顺序反了会量到上一帧的旧高度
      growAllTextareas(content)
      const next = todoGeometryOf(measureTodoRows(content), content.offsetHeight)
      // 幂等闸门：值没变就不写。少了它，「写入 → 重渲染 → 再测量」会变成自激循环
      if (!needsGeometrySync({ height: card.h, anchors: itemAnchorsOfMeta(card.meta) }, next)) return
      void api.board.syncCardGeometry({
        cardId: card.id,
        h: next.height,
        itemAnchors: next.anchors,
      })
    }
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(sync)
    }

    // 观察内容层（宽度 / 总高）与每一行（某行换行后变高）—— 两者缺一不可
    const observer = new ResizeObserver(schedule)
    observer.observe(content)
    for (const row of Array.from(content.querySelectorAll('[data-todo-row]'))) {
      observer.observe(row)
    }
    schedule()
    return () => {
      observer.disconnect()
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [api, card.id, card.h, card.meta, items])

  /** 提交条目变化（一条命令入撤销栈）；高度不在这里管 —— 见模块说明 */
  const commit = useCallback(
    (next: TodoItem[]) => {
      lastCommittedRef.current = JSON.stringify(next)
      setItems(next)
      void api.board.updateCardContent({
        cardId: card.id,
        meta: metaWithTodos(card.meta, next),
      })
    },
    [api, card.id, card.meta],
  )

  /** 追加一条（回车或失焦；空草稿忽略） */
  const addRow = useCallback(() => {
    const text = draft.trim()
    if (text === '') return
    commit([...items, newTodoItem(items, text)])
    setDraft('')
  }, [commit, draft, items])

  return (
    <div className="h-full w-full overflow-hidden rounded-sm bg-note/90">
      {/* 内容层：文档流，行随文本内容自然增高；padding 放在这里，
          于是 offsetHeight 天然等于「卡片应有的高度」（外层不设 padding） */}
      <div
        ref={contentRef}
        className="flex flex-col gap-[2px]"
        style={{
          paddingTop: TODO_PAD_TOP,
          paddingBottom: TODO_PAD_BOTTOM,
          paddingLeft: 10,
          paddingRight: 10,
        }}
      >
        {items.map((item) => (
          <TodoRow
            key={`${item.id}:${item.text}`}
            cardId={card.id}
            item={item}
            onToggle={() =>
              commit(items.map((entry) => (entry.id === item.id ? { ...entry, done: !entry.done } : entry)))
            }
            onTextChange={(text) =>
              commit(items.map((entry) => (entry.id === item.id ? { ...entry, text } : entry)))
            }
            onRemove={() => {
              commit(items.filter((entry) => entry.id !== item.id))
            }}
          />
        ))}

        {/* 底部添加行：＋ 号 + 占位输入，回车 / 失焦提交 */}
        <div className="flex min-h-6 items-center gap-1.5">
          <span className="flex h-4 w-4 flex-none items-center justify-center rounded border border-dashed border-todo/70 text-[10px] leading-none text-todo/80">
            +
          </span>
          <input
            data-card-interactive
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addRow()
              }
            }}
            onBlur={addRow}
            placeholder={TODO_CARD_TEXT.addPlaceholder}
            spellCheck={false}
            className="h-full w-full min-w-0 select-text rounded bg-transparent px-1 text-[13px] text-foreground placeholder:text-muted-foreground/60 outline-none"
          />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 单个条目行
// ---------------------------------------------------------------------------

interface TodoRowProps {
  cardId: string
  item: TodoItem
  onToggle: () => void
  onTextChange: (text: string) => void
  onRemove: () => void
}

function TodoRow({ cardId, item, onToggle, onTextChange, onRemove }: TodoRowProps) {
  const committedRef = useRef(item.text)

  return (
    // data-todo-row 供几何测量按 id 检索（行不再是固定高度，位置必须实测）
    <div data-todo-row={item.id} className="group/row flex min-h-6 items-stretch gap-1.5">
      {/* 复选框：完成态打勾 + 划线灰字（「标记为已完成状态」）。
          顶部对齐第一行文本（mt-1 = 4px ≈ 行内文字首行的中线偏移） */}
      <button
        type="button"
        data-card-interactive
        title={TODO_CARD_TEXT.toggleLabel}
        onClick={onToggle}
        className={`mt-1 h-4 w-4 flex-none self-start rounded border text-[10px] leading-none transition-colors ${
          item.done
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-todo/70 bg-transparent text-transparent hover:border-primary'
        }`}
      >
        ✓
      </button>

      {/* 多行文本：非受控（打字零重渲染），失焦 / Esc 提交；换行由 CSS 负责，
          高度由 autoGrow 贴合内容（rows=1 起步，长文本自动长高） */}
      <textarea
        data-card-interactive
        rows={1}
        defaultValue={item.text}
        onBlur={(event) => {
          const text = event.target.value.trim()
          if (text !== committedRef.current) {
            committedRef.current = text
            onTextChange(text)
          }
        }}
        onKeyDown={(event) => {
          // Enter 现在是换行（不再抢去提交）；Esc 收工
          if (event.key === 'Escape') event.currentTarget.blur()
        }}
        spellCheck={false}
        placeholder={TODO_CARD_TEXT.addPlaceholder}
        className={`min-h-6 min-w-0 flex-1 resize-none select-text overflow-hidden whitespace-pre-wrap break-words rounded bg-transparent px-1 py-0.5 text-[13px] leading-5 outline-none placeholder:text-muted-foreground/60 ${
          item.done ? 'text-muted-foreground line-through' : 'text-foreground'
        }`}
      />

      {/* 删除按钮：悬停显形（纯 CSS，高频安全） */}
      <button
        type="button"
        data-card-interactive
        title={TODO_CARD_TEXT.removeLabel}
        onClick={onRemove}
        className="mt-1 flex h-4 w-4 flex-none self-start items-center justify-center rounded text-[12px] leading-none text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover/row:opacity-100"
      >
        ×
      </button>

      {/* 条目连线点（「每个待办条目后面显示一个连线点」）：右缘、**垂直居中**。
          self-center 让它始终落在「被内容撑高的行」的中点 —— 也就是输入框的
          竖直中间，多行换行后依然成立。
          data-connect-handle + data-connect-item 由 Canvas 分流到连线拖拽，
          松手落到别的卡 / 条目上即创建 fromItem / toItem 连线（条目级） */}
      <div
        data-connect-handle={cardId}
        data-connect-item={item.id}
        title={TODO_CARD_TEXT.connectLabel}
        className="h-2.5 w-2.5 flex-none cursor-crosshair self-center rounded-full border border-todo/60 bg-todo/40 transition-colors hover:bg-todo"
      />
    </div>
  )
}
