// ============================================================================
// 模块说明（中文）
// cardLockFlow（锁定 / 解锁卡片编排）的单元测试。
// 覆盖：翻转方向、meta 落点（true 写入 / false 删键）、命令可撤销、落盘请求。
// ============================================================================

import { describe, expect, it, vi } from 'vitest'

import { toggleCardLock } from './cardLockFlow'
import { LOCKED_META_KEY, lockedOfMeta } from '@/core/board/cardMeta'
import { History } from '@/core/commands/history'
import type { Card, Meta } from '@/core/types'

function makeCard(meta: Meta = {}): Card {
  return {
    id: 'c_1',
    type: 'image',
    filePath: '图.png',
    originalPath: '图.png',
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    rotation: 0,
    zIndex: 0,
    note: '',
    meta,
  }
}

function setup(meta: Meta = {}) {
  const history = new History()
  let current: Meta = { ...meta }
  const writeMeta = vi.fn((_id: string, next: Meta) => {
    current = next
  })
  const schedule = vi.fn()
  const deps = {
    execute: (command: Parameters<typeof history.execute>[0]) => history.execute(command),
    schedule,
    applyMeta: writeMeta,
  }
  return {
    deps,
    history,
    schedule,
    meta: () => current,
    writeMeta,
  }
}

describe('toggleCardLock', () => {
  it('未锁定 → 锁定：meta.locked = true，并请求落盘', async () => {
    const { deps, meta, schedule, writeMeta } = setup({ tags: ['参考'] })

    await toggleCardLock(makeCard({ tags: ['参考'] }), deps)

    expect(writeMeta).toHaveBeenCalledTimes(1)
    expect(meta()).toEqual({ tags: ['参考'], [LOCKED_META_KEY]: true })
    expect(lockedOfMeta(meta())).toBe(true)
    expect(schedule).toHaveBeenCalledTimes(1)
  })

  it('已锁定 → 解锁：删键回默认（不留 false 脏字段）', async () => {
    const { deps, meta } = setup({ tags: ['参考'], [LOCKED_META_KEY]: true })

    await toggleCardLock(makeCard({ tags: ['参考'], [LOCKED_META_KEY]: true }), deps)

    expect(LOCKED_META_KEY in meta()).toBe(false)
    expect(meta()).toEqual({ tags: ['参考'] })
  })

  it('脏数据（locked 非布尔真值）视为未锁定 → 点一次是锁定', async () => {
    const { deps, meta } = setup({ [LOCKED_META_KEY]: 'true' })

    await toggleCardLock(makeCard({ [LOCKED_META_KEY]: 'true' }), deps)

    expect(lockedOfMeta(meta())).toBe(true)
  })

  it('一次命令入撤销栈：撤销后回到原 meta', async () => {
    const { deps, history, meta } = setup()
    const card = makeCard()

    await toggleCardLock(card, deps)
    expect(lockedOfMeta(meta())).toBe(true)

    await history.undo()
    expect(meta()).toEqual({})

    await history.redo()
    expect(lockedOfMeta(meta())).toBe(true)
  })
})
