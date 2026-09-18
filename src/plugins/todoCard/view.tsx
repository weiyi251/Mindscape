// ============================================================================
// 模块说明（中文）
// 待办卡片的**界面**：条目行列表 + 底部添加行。
//
// 每一行 = 拖拽手柄 + 序号 + 复选框 + 多行文本 + 删除按钮（悬停显形）+ 连线点。
// 交互与手感的关键决策（17.3 高频不进 state 的精神）：
//   · 文本是非受控的（defaultValue）：打字过程零重渲染，失焦 / Esc
//     才把整份条目列表经桥提交（updateCardContent，一条命令可撤销）；
//   · 复选框 / 删除是低频操作：onClick 直接提交；
//   · 连线点是原生 data-connect-handle / data-connect-item 标记 ——
//     pointerdown 由 Canvas 的根监听分流到连线拖拽控制器，本组件不挂任何事件。
//
// 2026-09-18 用户需求五连（与 todos.ts 的纯函数配套）：
//   · 标题 —— meta.title，单击标题行进入行内编辑（Enter / 失焦提交、Esc 放弃）；
//   · 自动编号 —— 按显示顺序渲染 index，增删 / 重排 / 完成置底后自动跟着变；
//   · 拖动排序 —— 行首手柄 setPointerCapture，拖动中本地预览（setItems），
//     松手才经 updateCardContent 提交（一条命令入撤销栈）；重排纯函数 reorderTodos
//     在 todos.ts 可独立单测，本组件只留 DOM 胶水；
//   · 完成项置底 / 置顶 —— 显示顺序 = orderedTodoItems(items, placement) 的
//     渲染派生，数据顺序不动（切回「不重排」即还原）；
//   · 拖拽调高 —— s 手柄改 card.h（宿主侧 edgeResizeOutcome），几何同步改为
//     「高度只增不减」：实测值小于用户设定时不写小，内容长高时照常跟上。
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
import {
  TODO_PAD_TOP,
  TODO_PAD_BOTTOM,
  metaWithTitle,
  metaWithTodos,
  newTodoItem,
  orderedTodoItems,
  placementOfMeta,
  reorderTodos,
  titleOfMeta,
  todosOfMeta,
} from './todos'
import type { TodoCompletedPlacement, TodoItem } from './todos'

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
  /** 内容层：条目区，flex-1 占满卡片剩余高度（行均分拉伸，见 JSX 注释） */
  const contentRef = useRef<HTMLDivElement>(null)

  // ---- 标题（2026-09-18 用户需求）：点击标题行进入行内编辑（与便签同一交互语言）----
  const [titleEditing, setTitleEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)

  // ---- 拖动排序（2026-09-18 用户需求）：拖动中先在本地 state 预览，松手才提交 ----
  const [dragId, setDragId] = useState<string | null>(null)

  // 撤销 / 重做会让 card.meta.items 回到旧状态：只有当外部数据与最近一次本地
  // 提交不一致时才采纳（避免把用户正在编辑的内容冲掉）
  useEffect(() => {
    const incoming = JSON.stringify(todosOfMeta(card.meta))
    if (incoming !== lastCommittedRef.current) {
      lastCommittedRef.current = incoming
      setItems(todosOfMeta(card.meta))
    }
  }, [card.meta])

  // 标题进入编辑时聚焦并全选（与分区改名同一手感）
  useEffect(() => {
    if (!titleEditing) return
    const element = titleInputRef.current
    if (!element) return
    element.focus()
    element.select()
  }, [titleEditing])

  /**
   * 几何同步：把「实测到的行位置与内容高度」写回画布。
   * 三条触发路径都收敛到这里 —— 文本换行、条目增删、卡片宽度变化（拖手柄）。
   *
   * 【高度只增不减】（2026-09-18 用户需求：待办卡支持拖拽调高）：
   * 用户拖 s 手柄调高卡片后，card.h 大于内容自然高度 —— 此时实测值**不得**把
   * 高度写小（那会立即吃掉用户留出的空白，手柄等于白拖）。目标高度取
   * max(实测, 当前)：内容长高时照常跟上，内容变矮时保持用户设定。
   */
  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    let frame = 0

    const sync = () => {
      frame = 0
      // 先让输入框贴合内容行数，再量 —— 顺序反了会量到上一帧的旧高度
      growAllTextareas(content)
      // 兜底高度用条目区分配高度（flex-1 锁定值）：内容不足时行被拉伸回填，
      // 高度不写小（用户拖高留白属于意图）；内容超出时行溢出，行底边主导写高
      const next = todoGeometryOf(measureTodoRows(content), content.offsetHeight)
      const height = Math.max(next.height, card.h)
      // 幂等闸门：值没变就不写。少了它，「写入 → 重渲染 → 再测量」会变成自激循环
      if (!needsGeometrySync({ height: card.h, anchors: itemAnchorsOfMeta(card.meta) }, { height, anchors: next.anchors }))
        return
      void api.board.syncCardGeometry({
        cardId: card.id,
        h: height,
        itemAnchors: next.anchors,
      })
    }
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(sync)
    }

    // 观察条目区（宽度 / 分配高度）与每一行（换行、拉伸、增删都改行高）
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

  /**
   * 提交条目变化（一条命令入撤销栈）；高度不在这里管 —— 见模块说明。
   * meta 快照基于 card.meta 与本地 items 合成：标题 / 排列策略等其它键原样保留。
   */
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

  /** 提交标题 / 排列策略等「非条目」的 meta 变化（同样一条命令入撤销栈） */
  const commitMeta = useCallback(
    (patched: Record<string, unknown>) => {
      void api.board.updateCardContent({ cardId: card.id, meta: patched })
    },
    [api, card.id],
  )

  /** 追加一条（回车或失焦；空草稿忽略） */
  const addRow = useCallback(() => {
    const text = draft.trim()
    if (text === '') return
    commit([...items, newTodoItem(items, text)])
    setDraft('')
  }, [commit, draft, items])

  /** 标题提交：空串 = 清除标题（metaWithTitle 内部删键）；无变化不产生撤销记录 */
  const commitTitle = useCallback(() => {
    const next = titleDraft.trim()
    setTitleEditing(false)
    if (next === titleOfMeta(card.meta)) return
    commitMeta(metaWithTodos(metaWithTitle(card.meta, next), items))
  }, [commitMeta, titleDraft, card.meta, items])

  // 显示顺序：完成项按排列策略沉底 / 浮顶（数据顺序不动，重排是渲染派生）
  const placement: TodoCompletedPlacement = placementOfMeta(card.meta)
  const ordered = orderedTodoItems(items, placement)

  /** 拖动中：把被拖条目移到指针下方条目的位置（本地预览，松手才提交） */
  const handleDragMove = useCallback(
    (event: React.PointerEvent) => {
      if (dragId === null) return
      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest?.('[data-todo-row]')
      const targetId = target?.getAttribute?.('data-todo-row') ?? null
      if (targetId === null || targetId === dragId) return
      setItems((current) => reorderTodos(current, dragId, targetId))
    },
    [dragId],
  )

  /** 拖动结束：顺序真有变化才提交（一条命令入撤销栈） */
  const handleDragEnd = useCallback(() => {
    setDragId(null)
    const current = JSON.stringify(items)
    if (current !== lastCommittedRef.current) {
      lastCommittedRef.current = current
      void api.board.updateCardContent({
        cardId: card.id,
        meta: metaWithTodos(card.meta, items),
      })
    }
  }, [api, card.id, card.meta, items])

  return (
    // 外层 flex-col：标题行固定高，条目区 flex-1 占满剩余高度 ——
    // 用户拖高卡片后多出的空间由**所有条目行均分**（行 grow + basis-0），
    // 文本框随行一同拉伸（items-stretch）；内容超出时行不压缩（shrink-0），
    // 溢出被实测行底边捕获并写高卡片（见 measure.todoGeometryOf）。
    <div className="flex h-full w-full flex-col overflow-hidden rounded-sm bg-note/90">
      {/* 标题行（2026-09-18 用户需求）：有标题显示标题，无标题显示淡占位；
          单击进入行内编辑（data-card-interactive 让画布按下早退，不触发拖拽）。
          无论有无标题都常驻 —— 「点击哪里改标题」必须可发现 */}
      <div style={{ paddingTop: TODO_PAD_TOP, paddingLeft: 10, paddingRight: 10 }} className="flex-none">
        {titleEditing ? (
          <input
            ref={titleInputRef}
            data-card-interactive
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={commitTitle}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              // Enter 提交、Esc 放弃（恢复原值）—— 与分区改名同一套按键语言
              if (event.key === 'Enter') {
                event.preventDefault()
                commitTitle()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                setTitleDraft(titleOfMeta(card.meta))
                setTitleEditing(false)
              }
            }}
            spellCheck={false}
            placeholder={TODO_CARD_TEXT.titlePlaceholder}
            className="w-full select-text rounded bg-transparent text-[13px] font-semibold text-foreground outline-none placeholder:text-muted-foreground/50"
          />
        ) : (
          <button
            type="button"
            data-card-interactive
            data-todo-title
            title={TODO_CARD_TEXT.titleEditLabel}
            onClick={() => {
              setTitleDraft(titleOfMeta(card.meta))
              setTitleEditing(true)
            }}
            className={`w-full cursor-text select-none truncate rounded text-left text-[13px] font-semibold outline-none ${
              titleOfMeta(card.meta) === '' ? 'text-muted-foreground/50' : 'text-foreground'
            }`}
          >
            {titleOfMeta(card.meta) === ''
              ? TODO_CARD_TEXT.titlePlaceholder
              : titleOfMeta(card.meta)}
          </button>
        )}
      </div>

      {/* 条目区：flex-1 占满卡片剩余高度（min-h-0 锁定分配值、溢出裁切 ——
          均分的前提是容器高度确定）；行底边溢出时由实测写高卡片。
          拖动排序的 move / up 挂在这里（手柄 setPointerCapture 后
          事件仍派发到捕获元素，冒泡回本层） */}
      <div
        ref={contentRef}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
        className="flex min-h-0 flex-1 flex-col gap-[2px] overflow-hidden"
        style={{
          paddingTop: 4,
          paddingBottom: TODO_PAD_BOTTOM,
          paddingLeft: 10,
          paddingRight: 10,
        }}
      >
        {ordered.map((item, index) => (
          <TodoRow
            key={item.id}
            cardId={card.id}
            item={item}
            index={index + 1}
            dragging={dragId === item.id}
            dragBlocked={dragId !== null && dragId !== item.id}
            onDragStart={(id) => setDragId(id)}
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

        {/* 底部添加行：＋ 号 + 占位输入，回车 / 失焦提交；不参与均分（flex-none） */}
        <div className="flex min-h-6 flex-none items-center gap-1.5">
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
  /** 显示序号（1 起）：按显示顺序编号，增删 / 重排 / 完成置底后自动跟着变 */
  index: number
  /** 本条目正在被拖动（半透明示意） */
  dragging: boolean
  /** 其它条目正在被拖动（本行的手柄暂不响应，避免一次拖出两条） */
  dragBlocked: boolean
  onDragStart: (id: string) => void
  onToggle: () => void
  onTextChange: (text: string) => void
  onRemove: () => void
}

function TodoRow({
  cardId,
  item,
  index,
  dragging,
  dragBlocked,
  onDragStart,
  onToggle,
  onTextChange,
  onRemove,
}: TodoRowProps) {
  const committedRef = useRef(item.text)

  /** 手柄按下：捕获指针并进入拖动（move / up 由条目区容器统一处理） */
  const handleDragPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragBlocked || event.button !== 0) return
    event.stopPropagation()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // 忽略：元素已移除等场景
    }
    onDragStart(item.id)
  }

  return (
    // data-todo-row 供几何测量按 id 检索（行不再是固定高度，位置必须实测）；
    // 拖动排序也靠它把指针下的元素反查成条目 id
    <div
      data-todo-row={item.id}
      // grow + basis-0：条目区有多余空间时**所有行均分**（拖高手柄调高后
      // 文本框跟着拉伸）；shrink-0：空间不足时行保持内容高度（溢出由实测
      // 行底边捕获并写高卡片），min-h-6 保底不压扁
      className={`group/row flex min-h-6 grow shrink-0 basis-0 items-stretch gap-1.5 ${dragging ? 'opacity-40' : ''}`}
    >
      {/* 拖拽排序手柄（2026-09-18 用户需求）：六个点示意可拖；悬停显形。
          data-card-interactive 让画布按下早退（拖手柄不是拖卡片）；
          setPointerCapture 后 move / up 冒泡回条目区容器处理 */}
      <div
        data-card-interactive
        data-todo-drag
        title={TODO_CARD_TEXT.dragLabel}
        onPointerDown={handleDragPointerDown}
        className="mt-1 flex h-4 w-3 flex-none cursor-grab touch-none flex-col items-center justify-center gap-[2px] opacity-0 transition-opacity group-hover/row:opacity-60"
      >
        <span className="h-px w-2 rounded bg-current" />
        <span className="h-px w-2 rounded bg-current" />
        <span className="h-px w-2 rounded bg-current" />
      </div>

      {/* 自动序号（2026-09-18 用户需求）：固定宽度右对齐，两位数也不挤位；
          muted 弱化 —— 编号是导航辅助，不该与正文抢注意力 */}
      <span className="mt-1 w-4 flex-none select-none text-right text-[11px] leading-4 text-muted-foreground/70">
        {index}
      </span>

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

        {/* 多行文本：非受控（打字零重渲染），失焦 / Esc 提交；换行由 CSS 负责。
            min-h-full + autoGrow：行被 flex 均分拉伸时文本框跟随行高（拉伸态），
            行高不足内容时 autoGrow 撑高行并触发卡片增高（内容态） */}
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
          className={`min-h-full min-w-0 flex-1 resize-none select-text overflow-hidden whitespace-pre-wrap break-words rounded bg-transparent px-1 py-0.5 text-[13px] leading-5 outline-none placeholder:text-muted-foreground/60 ${
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
