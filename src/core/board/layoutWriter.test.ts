// ============================================================================
// 模块说明（中文）
// 落盘调度器的单元测试。对应 17.6：
//   「内存态为准，防抖 500ms 落盘；窗口关闭前 / 切换空间前 / Ctrl+S 强制立即落盘」
//
// 实现任务：T1.6（阶段一）。
// ============================================================================

import { describe, it, expect, vi } from 'vitest'

import { LayoutWriter, LAYOUT_DEBOUNCE_MS, serializeLayout } from '@/core/board/layoutWriter'
import { createEmptyLayout } from '@/core/types'
import type { Layout } from '@/core/types'

/** 手动定时器：不自动触发，由测试显式 run */
function makeManualTimer() {
  const pending = new Map<number, () => void>()
  let nextId = 1

  return {
    setTimer: (fn: () => void) => {
      const id = nextId
      nextId += 1
      pending.set(id, fn)
      return id
    },
    clearTimer: (id: number) => {
      pending.delete(id)
    },
    pendingCount: () => pending.size,
    runAll: () => {
      while (pending.size > 0) {
        const [id, fn] = [...pending.entries()][0]
        pending.delete(id)
        fn()
      }
    },
  }
}

/** 造一份可变的 layout（每次 build 返回深拷贝，模拟真实内存态） */
function makeState(initial?: Partial<Layout>) {
  const layout: Layout = { ...createEmptyLayout(), ...initial }
  return {
    read: () => layout,
    mutate: (patch: Partial<Layout>) => Object.assign(layout, patch),
  }
}

interface WriterOptions {
  state?: ReturnType<typeof makeState>
  timer?: ReturnType<typeof makeManualTimer>
  write?: (json: string) => Promise<void>
  onError?: (message: string) => void
}

function makeWriter(options: WriterOptions = {}) {
  const state = options.state ?? makeState()
  const timer = options.timer ?? makeManualTimer()
  const write = options.write ?? vi.fn(async () => {})

  const writer = new LayoutWriter({
    build: () => state.read(),
    write,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
    onError: options.onError,
  })

  return { writer, state, timer, write }
}

/** 取出 mock 写入函数第 index 次的 JSON 文本 */
function writtenJson(write: (json: string) => Promise<void>, index = 0): string {
  return (write as unknown as { mock: { calls: [string][] } }).mock.calls[index][0]
}

describe('serializeLayout', () => {
  it('输出带缩进的 JSON（便于人工查看）', () => {
    const text = serializeLayout(createEmptyLayout())

    expect(text).toContain('\n')
    expect(text).toContain('"version": 1')
    expect(JSON.parse(text)).toEqual(createEmptyLayout())
  })
})

describe('LayoutWriter · 防抖', () => {
  it('schedule 后不立即写盘，等防抖计时器触发才写', async () => {
    const { writer, timer, write } = makeWriter({})

    writer.schedule()
    expect(write).not.toHaveBeenCalled()
    expect(writer.hasPending).toBe(true)

    timer.runAll()
    await writer.dispose()

    expect(write).toHaveBeenCalledTimes(1)
  })

  it('防抖间隔默认 500ms（17.6）', () => {
    expect(LAYOUT_DEBOUNCE_MS).toBe(500)
  })

  it('连续多次 schedule 只写一次（重置计时器）', async () => {
    const { writer, timer, write } = makeWriter({})

    writer.schedule()
    writer.schedule()
    writer.schedule()

    // 前两次的计时器被清掉，只剩一个待触发
    expect(timer.pendingCount()).toBe(1)

    timer.runAll()
    await writer.dispose()

    expect(write).toHaveBeenCalledTimes(1)
  })

  it('写入的是 build() 返回的内容', async () => {
    const state = makeState()
    const { writer, timer, write } = makeWriter({ state })

    state.mutate({ canvas: { zoom: 2, offsetX: -100, offsetY: -50 } })
    writer.schedule()
    timer.runAll()
    await writer.dispose()

    const payload = JSON.parse(writtenJson(write))
    expect(payload.canvas).toEqual({ zoom: 2, offsetX: -100, offsetY: -50 })
  })
})

describe('LayoutWriter · 强制落盘', () => {
  it('flush 立即写盘并清掉待触发的计时器', async () => {
    const { writer, timer, write } = makeWriter({})

    writer.schedule()
    expect(timer.pendingCount()).toBe(1)

    await writer.flush()

    expect(write).toHaveBeenCalledTimes(1)
    expect(timer.pendingCount()).toBe(0)
    expect(writer.hasPending).toBe(false)
  })

  it('无 schedule 直接 flush（Ctrl+S 场景）也会写', async () => {
    const { writer, write } = makeWriter({})

    await writer.flush()

    expect(write).toHaveBeenCalledTimes(1)
  })

  it('内容与上次写入一致时跳过（避免无意义的磁盘写入）', async () => {
    const { writer, timer, write } = makeWriter({})

    writer.schedule()
    timer.runAll()
    await writer.flush()

    // 第一次 schedule 写了一次，内容未变的 flush 不再写
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('内容变了之后会重新写', async () => {
    const state = makeState()
    const { writer, write } = makeWriter({ state })

    await writer.flush()
    state.mutate({ canvas: { zoom: 3, offsetX: 0, offsetY: 0 } })
    await writer.flush()

    expect(write).toHaveBeenCalledTimes(2)
  })

  it('build 返回 null（未进入空间）时不写盘', async () => {
    const timer = makeManualTimer()
    const write = vi.fn(async () => {})
    const writer = new LayoutWriter({
      build: () => null,
      write,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    })

    writer.schedule()
    timer.runAll()
    await writer.flush()

    expect(write).not.toHaveBeenCalled()
  })
})

describe('LayoutWriter · 串行化与容错', () => {
  it('多次 flush 依次执行，不会交叉', async () => {
    const events: string[] = []
    const releases: Array<() => void> = []

    const state = makeState()
    const { writer } = makeWriter({
      state,
      write: async () => {
        const index = releases.length
        events.push(`start-${index}`)
        await new Promise<void>((resolve) => releases.push(resolve))
        events.push(`end-${index}`)
      },
    })

    const first = writer.flush()
    state.mutate({ canvas: { zoom: 2, offsetX: 0, offsetY: 0 } })
    const second = writer.flush()

    // 让微任务跑完：此刻只应有第一个写入开始
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(events).toEqual(['start-0'])

    releases[0]()
    await first
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(events).toEqual(['start-0', 'end-0', 'start-1'])

    releases[1]()
    await second
    expect(events).toEqual(['start-0', 'end-0', 'start-1', 'end-1'])
  })

  it('写盘失败 → 回调 onError（中文消息），且下次仍可重试', async () => {
    const onError = vi.fn()
    let attempts = 0
    const { writer, state } = makeWriter({
      onError,
      write: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('无权限访问：D:\\空间\\.mindscape')
      },
    })

    await writer.flush()
    expect(onError).toHaveBeenCalledWith('无权限访问：D:\\空间\\.mindscape')

    // 失败后去重记录被清掉，下次能重试（内容未变也会重写）
    state.mutate({ canvas: { zoom: 2, offsetX: 0, offsetY: 0 } })
    await writer.flush()

    expect(attempts).toBe(2)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('字符串形式的拒绝也能转成消息', async () => {
    const onError = vi.fn()
    const { writer } = makeWriter({
      onError,
      write: async () => {
        throw '磁盘已满'
      },
    })

    await writer.flush()

    expect(onError).toHaveBeenCalledWith('磁盘已满')
  })

  it('dispose 会取消待落盘并等待进行中的写入', async () => {
    const { writer, timer, write } = makeWriter({})

    writer.schedule()
    expect(writer.hasPending).toBe(true)

    await writer.dispose()

    expect(timer.pendingCount()).toBe(0)
    expect(write).not.toHaveBeenCalled()
  })

  it('dispose 之后的 schedule 不再生效', async () => {
    const { writer, timer, write } = makeWriter({})

    await writer.dispose()
    writer.schedule()
    timer.runAll()

    expect(write).not.toHaveBeenCalled()
  })
})
