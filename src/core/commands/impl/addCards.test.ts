// ============================================================================
// 模块说明（中文）
// addCards 命令（T3.4 新建便签 / T3.6 拖入 / T3.8 粘贴）与 ingest 落点规则的单元测试。
// 验收核心（7.4）：undo 必须回滚文件操作 —— 拖入创建的副本在 undo 时被删除。
// ============================================================================

import { describe, expect, it } from 'vitest'

import { createAddCardsCommand } from './addCards'
import {
  cardWithoutEditables,
  expandedBounds,
  cloneFilelessCard,
  isCopyableCard,
  pasteFileName,
  resolveDropDestination,
} from '@/core/board/ingest'
import type { Card, Partition } from '@/core/types'
import { registerHook, resetPluginCenter } from '@/core/registry/pluginCenter'
import type { HookPayloadMap } from '@/core/registry/pluginCenter'

function makeCard(id: string, x = 0, y = 0) {
  return {
    id,
    type: 'image',
    filePath: `${id}.png`,
    originalPath: `${id}.png`,
    x,
    y,
    w: 100,
    h: 100,
    rotation: 0,
    zIndex: 0,
    note: '',
    meta: {},
  }
}

function makeDeps() {
  const added: string[] = []
  const removed: string[] = []
  const deleted: string[] = []
  const copied: { src: string; destDir: string }[] = []
  return {
    added,
    removed,
    deleted,
    copied,
    deps: {
      provider: {
        copyFile: async (src: string, destDir: string) => {
          copied.push({ src, destDir })
          return `${destDir}\\${src.split('\\').pop()}`
        },
        deleteFile: async (path: string) => {
          deleted.push(path)
        },
      },
      applyAdd: (cards: { id: string }[]) => {
        for (const card of cards) added.push(card.id)
      },
      applyRemove: (ids: string[]) => {
        for (const id of ids) removed.push(id)
      },
    },
  }
}

describe('addCards 命令（T3.4 / T3.6 / T3.8）', () => {
  it('新建便签（无文件）：do 加卡片，undo 只删卡片、不碰文件', async () => {
    const { deps, added, removed, deleted } = makeDeps()
    const command = createAddCardsCommand(
      { cards: [makeCard('c_001')], createdFiles: [], sources: [] },
      deps,
    )

    await command.do()
    expect(added).toEqual(['c_001'])
    await command.undo()
    expect(removed).toEqual(['c_001'])
    expect(deleted).toHaveLength(0)
  })

  it('拖入（有副本）：undo 删除本次创建的副本文件（7.4 文件回滚）', async () => {
    const { deps, added, removed, deleted } = makeDeps()
    const command = createAddCardsCommand(
      {
        cards: [makeCard('c_001', 10, 10)],
        createdFiles: ['E:\\sp\\图.png'],
        sources: [{ src: 'C:\\Users\\x\\图.png', destDir: 'E:\\sp' }],
      },
      deps,
    )

    await command.do()
    expect(added).toEqual(['c_001'])
    await command.undo()
    expect(deleted).toEqual(['E:\\sp\\图.png'])
    expect(removed).toEqual(['c_001'])
  })

  it('redo：副本被 undo 删除后，do 会按 sources 重新复制', async () => {
    const { deps, copied } = makeDeps()
    const command = createAddCardsCommand(
      {
        cards: [makeCard('c_001')],
        createdFiles: ['E:\\sp\\图.png'],
        sources: [{ src: 'C:\\Users\\x\\图.png', destDir: 'E:\\sp' }],
      },
      deps,
    )

    await command.do()
    await command.undo()
    expect(copied).toHaveLength(0)
    await command.do() // redo
    expect(copied).toEqual([{ src: 'C:\\Users\\x\\图.png', destDir: 'E:\\sp' }])
  })

  it('粘贴（src 为空）：redo 无法重建剪贴板，跳过重建不报错', async () => {
    const { deps, copied } = makeDeps()
    const command = createAddCardsCommand(
      {
        cards: [makeCard('c_001')],
        createdFiles: ['E:\\sp\\粘贴-20260911-1400.png'],
        sources: [{ src: '', destDir: 'E:\\sp' }],
      },
      deps,
    )

    await command.do()
    await command.undo()
    await command.do()
    expect(copied).toHaveLength(0) // 跳过重建，不抛错
  })
})

describe('ingest 落点规则（T3.7 / T3.8）', () => {
  const SPACE = 'E:\\sp'
  const PARTITION: Partition = {
    id: 'p_001',
    name: '参考资料',
    folderPath: '参考资料',
    x: 100,
    y: 100,
    w: 400,
    h: 300,
    color: 'auto',
    collapsed: false,
    meta: {},
  }

  it('落点在框内 → 对应子文件夹 + 记录分区', () => {
    const dest = resolveDropDestination({ x: 200, y: 200 }, [PARTITION], SPACE)
    expect(dest).toEqual({
      destDir: 'E:\\sp\\参考资料',
      partitionId: 'p_001',
      groupName: '参考资料',
    })
  })

  it('落点在空白 → 空间主目录，分区为空（2026-09-13：不再创建「未分类」文件夹）', () => {
    const dest = resolveDropDestination({ x: 0, y: 0 }, [PARTITION], SPACE)
    expect(dest.destDir).toBe('E:\\sp')
    expect(dest.partitionId).toBeNull()
    expect(dest.groupName).toBeNull()
  })

  it('重叠框取面积最小的（最精确命中）', () => {
    const big: Partition = { ...PARTITION, id: 'p_big', name: '大', folderPath: '大', w: 800, h: 600 }
    const dest = resolveDropDestination({ x: 200, y: 200 }, [big, PARTITION], SPACE)
    expect(dest.partitionId).toBe('p_001')
  })

  it('粘贴文件名格式：粘贴-YYYYMMDD-HHmm.png', () => {
    const name = pasteFileName(new Date(2026, 8, 11, 9, 5)) // 本地 2026-09-11 09:05
    expect(name).toBe('粘贴-20260911-0905.png')
  })

  it('expandedBounds：只扩不缩；已包住时返回 null', () => {
    // 新卡超出右下角 → 框扩大
    const next = expandedBounds(PARTITION, { x: 500, y: 500, w: 50, h: 50 })
    expect(next).toEqual({ x: 100, y: 100, w: 450, h: 450 })

    // 新卡在框内 → 不变
    expect(expandedBounds(PARTITION, { x: 150, y: 150, w: 50, h: 50 })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 可复制卡片判定（2026-09-11 用户裁决：图片 / 文件 / 便签都支持复制与粘贴）
// ---------------------------------------------------------------------------

describe('isCopyableCard', () => {
  it('便签：无硬盘文件也可复制（粘贴时克隆文字）', () => {
    expect(isCopyableCard({ type: 'note', filePath: '' })).toBe(true)
  })

  it('图片 / 文件：有硬盘文件时可复制', () => {
    expect(isCopyableCard({ type: 'image', filePath: '图片/a.png' })).toBe(true)
    expect(isCopyableCard({ type: 'file', filePath: '文档/合同.pdf' })).toBe(true)
  })

  it('图片 / 文件：filePath 为空（文件缺失）时不可复制', () => {
    expect(isCopyableCard({ type: 'image', filePath: '' })).toBe(false)
    expect(isCopyableCard({ type: 'file', filePath: '' })).toBe(false)
  })

  it('无文件插件卡（2026-09-18 扩展，待办卡等）：内容在 meta 里，可复制', () => {
    expect(isCopyableCard({ type: 'todo', filePath: '' })).toBe(true)
    // 有硬盘文件的插件卡同样可复制（走文件拷贝路径）
    expect(isCopyableCard({ type: 'colorCard', filePath: '色卡/a.png' })).toBe(true)
  })
})

describe('cloneFilelessCard（2026-09-18：无文件插件卡的粘贴克隆）', () => {
  const source = makeCard('todo_1') as Card

  it('整卡克隆：换新 id 与位置，meta（内容本体）原样保留', () => {
    const withMeta = { ...source, x: 40, y: 60, meta: { items: [{ id: 't1', text: '买牛奶', done: false }] } } as Card
    const clone = cloneFilelessCard(withMeta, 'todo_2', 100.6, 200.4, null)

    expect(clone.id).toBe('todo_2')
    expect(clone.x).toBe(101) // 坐标取整（与建卡一致）
    expect(clone.y).toBe(200)
    expect(clone.type).toBe(source.type)
    expect(clone.w).toBe(source.w)
    expect(clone.h).toBe(source.h)
    // meta 是待办卡的内容本体，清掉等于粘贴出一张空卡
    expect(clone.meta).toEqual(withMeta.meta)
  })

  it('落点命中分区时分组随目标（不沿用源卡的 group）', () => {
    const grouped = { ...source, group: '旧分区' } as Card
    expect(cloneFilelessCard(grouped, 'todo_3', 0, 0, '新分区').group).toBe('新分区')
    expect(cloneFilelessCard(grouped, 'todo_4', 0, 0, null).group).toBe('旧分区')
  })

  it('不改动源卡（复制语义）', () => {
    const withMeta = { ...source, meta: { items: [] } } as Card
    cloneFilelessCard(withMeta, 'todo_5', 0, 0, null)
    expect(withMeta.id).toBe('todo_1')
  })
})

describe('cardWithoutEditables（2026-09-13 用户裁决：粘贴不复制备注与标签）', () => {
  it('清空备注与 meta（含标签），其余字段原样保留', () => {
    const source = {
      ...makeCard('c1', 12, 34),
      note: '原图的备注',
      meta: { tags: ['图标'] },
    } as Parameters<typeof cardWithoutEditables>[0]

    const cleaned = cardWithoutEditables(source)

    expect(cleaned.note).toBe('')
    expect(cleaned.meta).toEqual({})
    // 其余信息（内容本体与位置尺寸）复制行为不变
    expect(cleaned).toMatchObject({
      id: 'c1',
      type: 'image',
      filePath: 'c1.png',
      x: 12,
      y: 34,
      w: 100,
      h: 100,
    })
    // 不改动源卡（复制语义）
    expect(source.note).toBe('原图的备注')
    expect(source.meta).toEqual({ tags: ['图标'] })
  })
})


// ---------------------------------------------------------------------------
// 插件生命周期钩子：cardCreated（2026-09-20 埋点）
// ---------------------------------------------------------------------------

describe('插件生命周期钩子：cardCreated', () => {
  it('do 时每张卡触发一次；undo 不触发', async () => {
    resetPluginCenter()
    const seen: string[] = []
    registerHook('cardCreated', (payload) => {
      seen.push((payload as HookPayloadMap['cardCreated']).card.id)
    })

    const { deps } = makeDeps()
    const command = createAddCardsCommand(
      { cards: [makeCard('c_001'), makeCard('c_002')], createdFiles: [], sources: [] },
      deps,
    )
    await command.do()
    expect(seen).toEqual(['c_001', 'c_002'])

    await command.undo()
    expect(seen).toEqual(['c_001', 'c_002'])
  })
})
