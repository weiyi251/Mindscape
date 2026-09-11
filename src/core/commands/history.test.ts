// ============================================================================
// 模块说明（中文）
// 撤销 / 重做栈的单元测试。对应 T0.8 验收标准：
//   ① push 55 条后栈长为 50
//   ② undo / redo 顺序正确
// ============================================================================

import { describe, expect, it } from 'vitest'
import type { Command } from './types'
import { HISTORY_LIMIT, History } from './history'

/** 造一条会把调用过程记进 log 的命令，便于断言执行顺序 */
function makeCommand(type: string, log: string[]): Command {
  return {
    type,
    do: () => {
      log.push(`do:${type}`)
    },
    undo: () => {
      log.push(`undo:${type}`)
    },
  }
}

/** 造一条异步命令，验证文件搬运这类耗时操作也能被正确串起来 */
function makeAsyncCommand(type: string, log: string[]): Command {
  return {
    type,
    do: async () => {
      await Promise.resolve()
      log.push(`do:${type}`)
    },
    undo: async () => {
      await Promise.resolve()
      log.push(`undo:${type}`)
    },
  }
}

describe('深度上限 50 步', () => {
  it('push 55 条后栈长为 50', () => {
    const history = new History()
    const log: string[] = []

    for (let i = 1; i <= 55; i += 1) {
      history.push(makeCommand(`c${i}`, log))
    }

    expect(history.getState()).toEqual({
      size: HISTORY_LIMIT, // 50
      undoDepth: 50,
      redoDepth: 0,
      index: 49,
    })
  })

  it('超出上限时丢弃的是最旧的记录，最近 50 条仍可逐步撤销', async () => {
    const history = new History()
    const log: string[] = []

    for (let i = 1; i <= 55; i += 1) {
      history.push(makeCommand(`c${i}`, log))
    }

    // 连续撤销 50 次，应依次回放 c55 → c6，且第 51 次撤销不再生效
    let undone = 0
    while (await history.undo()) undone += 1

    expect(undone).toBe(50)
    expect(log[0]).toBe('undo:c55')
    expect(log[49]).toBe('undo:c6')
    expect(log).not.toContain('undo:c5') // c1~c5 已被丢弃
    expect(history.canUndo()).toBe(false)
  })

  it('深度可自定义，非法值直接报错', () => {
    const small = new History(3)
    const log: string[] = []
    for (let i = 1; i <= 5; i += 1) small.push(makeCommand(`c${i}`, log))
    expect(small.getState().size).toBe(3)

    expect(() => new History(0)).toThrow()
    expect(() => new History(-1)).toThrow()
    expect(() => new History(1.5)).toThrow()
  })
})

describe('undo / redo 顺序', () => {
  it('撤销按后进先出，重做按原顺序回放', async () => {
    const history = new History()
    const log: string[] = []

    history.push(makeCommand('A', log))
    history.push(makeCommand('B', log))
    history.push(makeCommand('C', log))

    expect(history.getState()).toMatchObject({ size: 3, undoDepth: 3, redoDepth: 0 })

    await history.undo()
    await history.undo()
    expect(log).toEqual(['undo:C', 'undo:B'])
    expect(history.getState()).toMatchObject({ undoDepth: 1, redoDepth: 2 })

    await history.redo()
    await history.redo()
    expect(log).toEqual(['undo:C', 'undo:B', 'do:B', 'do:C'])
    expect(history.getState()).toMatchObject({ undoDepth: 3, redoDepth: 0 })
  })

  it('空栈时撤销、栈顶时重做都返回 false 且无副作用', async () => {
    const history = new History()
    const log: string[] = []

    expect(await history.undo()).toBe(false)
    expect(await history.redo()).toBe(false)

    history.push(makeCommand('A', log))
    expect(await history.redo()).toBe(false)

    await history.undo()
    expect(await history.undo()).toBe(false)
    expect(log).toEqual(['undo:A'])
  })

  it('撤销后产生新操作，会丢弃原重做分支', async () => {
    const history = new History()
    const log: string[] = []

    history.push(makeCommand('A', log))
    history.push(makeCommand('B', log))
    await history.undo() // 回到 A 之后
    expect(history.canRedo()).toBe(true)

    history.push(makeCommand('C', log))
    expect(history.canRedo()).toBe(false)
    expect(history.getState()).toMatchObject({ size: 2, undoDepth: 2 })

    await history.undo()
    await history.undo()
    expect(log).toEqual(['undo:B', 'undo:C', 'undo:A'])
  })

  it('推送第 55 条时也会丢弃重做分支与最旧记录', () => {
    const history = new History(5)
    const log: string[] = []
    for (let i = 1; i <= 5; i += 1) history.push(makeCommand(`c${i}`, log))

    return history.undo().then(() => {
      expect(history.canRedo()).toBe(true)
      history.push(makeCommand('new', log))
      expect(history.canRedo()).toBe(false)
      expect(history.getState().size).toBe(5)
    })
  })

  it('异步命令（涉及文件搬运）同样按顺序执行', async () => {
    const history = new History()
    const log: string[] = []

    history.push(makeAsyncCommand('移除', log))
    history.push(makeAsyncCommand('改名', log))

    await history.undo()
    await history.undo()
    await history.redo()

    expect(log).toEqual(['undo:改名', 'undo:移除', 'do:移除'])
  })
})

describe('execute / clear / 错误处理', () => {
  it('execute 会先执行 do() 再记录', async () => {
    const history = new History()
    const log: string[] = []

    await history.execute(makeCommand('移动', log))

    expect(log).toEqual(['do:移动'])
    expect(history.getState().size).toBe(1)
    expect(history.canUndo()).toBe(true)
  })

  it('undo 抛错时不推进指针，状态保持一致', async () => {
    const history = new History()
    const failing: Command = {
      type: '会失败',
      do: () => {},
      undo: () => {
        throw new Error('文件被占用')
      },
    }
    history.push(failing)

    await expect(history.undo()).rejects.toThrow('文件被占用')
    expect(history.canUndo()).toBe(true) // 仍可重试
    expect(history.getState().index).toBe(0)
  })

  it('redo 抛错时指针回退，可重试', async () => {
    const history = new History()
    let shouldFail = false
    const flaky: Command = {
      type: '会失败',
      do: () => {
        if (shouldFail) throw new Error('写盘失败')
      },
      undo: () => {},
    }
    history.push(flaky)
    await history.undo()

    shouldFail = true
    await expect(history.redo()).rejects.toThrow('写盘失败')
    expect(history.canRedo()).toBe(true)
    expect(history.getState().index).toBe(-1)
  })

  it('clear() 清空历史（对应「仅本次运行期间有效」的切换空间场景）', async () => {
    const history = new History()
    const log: string[] = []
    history.push(makeCommand('A', log))
    await history.undo()

    history.clear()

    expect(history.getState()).toEqual({ size: 0, undoDepth: 0, redoDepth: 0, index: -1 })
    expect(history.canUndo()).toBe(false)
    expect(history.canRedo()).toBe(false)
  })
})
