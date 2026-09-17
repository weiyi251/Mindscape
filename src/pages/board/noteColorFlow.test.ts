// ============================================================================
// 模块说明（中文）
// noteColorFlow.ts 的单元测试：菜单项契约（首项默认 + 7 色板）与
// 「选中 → 可撤销 meta 命令 → 落盘」链路。
// ============================================================================

import { describe, expect, it, vi } from 'vitest'

import { openNoteColorMenu } from './noteColorFlow'
import type { NoteColorDeps } from './noteColorFlow'
import { NOTE_COLOR_META_KEY, NOTE_PALETTE } from '@/core/board/noteColors'
import { zCardSchema } from '@/core/types'
import type { Command } from '@/core/commands/types'
import type { Card, Meta } from '@/core/types'

function makeNoteCard(meta: Meta = {}): Card {
  return zCardSchema.parse({
    id: 'c1',
    type: 'note',
    filePath: '',
    originalPath: '',
    x: 0,
    y: 0,
    w: 200,
    h: 160,
    meta,
  })
}

function makeDeps(overrides: Partial<NoteColorDeps> = {}): NoteColorDeps & {
  executed: Command[]
  scheduled: number
} {
  const executed: Command[] = []
  let scheduled = 0
  return {
    execute: vi.fn(async (command: Command) => {
      executed.push(command)
    }),
    schedule: vi.fn(() => {
      scheduled += 1
    }),
    showMenu: vi.fn(),
    applyMeta: vi.fn(),
    ...overrides,
    get executed() {
      return executed
    },
    get scheduled() {
      return scheduled
    },
  } as NoteColorDeps & { executed: Command[]; scheduled: number }
}

describe('openNoteColorMenu', () => {
  it('弹出二级菜单：首项「默认便签纸」+ 7 色板共 8 项，坐标原样传递', () => {
    const deps = makeDeps()
    openNoteColorMenu(makeNoteCard(), { x: 3, y: 4 }, deps)
    expect(deps.showMenu).toHaveBeenCalledTimes(1)
    const menu = vi.mocked(deps.showMenu).mock.calls[0][0] as { x: number; y: number; items: { run: () => void }[] }
    expect(menu.x).toBe(3)
    expect(menu.y).toBe(4)
    expect(menu.items).toHaveLength(1 + NOTE_PALETTE.length)
  })

  it('选中色板色：meta 命令 do 写入 noteColor / undo 还原整个旧 meta，随后落盘', async () => {
    const card = makeNoteCard({ tags: ['参考'] })
    const original = card.meta // 命令的 undo 快照必须与菜单弹出时的 meta 同引用
    const deps = makeDeps()
    openNoteColorMenu(card, { x: 0, y: 0 }, deps)
    const menu = vi.mocked(deps.showMenu).mock.calls[0][0] as { items: { run: () => void }[] }
    menu.items[2].run() // 第 2 号色
    await Promise.resolve()

    expect(deps.execute).toHaveBeenCalledTimes(1)
    const command = deps.executed[0]
    command.do()
    const applied = vi.mocked(deps.applyMeta).mock.calls.at(-1) as [string, Meta]
    expect(applied[0]).toBe('c1')
    expect(applied[1][NOTE_COLOR_META_KEY]).toBe(NOTE_PALETTE[1])
    expect(applied[1].tags).toEqual(['参考']) // 其他 meta 字段保留
    command.undo()
    expect(vi.mocked(deps.applyMeta).mock.calls.at(-1)?.[1]).toBe(original)
    expect(deps.scheduled).toBe(1)
  })

  it('选中「默认便签纸」：写入的 meta 不带 noteColor 键（删键而非 null 脏值）', async () => {
    const deps = makeDeps()
    openNoteColorMenu(makeNoteCard({ noteColor: '#E7C873' }), { x: 0, y: 0 }, deps)
    const menu = vi.mocked(deps.showMenu).mock.calls[0][0] as { items: { run: () => void }[] }
    menu.items[0].run()
    await Promise.resolve()

    const command = deps.executed[0]
    command.do()
    const applied = vi.mocked(deps.applyMeta).mock.calls.at(-1) as [string, Meta]
    expect(applied[1]).not.toHaveProperty(NOTE_COLOR_META_KEY)
  })
})
