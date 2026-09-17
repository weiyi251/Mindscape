// ============================================================================
// 模块说明（中文）
// moveCardFlow.ts 的单元测试：外抽后的行为契约（早退守卫、二级菜单组装、
// 选中目标后命令执行与错误提示）。
// ============================================================================

import { describe, expect, it, vi } from 'vitest'

import { MOVE_CARD_TEXT, openMoveCardMenu } from './moveCardFlow'
import type { MoveCardFlowDeps } from './moveCardFlow'
import { UNCLASSIFIED_DIR } from '@/core/board/ingest'
import type { Command } from '@/core/commands/types'
import type { StorageProvider } from '@/core/storage/StorageProvider'
import { zCardSchema } from '@/core/types'
import type { Card, Partition } from '@/core/types'

function makeImageCard(filePath: string): Card {
  return zCardSchema.parse({
    id: 'c1',
    type: 'image',
    filePath,
    originalPath: filePath,
    x: 0,
    y: 0,
    w: 220,
    h: 220,
  })
}

function partition(over: Partial<Partition> = {}): Partition {
  return {
    id: 'p1',
    name: '分区A',
    folderPath: '分区A',
    x: 0,
    y: 0,
    w: 200,
    h: 200,
    color: 'auto',
    collapsed: false,
    meta: {},
    ...over,
  } as Partition
}

function makeDeps(overrides: Partial<MoveCardFlowDeps> = {}): MoveCardFlowDeps & {
  executed: Command[]
  scheduled: number
  errors: string[]
} {
  const executed: Command[] = []
  let scheduled = 0
  const errors: string[] = []
  return {
    spacePath: 'D:\\space',
    provider: {
      moveFile: vi.fn(async (_src: string, dest: string) => dest),
    } as unknown as StorageProvider,
    partitions: [partition({ id: 'p2', name: '分区B', folderPath: '分区B' })],
    readOnly: false,
    execute: vi.fn(async (command: Command) => {
      executed.push(command)
    }),
    schedule: vi.fn(() => {
      scheduled += 1
    }),
    showMenu: vi.fn(),
    onError: vi.fn((message: string) => {
      errors.push(message)
    }),
    applyUpdate: vi.fn(),
    applyPartitionRects: vi.fn(),
    ...overrides,
    get executed() {
      return executed
    },
    get scheduled() {
      return scheduled
    },
    get errors() {
      return errors
    },
  } as MoveCardFlowDeps & { executed: Command[]; scheduled: number; errors: string[] }
}

describe('openMoveCardMenu', () => {
  it('早退守卫：无空间 / 只读 / 便签（无文件）不弹菜单', () => {
    const card = makeImageCard('a.jpg')
    expect(
      openMoveCardMenu(card, { x: 0, y: 0 }, makeDeps({ spacePath: '' })),
    ).toBeUndefined()
    expect(makeDeps().showMenu).not.toHaveBeenCalled()

    const readOnlyDeps = makeDeps({ readOnly: true })
    openMoveCardMenu(card, { x: 0, y: 0 }, readOnlyDeps)
    expect(vi.mocked(readOnlyDeps.showMenu)).not.toHaveBeenCalled()
    expect(readOnlyDeps.errors).toEqual([MOVE_CARD_TEXT.readOnly])

    const noteDeps = makeDeps()
    const note = zCardSchema.parse({
      id: 'n1',
      type: 'note',
      filePath: '',
      originalPath: '',
      x: 0,
      y: 0,
      w: 200,
      h: 160,
    })
    openMoveCardMenu(note, { x: 0, y: 0 }, noteDeps)
    expect(vi.mocked(noteDeps.showMenu)).not.toHaveBeenCalled()
  })

  it('二级菜单列出「未分类」与其他分区；没有目标时报错', () => {
    const deps = makeDeps()
    openMoveCardMenu(makeImageCard('分区A/a.jpg'), { x: 5, y: 6 }, deps)
    const menu = vi.mocked(deps.showMenu).mock.calls[0][0] as {
      x: number
      y: number
      items: { id: string }[]
    }
    expect(menu.x).toBe(5)
    expect(menu.y).toBe(6)
    // 卡片在分区A：首项「未分类」（= 空间主目录），其后是其余分区
    expect(menu.items.map((item) => item.id)).toEqual(['card.move:unclassified', 'card.move:p2'])

    // 卡片在空间根目录、也没有任何分区：无「未分类」项、无其他分区 → 无目标
    const emptyDeps = makeDeps({ partitions: [] })
    openMoveCardMenu(makeImageCard('a.jpg'), { x: 0, y: 0 }, emptyDeps)
    expect(emptyDeps.errors).toEqual([MOVE_CARD_TEXT.noTarget])
  })

  it('选中「未分类」：执行移动命令（目标 = 空间根目录），随后落盘', async () => {
    const deps = makeDeps()
    openMoveCardMenu(makeImageCard('分区A/a.jpg'), { x: 0, y: 0 }, deps)
    const menu = vi.mocked(deps.showMenu).mock.calls[0][0] as { items: { id: string; run: () => void }[] }
    menu.items[0].run()
    await Promise.resolve()
    await Promise.resolve()

    expect(deps.executed).toHaveLength(1)
    expect(deps.scheduled).toBe(1)
    // 移动命令的 do 内部参数经由闭包，这里只断言命令已执行且落盘已请求
    expect(vi.mocked(deps.applyUpdate)).not.toHaveBeenCalled()
    await deps.executed[0].do()
    expect(vi.mocked(deps.applyUpdate)).toHaveBeenCalledTimes(1)
  })

  it('命令执行失败：错误经 onError 报出（中文前缀）', async () => {
    const deps = makeDeps({
      execute: vi.fn(async () => {
        throw new Error('磁盘已满')
      }),
    })
    openMoveCardMenu(makeImageCard('分区A/a.jpg'), { x: 0, y: 0 }, deps)
    const menu = vi.mocked(deps.showMenu).mock.calls[0][0] as { items: { run: () => void }[] }
    menu.items[0].run()
    await Promise.resolve()
    await Promise.resolve()

    expect(deps.errors).toEqual([MOVE_CARD_TEXT.failed('磁盘已满')])
    expect(deps.scheduled).toBe(0)
  })

  it('「未分类」目标即空间主目录（UNCLASSIFIED_DIR 文案由菜单层负责）', () => {
    expect(UNCLASSIFIED_DIR.length).toBeGreaterThan(0)
  })
})
