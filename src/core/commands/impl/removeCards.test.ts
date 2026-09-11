// ============================================================================
// 模块说明（中文）
// 移除卡片命令（removeCards）的单元测试（T2.7）。
// 覆盖：目标路径规则、成功流、部分失败、全部失败、undo 文件回滚。
// ============================================================================

import { describe, expect, it } from 'vitest'

import type { Card, Connection } from '@/core/types'
import type { StorageProvider } from '@/core/storage/StorageProvider'
import {
  connectionsTouchingCardIds,
  createRemoveCardsCommand,
  removedPathFor,
} from './removeCards'
import { History } from '@/core/commands/history'

function card(id: string, filePath: string): Card {
  return {
    id,
    type: 'image',
    filePath,
    originalPath: filePath,
    x: 0,
    y: 0,
    w: 100,
    h: 80,
    rotation: 0,
    zIndex: 0,
    note: '',
    meta: {},
  }
}

function conn(id: string, from: string, to: string): Connection {
  return { id, from, to, label: '', color: 'gray', meta: {} }
}

describe('removedPathFor', () => {
  it('保留原文件夹结构（7.1）', () => {
    expect(removedPathFor('参考资料/ref-01.jpg')).toBe('_已移除/参考资料/ref-01.jpg')
    expect(removedPathFor('根目录图.jpg')).toBe('_已移除/根目录图.jpg')
    expect(removedPathFor('参考资料\\ref-01.jpg')).toBe('_已移除/参考资料/ref-01.jpg')
  })
})

describe('createRemoveCardsCommand', () => {
  const SPACE = 'D:\\空间'

  /** 可编程假 provider：记录移动 + 按源路径抛错 */
  function setup(failFor: string[] = [], connections: Connection[] = []) {
    const moves: { from: string; to: string; actual: string }[] = []
    const provider = {
      async moveFile(from: string, to: string) {
        if (failFor.some((name) => from.includes(name))) {
          throw new Error('无权限访问')
        }
        const actual = to // 假设无重名
        moves.push({ from, to, actual })
        return actual
      },
    } as unknown as StorageProvider

    const removed: { cards: Card[]; entries: { id: string; originalPath: string; movedTo: string }[] }[] = []
    const restored: { cards: Card[]; entryIds: string[] }[] = []
    const notices: string[] = []

    // 模拟真实 store 的连线行为：删除即从快照里剔除，还原即追加回去
    const context = {
      spacePath: SPACE,
      provider,
      applyRemove: (payload: { cards: Card[]; entries: typeof removed[number]['entries'] }) => {
        removed.push(payload)
      },
      applyRestore: (payload: { cards: Card[]; entryIds: string[] }) => {
        restored.push(payload)
      },
      getConnections: () => connections,
      applyRemoveConnections: (ids: string[]) => {
        for (const id of ids) {
          const index = connections.findIndex((connection) => connection.id === id)
          if (index >= 0) connections.splice(index, 1)
        }
      },
      applyAddConnections: (list: Connection[]) => {
        connections.push(...list)
      },
      onNotice: (message: string) => notices.push(message),
    }

    return { context, moves, removed, restored, notices, connections }
  }

  it('do：文件移到 _已移除\\原结构\\，applyRemove 带回 movedTo', async () => {
    const { context, moves, removed } = setup()
    const command = createRemoveCardsCommand(
      [card('c_001', '参考资料/a.jpg'), card('c_002', '根图.jpg')],
      context,
    )

    await command.do()

    // joinPath 会把相对路径的分隔符统一成 base 的风格（Windows → \）
    expect(moves.map((move) => move.to)).toEqual([
      'D:\\空间\\_已移除\\参考资料\\a.jpg',
      'D:\\空间\\_已移除\\根图.jpg',
    ])
    expect(removed).toHaveLength(1)
    expect(removed[0].cards.map((item) => item.id)).toEqual(['c_001', 'c_002'])
    expect(removed[0].entries).toEqual([
      { id: 'c_001', originalPath: '参考资料/a.jpg', movedTo: '_已移除/参考资料/a.jpg' },
      { id: 'c_002', originalPath: '根图.jpg', movedTo: '_已移除/根图.jpg' },
    ])
  })

  it('部分失败：成功的照常移除并提示；全部失败：抛错不入栈', async () => {
    const partial = setup(['b.jpg'])
    const command = createRemoveCardsCommand(
      [card('c_001', 'a.jpg'), card('c_002', 'b.jpg')],
      partial.context,
    )
    await command.do()
    expect(partial.removed[0].cards.map((item) => item.id)).toEqual(['c_001'])
    expect(partial.notices[0]).toContain('b.jpg')

    const allFail = setup(['a.jpg'])
    const command2 = createRemoveCardsCommand([card('c_003', 'a.jpg')], allFail.context)
    await expect(command2.do()).rejects.toThrow('移除失败')
    expect(allFail.removed).toHaveLength(0)
  })

  it('undo：文件移回原位 + applyRestore', async () => {
    const { context, moves, restored } = setup()
    const command = createRemoveCardsCommand([card('c_001', '参考资料/a.jpg')], context)

    const history = new History()
    await history.execute(command)
    await history.undo()

    // 第二次移动是回滚：_已移除/... → 原路径
    expect(moves[1]).toEqual({
      from: 'D:\\空间\\_已移除\\参考资料\\a.jpg',
      to: 'D:\\空间\\参考资料\\a.jpg',
      actual: 'D:\\空间\\参考资料\\a.jpg',
    })
    expect(restored).toHaveLength(1)
    expect(restored[0].cards.map((item) => item.id)).toEqual(['c_001'])
    expect(restored[0].entryIds).toEqual(['c_001'])
  })

  it('重名加后缀时 movedTo 记录实际落点（relativePathOf 归一）', async () => {
    const moves: { from: string; to: string; actual: string }[] = []
    const provider = {
      async moveFile(from: string, to: string) {
        // 模拟 Rust 侧重名兜底：实际写入 xxx_1.jpg
        const actual = to.replace('a.jpg', 'a_1.jpg')
        moves.push({ from, to, actual })
        return actual
      },
    } as unknown as StorageProvider
    const removed: { entries: { movedTo: string }[] }[] = []
    const command = createRemoveCardsCommand([card('c_001', 'a.jpg')], {
      spacePath: SPACE,
      provider,
      applyRemove: (payload) => removed.push(payload as { entries: { movedTo: string }[] }),
      applyRestore: () => {},
      getConnections: () => [],
      applyRemoveConnections: () => {},
      applyAddConnections: () => {},
    })

    await command.do()

    expect(removed[0].entries[0].movedTo).toBe('_已移除/a_1.jpg')
  })
})

// ---------------------------------------------------------------------------
// 级联断开连线（2026-09-11 用户裁决：移除元素同时断开其连线；
// 撤销「卡片移除」时连线一并回来，「已移除」恢复卡片时连线不回来）
// ---------------------------------------------------------------------------

describe('connectionsTouchingCardIds', () => {
  it('命中 from 或 to 任意一侧都算相连；无关连线不受影响', () => {
    const list = [
      conn('conn_001', 'c_001', 'c_002'),
      conn('conn_002', 'c_003', 'c_001'),
      conn('conn_003', 'c_002', 'c_003'),
    ]
    expect(connectionsTouchingCardIds(['c_001'], list).map((item) => item.id)).toEqual([
      'conn_001',
      'conn_002',
    ])
    expect(connectionsTouchingCardIds(['c_999'], list)).toEqual([])
  })

  it('多张卡片一起移除时，命中任意一张的连线都断开', () => {
    const list = [conn('conn_001', 'c_001', 'c_002'), conn('conn_002', 'c_003', 'c_004')]
    expect(connectionsTouchingCardIds(['c_001', 'c_004'], list).map((item) => item.id)).toEqual([
      'conn_001',
      'conn_002',
    ])
  })
})

describe('createRemoveCardsCommand · 级联断开连线', () => {
  const SPACE = 'D:\\空间'

  it('do：与移除卡片相连的连线一并删除（from / to 两侧都算）', async () => {
    const connections = [
      conn('conn_001', 'c_001', 'c_002'),
      conn('conn_002', 'c_002', 'c_001'),
      conn('conn_003', 'c_002', 'c_003'),
    ]
    const { context, connections: live } = setupWithConnections(connections)
    const command = createRemoveCardsCommand([card('c_001', 'a.jpg')], context)

    await command.do()

    // 只剩 c_002 ↔ c_003 那条；指向 c_001 的两条被级联删除
    expect(live.map((item) => item.id)).toEqual(['conn_003'])
  })

  it('undo：卡片放回画布时，级联断开的连线原样回来（整体回滚）', async () => {
    const connections = [conn('conn_001', 'c_001', 'c_002')]
    const { context, connections: live } = setupWithConnections(connections)
    const command = createRemoveCardsCommand([card('c_001', 'a.jpg')], context)

    const history = new History()
    await history.execute(command)
    expect(live).toHaveLength(0)

    await history.undo()
    expect(live.map((item) => item.id)).toEqual(['conn_001'])
  })

  it('部分失败：只与失败卡片相连的连线保持不动', async () => {
    // b.jpg 移动失败 → c_002 仍在画布上，指向它的连线不该被断开
    const connections = [
      conn('conn_001', 'c_001', 'c_002'),
      conn('conn_002', 'c_002', 'c_003'),
    ]
    const { context, connections: live } = setupWithConnections(connections, ['b.jpg'])
    const command = createRemoveCardsCommand(
      [card('c_001', 'a.jpg'), card('c_002', 'b.jpg')],
      context,
    )

    await command.do()

    // c_001 成功了（conn_001 断开）；c_002 失败仍在画布（conn_002 保留）
    expect(live.map((item) => item.id)).toEqual(['conn_002'])
  })

  /** 与 setup 同构，但允许传入初始连线（把复用逻辑集中在这里，避免 setup 过度膨胀） */
  function setupWithConnections(initial: Connection[], failFor: string[] = []) {
    const { context, connections } = (() => {
      const moves: { from: string; to: string; actual: string }[] = []
      const provider = {
        async moveFile(from: string, to: string) {
          if (failFor.some((name) => from.includes(name))) throw new Error('无权限访问')
          moves.push({ from, to, actual: to })
          return to
        },
      } as unknown as StorageProvider
      const live: Connection[] = [...initial]
      return {
        context: {
          spacePath: SPACE,
          provider,
          applyRemove: () => {},
          applyRestore: () => {},
          getConnections: () => live,
          applyRemoveConnections: (ids: string[]) => {
            for (const id of ids) {
              const index = live.findIndex((connection) => connection.id === id)
              if (index >= 0) live.splice(index, 1)
            }
          },
          applyAddConnections: (list: Connection[]) => {
            live.push(...list)
          },
        },
        connections: live,
      }
    })()
    return { context, connections }
  }
})
