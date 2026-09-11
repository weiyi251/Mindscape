// ============================================================================
// 模块说明（中文）
// 恢复卡片命令（restoreCards）+ 批量移动（provider.moveFiles 单次 IPC）的单元测试。
// 验收核心：
//   · 恢复后 filePath 与 originalPath 都指回原位置（originalPath 漏改会让复制/粘贴
//     拿到 `_已移除\…` 源路径 → 「不是文件」）；
//   · 记录匹配以 movedTo 为准 —— removed 记录 id 重复（历史脏数据）时也不能恢复错文件。
// ============================================================================

import { describe, expect, it } from 'vitest'

import type { Card, RemovedEntry } from '@/core/types'
import type { MovePair, StorageProvider } from '@/core/storage/StorageProvider'
import { createRestoreCardsCommand } from './restoreCards'
import { REMOVE_BATCH_ASYNC_LIMIT } from './removeCards'
import { History } from '@/core/commands/history'

/** 基础卡片形态（已移除视图里的灰卡在此基础上覆写 filePath / originalPath） */
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

/**
 * 已移除视图里的灰卡：filePath 指向 `_已移除\…`（= movedTo），id = removed 记录 id，
 * 与 boardStore.loadRemovedView 生成的实际形态一致。
 */
function grayCard(id: string, originalPath: string): Card {
  const movedTo = `_已移除/${originalPath}`
  return { ...card(id, movedTo), originalPath: movedTo }
}

function entryOf(id: string, originalPath: string): RemovedEntry {
  return { id, originalPath, movedTo: `_已移除/${originalPath}` }
}

function okProvider() {
  const moves: string[] = []
  return {
    provider: {
      async moveFiles(pairs: MovePair[]) {
        for (const pair of pairs) moves.push(`${pair.from}→${pair.to}`)
        return { succeeded: pairs.map((pair) => pair.to), failed: [] }
      },
    } as unknown as StorageProvider,
    moves,
  }
}

describe('createRestoreCardsCommand', () => {
  it('do：文件移回 originalPath，卡片放回 + 记录移除，filePath 与 originalPath 都指回原位置', async () => {
    const { provider, moves } = okProvider()
    const target = grayCard('c_001', '参考资料/a.jpg')
    const removedList = [entryOf('c_001', '参考资料/a.jpg')]
    const restored: { cards: Card[]; entryIds: string[] }[] = []

    const command = createRestoreCardsCommand([target], removedList, {
      spacePath: 'D:\\空间',
      provider,
      applyRestore: (payload) => restored.push(payload),
      applyRemove: () => {},
    })

    await command.do()

    expect(moves).toEqual(['D:\\空间\\_已移除\\参考资料\\a.jpg→D:\\空间\\参考资料\\a.jpg'])
    expect(restored[0].entryIds).toEqual(['c_001'])
    expect(restored[0].cards[0].filePath).toBe('参考资料/a.jpg')
    // ⚠️ originalPath 也必须改回：复制 / 粘贴按它取源路径
    expect(restored[0].cards[0].originalPath).toBe('参考资料/a.jpg')
  })

  it('removed 记录 id 重复（历史脏数据）时按 movedTo 精确匹配，不会误恢复幽灵记录', async () => {
    const { provider, moves } = okProvider()
    // 用户选中的灰卡对应「未分类/作业_1_1.docx」
    const target = grayCard('c_039', '未分类/作业_1_1.docx')
    const removedList = [
      // 幽灵记录：同 id，但文件早已回到原位、`_已移除` 下已不存在
      entryOf('c_039', '333/ref-43.png'),
      // 真正要恢复的记录
      entryOf('c_039', '未分类/作业_1_1.docx'),
    ]
    const restored: { cards: Card[]; entryIds: string[] }[] = []

    const command = createRestoreCardsCommand([target], removedList, {
      spacePath: 'D:\\空间',
      provider,
      applyRestore: (payload) => restored.push(payload),
      applyRemove: () => {},
    })

    await command.do()

    // 必须移动灰卡自身 filePath 指向的那个文件（= 它的 movedTo）
    expect(moves).toEqual([
      'D:\\空间\\_已移除\\未分类\\作业_1_1.docx→D:\\空间\\未分类\\作业_1_1.docx',
    ])
    expect(restored[0].cards[0].filePath).toBe('未分类/作业_1_1.docx')
  })

  it('undo：文件再移回 _已移除，记录追加回来', async () => {
    const { provider, moves } = okProvider()
    const target = grayCard('c_001', 'a.jpg')
    const removedList = [entryOf('c_001', 'a.jpg')]
    const reAdded: { cards: Card[]; entries: RemovedEntry[] }[] = []

    const command = createRestoreCardsCommand([target], removedList, {
      spacePath: 'D:\\空间',
      provider,
      applyRestore: () => {},
      applyRemove: (payload) => reAdded.push(payload),
    })
    const history = new History()
    await history.execute(command)
    await history.undo()

    expect(moves).toHaveLength(2)
    expect(moves[1]).toContain('_已移除')
    expect(reAdded[0].entries[0].id).toBe('c_001')
  })

  it('找不到移除记录时跳过并提示，不中断其余项', async () => {
    const { provider } = okProvider()
    const known = grayCard('c_001', 'a.jpg')
    const unknown = grayCard('c_999', 'ghost.jpg')
    const notices: string[] = []
    const restored: { entryIds: string[] }[] = []

    const command = createRestoreCardsCommand([known, unknown], [entryOf('c_001', 'a.jpg')], {
      spacePath: 'D:\\空间',
      provider,
      applyRestore: (payload) => restored.push(payload),
      applyRemove: () => {},
      onNotice: (message) => notices.push(message),
    })

    await command.do()

    expect(restored[0].entryIds).toEqual(['c_001'])
    expect(notices[0]).toContain('ghost.jpg')
  })
})

describe('批量恢复（provider.moveFiles 单次 IPC）', () => {
  it('大批量（>50）也只调用一次 moveFiles，并上报完成进度', async () => {
    const total = REMOVE_BATCH_ASYNC_LIMIT + 10 // 60 张
    const cards = Array.from({ length: total }, (_, index) => grayCard(`c_${index + 1}`, `img-${index + 1}.jpg`))
    const removedList = cards.map((item) => entryOf(item.id, item.originalPath.replace('_已移除/', '')))

    let calls = 0
    const provider = {
      async moveFiles(pairs: MovePair[]) {
        calls += 1
        return { succeeded: pairs.map((pair) => pair.to), failed: [] }
      },
    } as unknown as StorageProvider

    const progresses: { done: number; total: number }[] = []
    const applied: { entryIds: string[] }[] = []

    const command = createRestoreCardsCommand(cards, removedList, {
      spacePath: 'D:\\空间',
      provider,
      applyRestore: (payload) => applied.push(payload),
      applyRemove: () => {},
      onProgress: (done, count) => progresses.push({ done, total: count }),
    })

    await command.do()

    expect(calls).toBe(1)
    expect(progresses).toEqual([{ done: total, total }])
    expect(applied[0].entryIds).toHaveLength(total)
  })

  it('批量中部分失败：跳过失败项并记录，成功项照常应用', async () => {
    const total = REMOVE_BATCH_ASYNC_LIMIT + 10
    const cards = Array.from({ length: total }, (_, index) => grayCard(`c_${index + 1}`, `img-${index + 1}.jpg`))
    const removedList = cards.map((item) => entryOf(item.id, item.originalPath.replace('_已移除/', '')))

    const failFrom = 'D:\\空间\\_已移除\\img-1.jpg'
    const provider = {
      async moveFiles(pairs: MovePair[]) {
        const hit = pairs.find((pair) => pair.from === failFrom)
        return {
          succeeded: pairs.filter((pair) => pair.from !== failFrom).map((pair) => pair.to),
          failed: hit ? [{ path: hit.from, reason: '无权限访问' }] : [],
        }
      },
    } as unknown as StorageProvider

    const notices: string[] = []
    const applied: { entryIds: string[] }[] = []

    const command = createRestoreCardsCommand(cards, removedList, {
      spacePath: 'D:\\空间',
      provider,
      applyRestore: (payload) => applied.push(payload),
      applyRemove: () => {},
      onNotice: (message) => notices.push(message),
    })

    await command.do()

    expect(applied[0].entryIds).toHaveLength(total - 1)
    // 失败提示用 originalPath（原位置）作为标识，而不是 _已移除 里的源路径
    expect(notices[0]).toContain('img-1.jpg')
  })

  it('小批量（≤50）不触发进度回调', async () => {
    const cards = Array.from({ length: 3 }, (_, index) => grayCard(`c_${index + 1}`, `a-${index}.jpg`))
    const { provider } = okProvider()
    const progresses: unknown[] = []

    const command = createRestoreCardsCommand(
      cards,
      cards.map((item) => entryOf(item.id, item.originalPath.replace('_已移除/', ''))),
      {
        spacePath: 'D:\\空间',
        provider,
        applyRestore: () => {},
        applyRemove: () => {},
        onProgress: (done) => progresses.push(done),
      },
    )

    await command.do()
    expect(progresses).toHaveLength(0)
  })
})
