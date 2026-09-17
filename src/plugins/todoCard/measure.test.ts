// ============================================================================
// 模块说明（中文）
// 几何测量（measure.ts）的单元测试。
//
// 为什么值得测：这组函数是「长文本换行」修复的地基 —— 一旦锚点算错，
// 连线点就会整排偏离条目；一旦幂等判定失效，卡片就会陷入「改高度 → 触发
// 测量 → 再改高度」的自激循环（表现为卡片持续抖动）。而 DOM 只在浏览器里跑，
//  项目又不引 jsdom，所以可靠的做法就是把 DOM 依赖注入进来，
//  测试用鸭子类型假对象顶上。
// ============================================================================

import { describe, expect, it } from 'vitest'

import {
  GEOMETRY_TOLERANCE,
  measureTodoRows,
  needsGeometrySync,
  todoGeometryOf,
} from './measure'
import type { TodoRootElement } from './measure'
import { TODO_MIN_HEIGHT, TODO_PAD_BOTTOM } from './todos'

/** 造假行：够 measureTodoRows 读就行（dataset + offsetTop + offsetHeight） */
function fakeRow(id: string | undefined, top: unknown, height: unknown) {
  return {
    dataset: id === undefined ? {} : { todoRow: id },
    offsetTop: top,
    offsetHeight: height,
  }
}

/** 造假容器：把行塞进 querySelectorAll 的返回里 */
function fakeRoot(rows: ReturnType<typeof fakeRow>[], offsetHeight: unknown = 0): TodoRootElement {
  return {
    querySelectorAll: () => rows,
    offsetHeight,
  } as unknown as TodoRootElement
}

describe('measureTodoRows', () => {
  it('容器为空 / 没有 querySelectorAll 时返回空数组（不抛错）', () => {
    expect(measureTodoRows(null)).toEqual([])
    expect(measureTodoRows({})).toEqual([])
  })

  it('读出每一行的 id / top / height', () => {
    const rows = measureTodoRows(fakeRoot([fakeRow('t1', 10, 24), fakeRow('t2', 36, 48)]))
    expect(rows).toEqual([
      { id: 't1', top: 10, height: 24 },
      { id: 't2', top: 36, height: 48 },
    ])
  })

  it('脏行整行跳过：无 id / 未排版 / 数值非法（NaN 进 meta 会让连线全废）', () => {
    const rows = measureTodoRows(
      fakeRoot([
        fakeRow(undefined, 10, 24), // 无 id
        fakeRow('t2', Number.NaN, 24), // top 非法
        fakeRow('t3', 10, -1), // 负高度
        fakeRow('t4', Number.POSITIVE_INFINITY, 24), // 无穷大
        fakeRow('t5', '10' as unknown as number, 24), // 类型不对
        fakeRow('t6', 60, 24), // 唯一的合法行
      ]),
    )
    expect(rows).toEqual([{ id: 't6', top: 60, height: 24 }])
  })

  it('尚未排版（top/height 都是 0）的行也算合法（首帧就是 0，得让兜底逻辑接管）', () => {
    expect(measureTodoRows(fakeRoot([fakeRow('t1', 0, 0)]))).toEqual([{ id: 't1', top: 0, height: 0 }])
  })
})

describe('todoGeometryOf', () => {
  it('锚点 = 行垂直中心（连线点画在行右缘中点，必须重合）', () => {
    const { anchors } = todoGeometryOf(
      [
        { id: 't1', top: 10, height: 24 },
        { id: 't2', top: 36, height: 48 },
      ],
      200,
    )
    expect(anchors).toEqual({ t1: 22, t2: 60 })
  })

  it('换行后行变高，后续锚点自动跟着下移（这正是算术公式会算错的地方）', () => {
    const wrapped = todoGeometryOf(
      [
        { id: 't1', top: 10, height: 72 }, // 三行文本
        { id: 't2', top: 84, height: 24 },
      ],
      200,
    )
    expect(wrapped.anchors.t2).toBe(96)
    expect(wrapped.anchors.t2).not.toBe(22 + 24) // 不是固定步进
  })

  it('高度取内容自然高度', () => {
    expect(todoGeometryOf([{ id: 't1', top: 10, height: 24 }], 137).height).toBe(137)
  })

  it('容器未排版（高度 0）时退回「最后一行底部 + 下内边距」', () => {
    // 用多行数据：单行时会被最小卡片高度兜住，测不出这条回退公式
    const rows = [
      { id: 't1', top: 10, height: 24 },
      { id: 't2', top: 36, height: 72 },
    ]
    expect(todoGeometryOf(rows, 0).height).toBe(36 + 72 + TODO_PAD_BOTTOM)
  })

  it('任何情况下都不低于最小卡片高度（否则新建的空卡会被压成一条线）', () => {
    expect(todoGeometryOf([], 0).height).toBe(TODO_MIN_HEIGHT)
    expect(todoGeometryOf([], 4).height).toBe(TODO_MIN_HEIGHT)
    expect(todoGeometryOf([{ id: 't1', top: 0, height: 0 }], 0).height).toBe(TODO_MIN_HEIGHT)
  })

  it('半像素取整：锚点不会出现 22.500000000000004 这种浮点噪声', () => {
    const { anchors } = todoGeometryOf([{ id: 't1', top: 10.3333, height: 23.6667 }], 200)
    expect(anchors.t1).toBe(22)
  })
})

describe('needsGeometrySync（幂等闸门：防自激循环）', () => {
  const base = { height: 100, anchors: { t1: 22, t2: 60 } }

  it('完全一致 → 不需要同步（写入后再次测量不会继续写）', () => {
    expect(needsGeometrySync(base, { height: 100, anchors: { t1: 22, t2: 60 } })).toBe(false)
  })

  it('容差内的抖动忽略不及（亚像素级别的 offsetHeight 波动）', () => {
    const tolerance = GEOMETRY_TOLERANCE - 0.01
    expect(needsGeometrySync(base, { height: 100 + tolerance, anchors: { t1: 22, t2: 60 } })).toBe(false)
    expect(needsGeometrySync(base, { height: 100, anchors: { t1: 22 + tolerance, t2: 60 } })).toBe(false)
  })

  it('高度真的变了 → 同步（换行把卡片撑高）', () => {
    expect(needsGeometrySync(base, { height: 148, anchors: { t1: 22, t2: 60 } })).toBe(true)
  })

  it('某个锚点偏了 → 同步', () => {
    expect(needsGeometrySync(base, { height: 100, anchors: { t1: 22, t2: 88 } })).toBe(true)
  })

  it('锚点数量变了（增删条目）→ 同步', () => {
    expect(needsGeometrySync(base, { height: 100, anchors: { t1: 22 } })).toBe(true)
    expect(needsGeometrySync(base, { height: 100, anchors: { t1: 22, t2: 60, t3: 98 } })).toBe(true)
  })
})
