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
  metaWithPlacement,
  metaWithTodos,
  metaWithTitle,
  newTodoItem,
  orderedTodoItems,
  placementOfMeta,
  reorderTodos,
  todoCardHeight,
  todoItemAnchors,
  titleOfMeta,
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

describe('todoCard 标题（2026-09-18 用户需求）', () => {
  it('titleOfMeta：非字符串 / 缺键返回空串；首尾空白裁掉', () => {
    expect(titleOfMeta({})).toBe('')
    expect(titleOfMeta({ title: 42 })).toBe('')
    expect(titleOfMeta({ title: '  周一清单  ' })).toBe('周一清单')
  })

  it('metaWithTitle：写入裁剪后的标题；空串删键（不留脏数据）；其余 meta 键保留', () => {
    expect(metaWithTitle({}, '清单').title).toBe('清单')
    expect('title' in metaWithTitle({ title: '旧' }, '  ')).toBe(false)
    const original = { hoverLabel: 'x' }
    const next = metaWithTitle(original, '新')
    expect(original).not.toHaveProperty('title')
    expect(next.hoverLabel).toBe('x')
  })
})

describe('todoCard 完成项排列（2026-09-18 用户需求）', () => {
  it('placementOfMeta：缺键 / 非法值兜底 none；bottom / top 正常读回', () => {
    expect(placementOfMeta({})).toBe('none')
    expect(placementOfMeta({ completedPlacement: '坏' })).toBe('none')
    expect(placementOfMeta({ completedPlacement: 'bottom' })).toBe('bottom')
    expect(placementOfMeta({ completedPlacement: 'top' })).toBe('top')
  })

  it('metaWithPlacement：none 删键（默认值不落盘）；其余键保留', () => {
    expect('completedPlacement' in metaWithPlacement({}, 'none')).toBe(false)
    expect(metaWithPlacement({ hoverLabel: 'x' }, 'bottom')).toEqual({
      hoverLabel: 'x',
      completedPlacement: 'bottom',
    })
  })

  it('orderedTodoItems：bottom 完成沉底、top 完成浮顶，组内相对次序稳定（稳定排序）', () => {
    const items = [
      { id: 't1', text: '甲', done: false },
      { id: 't2', text: '乙', done: true },
      { id: 't3', text: '丙', done: false },
      { id: 't4', text: '丁', done: true },
    ]
    expect(orderedTodoItems(items, 'none')).toEqual(items)
    expect(orderedTodoItems(items, 'bottom').map((item) => item.id)).toEqual(['t1', 't3', 't2', 't4'])
    expect(orderedTodoItems(items, 'top').map((item) => item.id)).toEqual(['t2', 't4', 't1', 't3'])
  })

  it('orderedTodoItems 不改动入参数组（渲染派生，数据顺序不动）', () => {
    const items = [
      { id: 't1', text: '甲', done: false },
      { id: 't2', text: '乙', done: true },
    ]
    orderedTodoItems(items, 'bottom')
    expect(items.map((item) => item.id)).toEqual(['t1', 't2'])
  })
})

describe('todoCard 拖动排序（2026-09-18 用户需求）', () => {
  it('reorderTodos：把 dragId 移到 targetId 位置，其余次序平移', () => {
    const items = [
      { id: 't1', text: '甲', done: false },
      { id: 't2', text: '乙', done: false },
      { id: 't3', text: '丙', done: false },
    ]
    expect(reorderTodos(items, 't1', 't3').map((item) => item.id)).toEqual(['t2', 't3', 't1'])
    expect(reorderTodos(items, 't3', 't1').map((item) => item.id)).toEqual(['t3', 't1', 't2'])
  })

  it('reorderTodos：同位置 / 找不到 id 时原样返回（不产生无意义的提交）', () => {
    const items = [
      { id: 't1', text: '甲', done: false },
      { id: 't2', text: '乙', done: false },
    ]
    expect(reorderTodos(items, 't1', 't1')).toEqual(items)
    expect(reorderTodos(items, 't9', 't2')).toEqual(items)
    expect(reorderTodos(items, 't1', 't9')).toEqual(items)
  })
})
