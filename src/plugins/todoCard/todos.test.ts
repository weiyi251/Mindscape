// ============================================================================
// 模块说明（中文）
// plugins/todoCard/todos.ts 的单元测试。
//
// 覆盖点：高度 / 锚点几何（行中心对齐连线点）、meta 读写往返、
// 脏数据兜底（绝不抛错）、id 递增不冲突、不改动入参（纯函数）。
// ============================================================================

import { describe, expect, it } from 'vitest'

import {
  TODO_DEFAULT_W,
  TODO_PAD_BOTTOM,
  TODO_PAD_TOP,
  TODO_ROW_HEIGHT,
  TODO_ROW_STEP,
  metaWithTodos,
  newTodoItem,
  todoCardHeight,
  todoItemAnchors,
  todosOfMeta,
} from './todos'

const SAMPLE = [
  { id: 't1', text: '买牛奶', done: false },
  { id: 't2', text: '写周报', done: true },
]

describe('todoCard 几何：高度与条目锚点', () => {
  it('高度 = 上边距 + 条目行（按步进）+ 添加行 + 下边距；空卡片也保留添加行', () => {
    expect(todoCardHeight(0)).toBe(TODO_PAD_TOP + TODO_ROW_HEIGHT + TODO_PAD_BOTTOM)
    expect(todoCardHeight(3)).toBe(
      TODO_PAD_TOP + 3 * TODO_ROW_STEP + TODO_ROW_HEIGHT + TODO_PAD_BOTTOM,
    )
    // 负数兜底：按 0 行算
    expect(todoCardHeight(-2)).toBe(todoCardHeight(0))
  })

  it('锚点按行中心算：第 i 行 = 上边距 + i × 行步进 + 行高/2（连线点在行右缘垂直中心）', () => {
    const anchors = todoItemAnchors(SAMPLE)
    expect(anchors.t1).toBe(TODO_PAD_TOP + TODO_ROW_HEIGHT / 2)
    expect(anchors.t2).toBe(TODO_PAD_TOP + TODO_ROW_STEP + TODO_ROW_HEIGHT / 2)
  })

  it('默认宽度是常量（创建卡片与测试共用同一份）', () => {
    expect(TODO_DEFAULT_W).toBeGreaterThan(0)
  })
})

describe('todoCard 数据：meta 读写', () => {
  it('metaWithTodos → todosOfMeta 往返一致，且 itemAnchors 成对写入', () => {
    const meta = metaWithTodos({}, SAMPLE)
    expect(todosOfMeta(meta)).toEqual(SAMPLE)
    expect(meta.itemAnchors).toEqual(todoItemAnchors(SAMPLE))
  })

  it('metaWithTodos 不改动入参（返回新对象），其余 meta 键保留', () => {
    const original = { hoverLabel: 'x' }
    const next = metaWithTodos(original, SAMPLE)
    expect(original).toEqual({ hoverLabel: 'x' })
    expect(next.hoverLabel).toBe('x')
    expect(next).not.toBe(original)
  })

  it('todosOfMeta 脏数据兜底：缺 items / 非数组 / 条目不合规都不抛错', () => {
    expect(todosOfMeta({})).toEqual([])
    expect(todosOfMeta({ items: '坏' })).toEqual([])
    expect(todosOfMeta({ items: [null, 42, { text: '没有 id' }] })).toEqual([])
    expect(todosOfMeta({ items: [{ id: 't1' }, { id: 't2', text: 123, done: '是' }] })).toEqual([
      { id: 't1', text: '', done: false },
      { id: 't2', text: '', done: false },
    ])
  })
})

describe('todoCard 数据：newTodoItem', () => {
  it('id 从现有 t<数字> 的最大值递增', () => {
    expect(newTodoItem(SAMPLE, '新任务')).toEqual({ id: 't3', text: '新任务', done: false })
  })

  it('中间被删除的号码允许复用（只要求卡片内唯一）', () => {
    const items = [
      { id: 't1', text: '甲', done: false },
      { id: 't4', text: '乙', done: false },
    ]
    expect(newTodoItem(items, '丙').id).toBe('t5')
    expect(newTodoItem([], '丁').id).toBe('t1')
  })
})
