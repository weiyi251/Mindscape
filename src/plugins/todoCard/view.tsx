// ============================================================================
// 模块说明（中文）
// 待办卡片的**界面**：条目行列表 + 底部添加行。
//
// 每一行 = 复选框 + 单行文本输入 + 删除按钮（悬停显形）+ 连线点。
// 交互与手感的关键决策（17.3 高频不进 state 的精神）：
//   · 文本输入是**非受控**的（defaultValue）：打字过程零重渲染，失焦 / 回车
//     才把整份条目列表经桥提交（updateCardContent，一条命令可撤销）；
//   · 复选框 / 删除是低频操作：onClick 直接提交；
//   · 连线点是原生 data-connect-handle / data-connect-item 标记 ——
//     pointerdown 由 Canvas 的根监听分流到连线拖拽控制器，本组件不挂任何事件。
//
// 高度自适应：条目增删后 commit 里重算 h（todoCardHeight），与 meta 一起原子
// 提交 —— 撤销时条目和高度一起回滚，不撕裂。
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'

import type { Card } from '@/core/types'
import type { PluginHostApi } from '@/core/plugin/types'
import { TODO_CARD_TEXT } from './text'
import {
  TODO_PAD_TOP,
  TODO_ROW_HEIGHT,
  TODO_ROW_STEP,
  metaWithTodos,
  newTodoItem,
  todoCardHeight,
  todosOfMeta,
} from './todos'
import type { TodoItem } from './todos'

export interface TodoCardViewProps {
  card: Card
  /** 宿主注入的完整 API（render 由 activate 闭包捕获传入 —— 插件不 import 宿主） */
  api: PluginHostApi
}

export function TodoCardView({ card, api }: TodoCardViewProps) {
  /** 本地条目状态是编辑期的真源；提交后与 card.meta.items 靠「上次提交指纹」对账 */
  const [items, setItems] = useState<TodoItem[]>(() => todosOfMeta(card.meta))
  const [draft, setDraft] = useState('')
  /** 最近一次本地提交的序列化指纹：区分「撤销 / 重做的外部变化」与「自己刚提交的」 */
  const lastCommittedRef = useRef(JSON.stringify(items))

  // 撤销 / 重做会让 card.meta.items 回到旧状态：只有当外部数据与最近一次本地
  // 提交不一致时才采纳（避免把用户正在编辑的内容冲掉）
  useEffect(() => {
    const incoming = JSON.stringify(todosOfMeta(card.meta))
    if (incoming !== lastCommittedRef.current) {
      lastCommittedRef.current = incoming
      setItems(todosOfMeta(card.meta))
    }
  }, [card.meta])

  /** 提交：条目 → meta（items + 锚点表成对写入）+ 自适应高度，一条命令入撤销栈 */
  const commit = useCallback(
    (next: TodoItem[]) => {
      lastCommittedRef.current = JSON.stringify(next)
      setItems(next)
      void api.board.updateCardContent({
        cardId: card.id,
        meta: metaWithTodos(card.meta, next),
        h: todoCardHeight(next.length),
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
    <div
      className="flex h-full w-full flex-col overflow-hidden rounded-sm bg-note/90"
      style={{ paddingTop: 10, paddingBottom: 10 }}
    >
      {items.map((item, index) => (
        <TodoRow
          key={`${item.id}:${item.text}`}
          cardId={card.id}
          item={item}
          // 行定位用绝对 top（锚点几何 = padTop + index × 行步进），保证连线点
          // 与 meta.itemAnchors 的表严格重合 —— flex 布局的间隔误差会累积
          top={TODO_PAD_TOP + index * TODO_ROW_STEP}
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
      <div
        className="flex items-center gap-1.5"
        style={{
          position: 'absolute',
          top: TODO_PAD_TOP + items.length * TODO_ROW_STEP,
          height: TODO_ROW_HEIGHT,
          left: 10,
          right: 10,
        }}
      >
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
          className="h-full w-full min-w-0 rounded bg-transparent px-1 text-[13px] text-foreground placeholder:text-muted-foreground/60 outline-none"
        />
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
  /** 行顶部相对卡片顶边的 y（= 10 + index × 行步进，与锚点几何同源） */
  top: number
  onToggle: () => void
  onTextChange: (text: string) => void
  onRemove: () => void
}

function TodoRow({ cardId, item, top, onToggle, onTextChange, onRemove }: TodoRowProps) {
  const committedRef = useRef(item.text)

  return (
    <div
      className="group/row flex items-center gap-1.5"
      style={{ position: 'absolute', top, height: TODO_ROW_HEIGHT, left: 10, right: 10 }}
    >
      {/* 复选框：完成态打勾 + 划线灰字（「标记为已完成状态」） */}
      <button
        type="button"
        data-card-interactive
        title={TODO_CARD_TEXT.toggleLabel}
        onClick={onToggle}
        className={`flex h-4 w-4 flex-none items-center justify-center rounded border text-[10px] leading-none transition-colors ${
          item.done
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-todo/70 bg-transparent text-transparent hover:border-primary'
        }`}
      >
        ✓
      </button>

      {/* 单行文本：非受控（打字零重渲染），失焦 / 回车提交；超出省略号 */}
      <input
        data-card-interactive
        defaultValue={item.text}
        onBlur={(event) => {
          const text = event.target.value.trim()
          if (text !== committedRef.current) {
            committedRef.current = text
            onTextChange(text)
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            event.currentTarget.blur()
          }
        }}
        spellCheck={false}
        className={`h-full w-full min-w-0 truncate rounded bg-transparent px-1 text-[13px] outline-none placeholder:text-muted-foreground/60 ${
          item.done ? 'text-muted-foreground line-through' : 'text-foreground'
        }`}
        placeholder={TODO_CARD_TEXT.addPlaceholder}
      />

      {/* 删除按钮：悬停显形（纯 CSS，高频安全） */}
      <button
        type="button"
        data-card-interactive
        title={TODO_CARD_TEXT.removeLabel}
        onClick={onRemove}
        className="flex h-4 w-4 flex-none items-center justify-center rounded text-[12px] leading-none text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover/row:opacity-100"
      >
        ×
      </button>

      {/* 条目连线点（「每个待办条目后面显示一个连线点」）：右缘、垂直居中。
          data-connect-handle + data-connect-item 由 Canvas 分流到连线拖拽，
          松手落到别的卡 / 条目上即创建 fromItem / toItem 连线（条目级） */}
      <div
        data-connect-handle={cardId}
        data-connect-item={item.id}
        title={TODO_CARD_TEXT.connectLabel}
        className="h-2.5 w-2.5 flex-none cursor-crosshair rounded-full border border-todo/60 bg-todo/40 transition-colors hover:bg-todo"
      />
    </div>
  )
}
