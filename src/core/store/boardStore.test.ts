// ============================================================================
// 模块说明（中文）
// 画布 store 单元测试（对应 T1.3）。
// 用假 provider 替换 Tauri 调用，验证「读文件夹 → 生成卡片」的数据流与错误处理。
//
// 实现任务：T1.3（阶段一）。
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest'

import { createBoardStore } from '@/core/store/boardStore'
import { clearCardAssets, getCardOriginalPath } from '@/core/board/cardAssets'
import { CORE_CARD_TYPE_DEFAULT_SIZE } from '@/core/registry/cardTypes'
import { createEmptyLayout, zCardSchema } from '@/core/types'
import { History } from '@/core/commands/history'
import { createRemoveCardsCommand } from '@/core/commands/impl/removeCards'
import { StorageError } from '@/core/storage/StorageProvider'
import type { Layout, RemovedEntry, Space } from '@/core/types'
import type { DirEntry, ImageSize, StorageProvider } from '@/core/storage/StorageProvider'
import type { AppLayoutStore } from '@/core/storage/appLayoutStore'

/** 假 provider 默认返回的 layout.json 内容（空布局） */
function emptyLayoutJson(): string {
  return JSON.stringify(createEmptyLayout())
}

const SPACE: Space = {
  id: 'sp_001',
  name: '项目A',
  type: '项目',
  folderPath: 'D:\\Mindscape\\01_项目A',
  createdAt: '2026-09-10T11:00:00',
  lastOpenedAt: '2026-09-10T11:00:00',
  favorite: false,
  meta: {},
}

function entry(name: string, isDir = false): DirEntry {
  return { name, path: `D:\\Mindscape\\01_项目A\\${name}`, isDir, size: 1024, modifiedAt: 1 }
}

/**
 * 测试工厂：默认注入「软件目录里没有布局」的假 store，并让 legacyLayoutExists 恒为 true
 * —— 这样既有用例继续走「读空间文件夹里的 .mindscape\layout.json」这条路径，断言不用改。
 * P1-2 专项目录用 overrides 打开软件目录那条路径。
 */
function createStore(provider: StorageProvider, overrides: Partial<AppLayoutStore> = {}) {
  const layoutStore: AppLayoutStore = {
    read: async () => null,
    write: async () => {},
    legacyLayoutExists: async () => true,
    ...overrides,
  }
  return createBoardStore(provider, layoutStore)
}

/**
 * 只实现 listDir / readLayout 的假 provider（其余方法在被调用时会因 undefined 而暴露问题）。
 * @param result    根目录返回值
 * @param subDirs   子路径 → 返回值；未命中的子目录返回空数组（一层扫描用）
 */
function createFakeProvider(
  result: DirEntry[] | Error,
  subDirs: Record<string, DirEntry[] | Error> = {},
): StorageProvider {
  return {
    async listDir(path: string) {
      if (path in subDirs) {
        const value = subDirs[path]
        if (value instanceof Error) throw value
        return value
      }
      if (result instanceof Error) throw result
      return path === 'D:\\Mindscape\\01_项目A' ? result : []
    },
    async readLayout() {
      return emptyLayoutJson()
    },
  } as unknown as StorageProvider
}

describe('boardStore.loadSpace', () => {
  it('初始为空闲状态', () => {
    const store = createStore(createFakeProvider([]))
    expect(store.getState().status).toBe('idle')
    expect(store.getState().cards).toEqual([])
    expect(store.getState().spaceId).toBeNull()
  })

  it('读取成功 → ready，卡片按网格铺开', async () => {
    const store = createStore(
      createFakeProvider([entry('a.jpg'), entry('b.jpg'), entry('总平面.pdf'), entry('参考资料', true)]),
    )

    await store.getState().loadSpace(SPACE)

    const state = store.getState()
    expect(state.status).toBe('ready')
    expect(state.spaceId).toBe('sp_001')
    expect(state.cards).toHaveLength(3)
    expect(state.cards.map((card) => card.type)).toEqual(['image', 'image', 'file'])
    // 不堆在原点
    expect(state.cards[0].x).toBeGreaterThan(0)
    expect(state.cards[1].x).toBeGreaterThan(state.cards[0].x)
  })

  it('读取失败 → error 且 message 可直接展示（来自 Rust 的中文）', async () => {
    const store = createStore(createFakeProvider(new Error('路径不存在：D:\\Mindscape\\01_项目A')))

    await store.getState().loadSpace(SPACE)

    const state = store.getState()
    expect(state.status).toBe('error')
    expect(state.error).toBe('路径不存在：D:\\Mindscape\\01_项目A')
    expect(state.cards).toEqual([])
  })

  it('切换空间时先清空上一批卡片，避免旧内容闪现', async () => {
    const store = createStore(createFakeProvider([entry('a.jpg')]))
    await store.getState().loadSpace(SPACE)
    expect(store.getState().cards).toHaveLength(1)

    const errorStore = createStore(createFakeProvider(new Error('读取失败')))
    await errorStore.getState().loadSpace(SPACE)
    expect(errorStore.getState().cards).toEqual([])
  })

  it('空文件夹 → ready 且零卡片（对应「没有可显示的文件」空状态）', async () => {
    const store = createStore(createFakeProvider([entry('子目录', true)]))

    await store.getState().loadSpace(SPACE)

    expect(store.getState().status).toBe('ready')
    expect(store.getState().cards).toEqual([])
  })

  it('20 张图 → 20 张卡片、4 行（T1.3 验收场景）', async () => {
    const entries = Array.from({ length: 20 }, (_, i) => entry(`ref-${i + 1}.jpg`))
    const store = createStore(createFakeProvider(entries))

    await store.getState().loadSpace(SPACE)

    const cards = store.getState().cards
    expect(cards).toHaveLength(20)
    expect(new Set(cards.map((card) => card.y)).size).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// T2.5：分区框（子文件夹）
// ---------------------------------------------------------------------------

describe('boardStore.loadSpace · 分区框（T2.5）', () => {
  it('子文件夹 → 自动建分区框，框内卡片带 group 与相对路径', async () => {
    const dirPath = 'D:\\Mindscape\\01_项目A\\参考资料'
    const store = createStore(
      createFakeProvider([entry('根图.jpg'), entry('参考资料', true)], {
        [dirPath]: [entry('a.jpg'), entry('b.jpg')],
      }),
    )

    await store.getState().loadSpace(SPACE)

    const state = store.getState()
    expect(state.status).toBe('ready')
    expect(state.cards).toHaveLength(3)

    const groupCards = state.cards.filter((card) => card.group === '参考资料')
    expect(groupCards).toHaveLength(2)
    expect(groupCards.map((card) => card.filePath)).toEqual(['参考资料/a.jpg', '参考资料/b.jpg'])

    // 自动建框：包住框内卡片
    expect(state.partitions).toHaveLength(1)
    const box = state.partitions[0]
    expect(box.name).toBe('参考资料')
    expect(box.folderPath).toBe('参考资料')
    const minX = Math.min(...groupCards.map((card) => card.x))
    const maxX = Math.max(...groupCards.map((card) => card.x + card.w))
    expect(box.x).toBeLessThan(minX)
    expect(box.x + box.w).toBeGreaterThan(maxX)
    expect(box.y + box.h).toBeGreaterThan(Math.max(...groupCards.map((card) => card.y + card.h)))
  })

  it('分区行带互不重叠：两个子文件夹的框上下排布', async () => {
    const dirA = 'D:\\Mindscape\\01_项目A\\A'
    const dirB = 'D:\\Mindscape\\01_项目A\\B'
    const store = createStore(
      createFakeProvider([entry('A', true), entry('B', true)], {
        [dirA]: [entry('a1.jpg')],
        [dirB]: [entry('b1.jpg')],
      }),
    )

    await store.getState().loadSpace(SPACE)

    const [a, b] = store.getState().partitions
    expect(a.name).toBe('A')
    expect(b.name).toBe('B')
    // B 的行带在 A 之下：B 的框顶 ≥ A 的框底
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.h)
  })

  it('保留目录（.mindscape / _已移除）不建框', async () => {
    const store = createStore(
      createFakeProvider(
        [entry('.mindscape', true), entry('_已移除', true), entry('正常', true)],
        {
          'D:\\Mindscape\\01_项目A\\正常': [],
        },
      ),
    )

    await store.getState().loadSpace(SPACE)

    expect(store.getState().partitions).toEqual([])
  })

  it('layout 已有分区记录 → 完全沿用（位置 / 折叠保留）', async () => {
    const savedLayout = createEmptyLayout()
    savedLayout.partitions = [
      {
        id: 'p_001',
        name: '参考资料',
        folderPath: '参考资料',
        x: 500,
        y: 400,
        w: 300,
        h: 200,
        color: '#5A7D6A',
        collapsed: true,
        meta: {},
      },
    ]

    const dirPath = 'D:\\Mindscape\\01_项目A\\参考资料'
    const storeWithLayout = createStore({
      async listDir(path: string) {
        return path === dirPath ? [entry('a.jpg')] : [entry('根图.jpg'), entry('参考资料', true)]
      },
      async readLayout() {
        return JSON.stringify(savedLayout)
      },
    } as unknown as StorageProvider)

    await storeWithLayout.getState().loadSpace(SPACE)

    const [box] = storeWithLayout.getState().partitions
    expect(box).toEqual(savedLayout.partitions[0])
  })

  it('子文件夹读取失败 → 提示可展示，其余照常', async () => {
    const dirPath = 'D:\\Mindscape\\01_项目A\\坏文件夹'
    const store = createStore(
      createFakeProvider([entry('根图.jpg'), entry('坏文件夹', true)], {
        [dirPath]: new Error('路径不存在'),
      }),
    )

    await store.getState().loadSpace(SPACE)

    const state = store.getState()
    expect(state.status).toBe('ready')
    expect(state.cards).toHaveLength(1)
    expect(state.partitions).toEqual([])
    expect(state.notices.some((notice) => notice.includes('坏文件夹'))).toBe(true)
  })

  it('setPartitionPositions / setPartitionCollapsed 生效', async () => {
    const dirPath = 'D:\\Mindscape\\01_项目A\\参考资料'
    const store = createStore(
      createFakeProvider([entry('参考资料', true)], { [dirPath]: [entry('a.jpg')] }),
    )
    await store.getState().loadSpace(SPACE)

    const id = store.getState().partitions[0].id
    store.getState().setPartitionPositions([{ id, x: 111, y: 222 }])
    expect(store.getState().partitions[0]).toMatchObject({ x: 111, y: 222 })

    store.getState().setPartitionCollapsed(id, true)
    expect(store.getState().partitions[0].collapsed).toBe(true)
    store.getState().setPartitionCollapsed(id, false)
    expect(store.getState().partitions[0].collapsed).toBe(false)
  })
})

describe('boardStore.setCardSizes · 可选位置（2026-09-13 便签四向缩放）', () => {
  async function loadedStore() {
    const store = createStore(createFakeProvider([entry('a.jpg')]))
    await store.getState().loadSpace(SPACE)
    return store
  }

  it('只传 w / h：尺寸更新，x / y 保持原值', async () => {
    const store = await loadedStore()
    const id = store.getState().cards[0].id
    const before = store.getState().cards[0]

    store.getState().setCardSizes([{ id, w: 300, h: 200 }])
    expect(store.getState().cards[0]).toMatchObject({ w: 300, h: 200, x: before.x, y: before.y })
  })

  it('带 x / y：位置一并更新（西 / 北边缩放联动）', async () => {
    const store = await loadedStore()
    const id = store.getState().cards[0].id

    store.getState().setCardSizes([{ id, w: 180, h: 180, x: 160, y: 80 }])
    expect(store.getState().cards[0]).toMatchObject({ w: 180, h: 180, x: 160, y: 80 })
  })

  it('x / y 部分缺省：缺的轴保持原值', async () => {
    const store = await loadedStore()
    const id = store.getState().cards[0].id
    const before = store.getState().cards[0]

    store.getState().setCardSizes([{ id, w: 200, h: 200, y: 999 }])
    expect(store.getState().cards[0]).toMatchObject({ w: 200, h: 200, x: before.x, y: 999 })
  })
})

describe('boardStore · 分区选中与文件归属（2026-09-12）', () => {
  async function loadedStore() {
    const dirPath = 'D:\\Mindscape\\01_项目A\\参考资料'
    const store = createStore(
      createFakeProvider([entry('参考资料', true)], { [dirPath]: [entry('a.jpg')] }),
    )
    await store.getState().loadSpace(SPACE)
    return store
  }

  it('selectPartition 选中分区并清空卡片选中；selectCards 反向清除分区选中', async () => {
    const store = await loadedStore()
    const partitionId = store.getState().partitions[0].id

    store.getState().selectCards(['a'])
    expect(store.getState().selectedIds).toEqual(['a'])

    store.getState().selectPartition(partitionId)
    expect(store.getState().selectedPartitionId).toBe(partitionId)
    expect(store.getState().selectedIds).toEqual([])

    store.getState().selectCards(['a'])
    expect(store.getState().selectedPartitionId).toBeNull()

    store.getState().selectPartition(partitionId)
    store.getState().selectPartition(null)
    expect(store.getState().selectedPartitionId).toBeNull()
  })

  it('setCardFileRefs 更新 filePath / originalPath / group，其余字段不动', async () => {
    const store = await loadedStore()
    const before = store.getState().cards[0]
    const id = before.id

    store.getState().setCardFileRefs([
      { id, filePath: '旅行/a.jpg', originalPath: '旅行/a.jpg', group: '旅行' },
    ])

    const after = store.getState().cards.find((card) => card.id === id)
    expect(after).toMatchObject({ filePath: '旅行/a.jpg', originalPath: '旅行/a.jpg', group: '旅行' })
    expect(after?.x).toBe(before.x)
    expect(after?.w).toBe(before.w)

    // group 传 undefined → 移出分区（回到未分类 / 根目录）
    store.getState().setCardFileRefs([
      { id, filePath: '未分类/a.jpg', originalPath: '未分类/a.jpg', group: undefined },
    ])
    expect(store.getState().cards.find((card) => card.id === id)?.group).toBeUndefined()
  })

  it('reset 清空分区选中', async () => {
    const store = await loadedStore()
    store.getState().selectPartition(store.getState().partitions[0].id)
    store.getState().reset()
    expect(store.getState().selectedPartitionId).toBeNull()
  })
})

describe('boardStore · 手动新建分区（2026-09-14）', () => {
  const created = {
    id: 'p_009',
    name: '旅行',
    folderPath: '旅行',
    x: 320,
    y: 170,
    w: 360,
    h: 260,
    color: '#5A7D6A',
    collapsed: false,
    meta: {},
  }
  const other = { ...created, id: 'p_010', name: '素材', folderPath: '素材' }

  async function emptyStore() {
    const store = createStore(createFakeProvider([entry('a.jpg')]))
    await store.getState().loadSpace(SPACE)
    return store
  }

  it('addPartition 追加分区框（空间里还没有任何子文件夹也能建）', async () => {
    const store = await emptyStore()
    expect(store.getState().partitions).toEqual([])

    store.getState().addPartition(created)

    expect(store.getState().partitions).toEqual([created])
  })

  it('removePartitions 只移除指定 id，其余分区原样保留', async () => {
    const store = await emptyStore()
    store.getState().addPartition(created)
    store.getState().addPartition(other)

    store.getState().removePartitions([created.id])

    expect(store.getState().partitions).toEqual([other])
  })

  it('被移除的分区若正选中则清掉选中态（避免指向不存在的框）', async () => {
    const store = await emptyStore()
    store.getState().addPartition(created)
    store.getState().selectPartition(created.id)

    store.getState().removePartitions([created.id])
    expect(store.getState().selectedPartitionId).toBeNull()

    // 未选中该分区时不动选中态
    store.getState().addPartition(other)
    store.getState().selectPartition(other.id)
    store.getState().removePartitions([created.id])
    expect(store.getState().selectedPartitionId).toBe(other.id)
  })

  it('removePartitions 空数组是 no-op（不产生新数组引用）', async () => {
    const store = await emptyStore()
    store.getState().addPartition(created)
    const before = store.getState().partitions

    store.getState().removePartitions([])

    expect(store.getState().partitions).toBe(before)
  })
})

describe('boardStore.reset', () => {
  it('清空画布状态', async () => {
    const store = createStore(createFakeProvider([entry('a.jpg')]))
    await store.getState().loadSpace(SPACE)

    store.getState().reset()

    const state = store.getState()
    expect(state.status).toBe('idle')
    expect(state.spaceId).toBeNull()
    expect(state.cards).toEqual([])
    expect(state.error).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// T1.4：尺寸读取与宽高比（方案 A：不再生成缩略图，宽高比来自 read_image_size）
// ---------------------------------------------------------------------------

/** 同时实现 listDir 与 readImageSize 的假 provider */
function createSizeProvider(
  entries: DirEntry[],
  sizes: Record<string, ImageSize>,
  failFor: string[] = [],
  layoutJson?: string,
): StorageProvider {
  return {
    async listDir() {
      return entries
    },
    async readLayout() {
      return layoutJson ?? emptyLayoutJson()
    },
    async readImageSize(src: string) {
      const name = src.split('\\').pop() ?? src
      if (failFor.includes(name)) throw new Error('读取图片尺寸失败：损坏的文件')
      const info = sizes[name]
      if (!info) throw new Error(`未预期的图片：${name}`)
      return info
    },
  } as unknown as StorageProvider
}

function sizeOf(width: number, height: number): ImageSize {
  return { width, height }
}

describe('boardStore.loadSpace · 尺寸读取与宽高比（T1.4 / 方案 A）', () => {
  beforeEach(() => {
    clearCardAssets()
  })

  it('图片卡片按原图尺寸还原原始宽高比（16:9 仍是 16:9）', async () => {
    const store = createStore(
      createSizeProvider([entry('wide.jpg'), entry('square.png')], {
        'wide.jpg': sizeOf(8000, 4500),
        'square.png': sizeOf(800, 800),
      }),
    )

    await store.getState().loadSpace(SPACE)

    const [wide, square] = store.getState().cards
    expect(wide.w / wide.h).toBeCloseTo(16 / 9, 2)
    expect(square.w).toBe(square.h)
  })

  it('原图路径登记进资源表（= 空间文件夹 + filePath）', async () => {
    const store = createStore(
      createSizeProvider([entry('a.jpg')], { 'a.jpg': sizeOf(4000, 3000) }),
    )

    await store.getState().loadSpace(SPACE)

    const [card] = store.getState().cards
    expect(getCardOriginalPath(card.id)).toBe('D:\\Mindscape\\01_项目A\\a.jpg')
  })

  it('非图片文件不调 readImageSize，使用类型默认尺寸', async () => {
    // sizes 里没有 pdf，若被调用会抛「未预期的图片」
    // 本用例只关心尺寸读取：关掉旧布局迁移，避免多出一条迁移提示干扰断言
    const store = createStore(
      createSizeProvider([entry('总平面.pdf'), entry('a.jpg')], {
        'a.jpg': sizeOf(4000, 3000),
      }),
      { legacyLayoutExists: async () => false },
    )

    await store.getState().loadSpace(SPACE)

    const [pdf] = store.getState().cards
    expect(pdf.type).toBe('file')
    expect(pdf.w).toBe(CORE_CARD_TYPE_DEFAULT_SIZE.file.w)
    expect(pdf.h).toBe(CORE_CARD_TYPE_DEFAULT_SIZE.file.h)
    expect(store.getState().notices).toEqual([])
  })

  it('单张尺寸读取失败 → 该卡片退回默认尺寸，其余照常，并给出可展示的提示；原图路径仍登记', async () => {
    const store = createStore(
      createSizeProvider(
        [entry('bad.jpg'), entry('ok.jpg')],
        { 'ok.jpg': sizeOf(4000, 3000) },
        ['bad.jpg'],
      ),
      { legacyLayoutExists: async () => false },
    )

    await store.getState().loadSpace(SPACE)

    const state = store.getState()
    expect(state.status).toBe('ready')
    expect(state.cards).toHaveLength(2)

    const bad = state.cards.find((card) => card.filePath === 'bad.jpg')
    expect(bad?.w).toBe(CORE_CARD_TYPE_DEFAULT_SIZE.image.w)
    expect(getCardOriginalPath(bad!.id)).toBe('D:\\Mindscape\\01_项目A\\bad.jpg')

    expect(state.notices).toHaveLength(1)
    expect(state.notices[0]).toContain('bad.jpg')
    expect(state.notices[0]).toContain('读取图片尺寸失败：损坏的文件')
  })

  it('切换空间时清空上一批资源路径', async () => {
    const store = createStore(
      createSizeProvider([entry('a.jpg')], { 'a.jpg': sizeOf(4000, 3000) }),
    )

    await store.getState().loadSpace(SPACE)
    const firstId = store.getState().cards[0].id
    expect(getCardOriginalPath(firstId)).not.toBe('')

    store.getState().reset()
    expect(getCardOriginalPath(firstId)).toBe('')
  })

  it('资源路径先于卡片写入（渲染时一定能读到）', async () => {
    const store = createStore(
      createSizeProvider([entry('a.jpg')], { 'a.jpg': sizeOf(4000, 3000) }),
    )

    // 订阅：卡片一到就立刻查资源
    let seenAtSetTime = ''
    const unsubscribe = store.subscribe((state) => {
      if (state.status === 'ready' && state.cards[0]) {
        seenAtSetTime = getCardOriginalPath(state.cards[0].id)
      }
    })

    await store.getState().loadSpace(SPACE)
    unsubscribe()

    expect(seenAtSetTime).toBe('D:\\Mindscape\\01_项目A\\a.jpg')
  })
})

describe('boardStore.loadSpace · 竞态（快速切换空间）', () => {
  it('先发起的加载后完成时不会覆盖后发起的结果', async () => {
    let listCalls = 0
    // 用对象持有 resolve：直接写 `let resolveFirst = null` 会被 TS 的控制流分析
    // 窄化成 never（赋值发生在 Promise 执行器闭包里），到调用处就报"不可调用"
    const deferred: { resolve: ((entries: DirEntry[]) => void) | null } = { resolve: null }

    const provider = {
      async listDir() {
        listCalls += 1
        if (listCalls === 1) {
          return new Promise<DirEntry[]>((resolve) => {
            deferred.resolve = resolve
          })
        }
        return [entry('second.jpg')]
      },
    } as unknown as StorageProvider

    const store = createStore(provider)

    const firstLoad = store.getState().loadSpace(SPACE)
    const secondLoad = store.getState().loadSpace(SPACE)
    await secondLoad

    expect(store.getState().cards.map((card) => card.filePath)).toEqual(['second.jpg'])

    // 第一次的请求此刻才返回 —— 必须被丢弃
    deferred.resolve?.([entry('first.jpg')])
    await firstLoad

    expect(store.getState().cards.map((card) => card.filePath)).toEqual(['second.jpg'])
    expect(store.getState().status).toBe('ready')
  })
})

// ---------------------------------------------------------------------------
// T1.6：layout.json 恢复
// ---------------------------------------------------------------------------

/** 造一份 layout.json 文本 */
function layoutJson(mutate: (layout: Layout) => void): string {
  const layout = createEmptyLayout()
  mutate(layout)
  return JSON.stringify(layout)
}

describe('boardStore.loadSpace · layout 恢复（T1.6）', () => {
  beforeEach(() => {
    clearCardAssets()
  })

  it('恢复卡片位置与 id（不是重新排网格）', async () => {
    const store = createStore(
      createSizeProvider([entry('a.jpg')], { 'a.jpg': sizeOf(800, 600) }, [], layoutJson((layout) => {
        layout.cards.push({
          id: 'c_005',
          type: 'image',
          filePath: 'a.jpg',
          originalPath: 'a.jpg',
          x: 1500,
          y: 900,
          w: 240,
          h: 180,
          rotation: 0,
          zIndex: 0,
          note: '上次的备注',
          meta: {},
        })
      })),
    )

    await store.getState().loadSpace(SPACE)

    const [card] = store.getState().cards
    expect(card.id).toBe('c_005')
    expect(card.x).toBe(1500)
    expect(card.y).toBe(900)
    expect(card.note).toBe('上次的备注')
  })

  it('便签与文件卡上的标签在重进空间后保留（2026-09-13 回归）', async () => {
    const store = createStore(
      createSizeProvider([entry('a.jpg')], { 'a.jpg': sizeOf(800, 600) }, [], layoutJson((layout) => {
        layout.cards.push(
          {
            id: 'c_001',
            type: 'image',
            filePath: 'a.jpg',
            originalPath: 'a.jpg',
            x: 100,
            y: 100,
            w: 240,
            h: 180,
            rotation: 0,
            zIndex: 0,
            note: '',
            meta: { tags: ['文件标签'] },
          },
          {
            id: 'c_002',
            type: 'note',
            filePath: '',
            originalPath: '',
            x: 400,
            y: 100,
            w: 200,
            h: 160,
            rotation: 0,
            zIndex: 0,
            note: '想法',
            meta: { tags: ['便签标签'] },
          },
        )
      })),
    )

    await store.getState().loadSpace(SPACE)

    const cards = store.getState().cards
    const fileCard = cards.find((card) => card.id === 'c_001')
    const noteCard = cards.find((card) => card.id === 'c_002')
    // 文件卡：位置与标签以 layout 为准
    expect(fileCard).toBeDefined()
    expect(fileCard!.meta.tags).toEqual(['文件标签'])
    // 便签（无文件）：整卡保留，标签与备注不丢（此前被当「文件已丢失」丢弃）
    expect(noteCard).toBeDefined()
    expect(noteCard!.type).toBe('note')
    expect(noteCard!.meta.tags).toEqual(['便签标签'])
    expect(noteCard!.note).toBe('想法')
  })

  it('恢复视图状态（zoom / offset），对应「关掉再开视图还原」', async () => {
    const store = createStore(
      createSizeProvider([], {}, [], layoutJson((layout) => {
        layout.canvas = { zoom: 2.5, offsetX: -300, offsetY: -120 }
      })),
    )

    await store.getState().loadSpace(SPACE)

    expect(store.getState().canvas).toEqual({ zoom: 2.5, offsetX: -300, offsetY: -120 })
  })

  it('folder 里有新文件 → 接在既有卡片下方，已有位置不变', async () => {
    const store = createStore(
      createSizeProvider(
        [entry('a.jpg'), entry('新图.jpg')],
        {
          'a.jpg': sizeOf(800, 600),
          '新图.jpg': sizeOf(800, 600),
        },
        [],
        layoutJson((layout) => {
          layout.cards.push({
            id: 'c_001',
            type: 'image',
            filePath: 'a.jpg',
            originalPath: 'a.jpg',
            x: 600,
            y: 400,
            w: 240,
            h: 180,
            rotation: 0,
            zIndex: 0,
            note: '',
            meta: {},
          })
        }),
      ),
    )

    await store.getState().loadSpace(SPACE)

    const cards = store.getState().cards
    expect(cards.find((card) => card.filePath === 'a.jpg')).toMatchObject({ x: 600, y: 400 })
    expect(cards.find((card) => card.filePath === '新图.jpg')?.y).toBeGreaterThan(400)
  })

  it('layout 里有、文件夹里没有的卡片不显示', async () => {
    const store = createStore(
      createSizeProvider([entry('a.jpg')], { 'a.jpg': sizeOf(800, 600) }, [], layoutJson((layout) => {
        layout.cards.push({
          id: 'c_001',
          type: 'image',
          filePath: '已删除的老图.jpg',
          originalPath: '已删除的老图.jpg',
          x: 0,
          y: 0,
          w: 240,
          h: 180,
          rotation: 0,
          zIndex: 0,
          note: '',
          meta: {},
        })
      })),
    )

    await store.getState().loadSpace(SPACE)

    expect(store.getState().cards.map((card) => card.filePath)).toEqual(['a.jpg'])
  })

  it('布局损坏 → 退回全新布局、状态仍为 ready，并给出可展示的提示', async () => {
    const corruptMessage = '布局文件损坏，已备份为 layout.json.bak 并重建。该空间的卡片摆放与连线需要重新整理。'
    const provider = {
      async listDir() {
        return [entry('a.jpg')]
      },
      async readLayout(): Promise<string> {
        throw new StorageError(corruptMessage)
      },
    } as unknown as StorageProvider

    const store = createStore(provider)
    await store.getState().loadSpace(SPACE)

    const state = store.getState()
    expect(state.status).toBe('ready')
    expect(state.cards).toHaveLength(1)
    expect(state.readOnly).toBe(false)
    expect(state.notices).toEqual([corruptMessage])
  })

  it('数据无法识别（能读但不是合法布局）→ 退回全新布局并提示', async () => {
    const store = createStore(
      createSizeProvider([], {}, [], JSON.stringify({ version: 1, cards: 'not-an-array' })),
    )

    await store.getState().loadSpace(SPACE)

    expect(store.getState().status).toBe('ready')
    expect(store.getState().notices[0]).toContain('布局数据无法识别')
  })

  it('version 高于当前版本 → 只读模式 + 提示（17.6）', async () => {
    const store = createStore(
      createSizeProvider([], {}, [], layoutJson((layout) => {
        layout.version = 9
      })),
    )

    await store.getState().loadSpace(SPACE)

    expect(store.getState().readOnly).toBe(true)
    expect(store.getState().notices[0]).toContain('只读模式')
  })

  it('reset 清掉只读标志与提示', async () => {
    const store = createStore(
      createSizeProvider([], {}, [], layoutJson((layout) => {
        layout.version = 9
      })),
    )

    await store.getState().loadSpace(SPACE)
    expect(store.getState().readOnly).toBe(true)

    store.getState().reset()
    expect(store.getState().readOnly).toBe(false)
    expect(store.getState().notices).toEqual([])
    expect(store.getState().canvas).toEqual({ zoom: 1, offsetX: 0, offsetY: 0 })
  })
})

// ---------------------------------------------------------------------------
// 移除卡片的连线级联（2026-09-11 用户裁决）
// 用真实 store + 真实命令接线（与 Board.tsx 的注入方式一致）做一次集成验证。
// ---------------------------------------------------------------------------

describe('移除卡片 → 级联断开连线', () => {
  /** 只实现 moveFile 的假 provider（移除命令的唯一文件操作） */
  function moveProvider(): StorageProvider {
    return {
      async moveFile(_from: string, to: string) {
        return to
      },
    } as unknown as StorageProvider
  }

  function seed(store: ReturnType<typeof createBoardStore>) {
    store.setState({
      spaceId: SPACE.id,
      cards: [
        zCardSchema.parse({
          id: 'c_001',
          type: 'image',
          filePath: 'a.jpg',
          originalPath: 'a.jpg',
          x: 0,
          y: 0,
          w: 100,
          h: 80,
        }),
        zCardSchema.parse({
          id: 'c_002',
          type: 'image',
          filePath: 'b.jpg',
          originalPath: 'b.jpg',
          x: 200,
          y: 0,
          w: 100,
          h: 80,
        }),
      ],
      connections: [
        { id: 'conn_001', from: 'c_001', to: 'c_002', label: '', color: 'gray', meta: {} },
      ],
    })
  }

  it('do 后相连连线消失；undo 后连线随卡片一起回来', async () => {
    const store = createStore(createFakeProvider([]))
    seed(store)

    const history = new History()
    const [target] = store.getState().cards
    const command = createRemoveCardsCommand([target], {
      spacePath: SPACE.folderPath,
      provider: moveProvider(),
      applyRemove: (payload) => store.getState().applyRemoveCards(payload),
      applyRestore: (payload) => store.getState().applyRestoreCards(payload),
      getConnections: () => store.getState().connections,
      applyRemoveConnections: (ids) => store.getState().removeConnections(ids),
      applyAddConnections: (list) => store.getState().addConnections(list),
    })

    await history.execute(command)
    expect(store.getState().cards.map((card) => card.id)).toEqual(['c_002'])
    expect(store.getState().connections).toEqual([])

    await history.undo()
    expect(store.getState().cards.map((card) => card.id).sort()).toEqual(['c_001', 'c_002'])
    expect(store.getState().connections.map((connection) => connection.id)).toEqual(['conn_001'])
  })

  it('无关的连线在移除后仍然保留', async () => {
    const store = createStore(createFakeProvider([]))
    store.setState({
      spaceId: SPACE.id,
      cards: [
        zCardSchema.parse({
          id: 'c_001',
          type: 'image',
          filePath: 'a.jpg',
          originalPath: 'a.jpg',
          x: 0,
          y: 0,
          w: 100,
          h: 80,
        }),
        zCardSchema.parse({
          id: 'c_002',
          type: 'image',
          filePath: 'b.jpg',
          originalPath: 'b.jpg',
          x: 200,
          y: 0,
          w: 100,
          h: 80,
        }),
        zCardSchema.parse({
          id: 'c_003',
          type: 'image',
          filePath: 'c.jpg',
          originalPath: 'c.jpg',
          x: 400,
          y: 0,
          w: 100,
          h: 80,
        }),
      ],
      connections: [
        { id: 'conn_001', from: 'c_001', to: 'c_002', label: '', color: 'gray', meta: {} },
        { id: 'conn_002', from: 'c_002', to: 'c_003', label: '', color: 'gray', meta: {} },
      ],
    })

    const history = new History()
    const [target] = store.getState().cards // c_001
    await history.execute(
      createRemoveCardsCommand([target], {
        spacePath: SPACE.folderPath,
        provider: moveProvider(),
        applyRemove: (payload) => store.getState().applyRemoveCards(payload),
        applyRestore: (payload) => store.getState().applyRestoreCards(payload),
        getConnections: () => store.getState().connections,
        applyRemoveConnections: (ids) => store.getState().removeConnections(ids),
        applyAddConnections: (list) => store.getState().addConnections(list),
      }),
    )

    // c_002 ↔ c_003 与 c_001 无关，必须保留
    expect(store.getState().connections.map((connection) => connection.id)).toEqual(['conn_002'])
  })
})

// ---------------------------------------------------------------------------
// 历史脏数据自愈（2026-09-11）
//   · 新建卡片的 id 池必须含 removed 记录 id，否则新卡与已移除记录撞号；
//   · 从「已移除」恢复过的卡片，originalPath 残留 `_已移除/…` 要回填（复制粘贴失效的根因）；
//   · removed 记录 id 重复要去重（恢复按 id 匹配会命中错误记录 → 「不是文件」）；
//   · 上述任一修复发生后 needsMigration 置真，由上层补一次落盘。
// ---------------------------------------------------------------------------

describe('boardStore.loadSpace · 历史脏数据自愈', () => {
  function removedEntry(id: string, originalPath: string): RemovedEntry {
    return { id, originalPath, movedTo: `_已移除/${originalPath}` }
  }

  it('新建卡片的 id 池包含 removed 记录 id（不再与已移除记录撞号）', async () => {
    const store = createStore(
      createSizeProvider(
        [entry('a.jpg')],
        { 'a.jpg': sizeOf(800, 600) },
        [],
        layoutJson((layout) => {
          layout.removed.push(removedEntry('c_001', 'gone.jpg'))
        }),
      ),
    )

    await store.getState().loadSpace(SPACE)

    // c_001 已被 removed 记录占用 → 新扫描出的卡片必须避开它
    expect(store.getState().cards.map((card) => card.id)).toEqual(['c_002'])
    expect(store.getState().needsMigration).toBe(false)
  })

  it('脏 originalPath（恢复后残留 `_已移除/…`）回填为 filePath，并要求补一次落盘', async () => {
    const store = createStore(
      createSizeProvider(
        [entry('a.jpg')],
        { 'a.jpg': sizeOf(800, 600) },
        [],
        layoutJson((layout) => {
          layout.cards.push({
            id: 'c_005',
            type: 'image',
            filePath: 'a.jpg',
            originalPath: '_已移除/未分类/a.jpg',
            x: 10,
            y: 10,
            w: 200,
            h: 150,
            rotation: 0,
            zIndex: 0,
            note: '',
            meta: {},
          })
        }),
      ),
    )

    await store.getState().loadSpace(SPACE)

    const [card] = store.getState().cards
    expect(card.originalPath).toBe('a.jpg')
    expect(store.getState().needsMigration).toBe(true)
  })

  it('removed 记录 id 重复 → 去重并标记待落盘（否则恢复会按 id 匹配错文件）', async () => {
    const store = createStore(
      createSizeProvider(
        [],
        {},
        [],
        layoutJson((layout) => {
          layout.removed.push(removedEntry('c_039', '333/ref-43.png'))
          layout.removed.push(removedEntry('c_039', '未分类/作业_1_1.docx'))
        }),
      ),
    )

    await store.getState().loadSpace(SPACE)

    const ids = store.getState().removed.map((item) => item.id)
    expect(new Set(ids).size).toBe(2)
    expect(ids[0]).toBe('c_039') // 首现保留
    expect(store.getState().needsMigration).toBe(true)
  })

  it('干净数据：needsMigration 为 false（不做无谓落盘）', async () => {
    const store = createStore(createSizeProvider([], {}, []))
    await store.getState().loadSpace(SPACE)
    expect(store.getState().needsMigration).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// P1-2：布局存软件目录（%APPDATA%\Mindscape\layouts\<空间 id>.json）
// ---------------------------------------------------------------------------

/** 造一张有位置的卡片（字段齐全，满足 Card 类型） */
function layoutWithOneCard(x: number, y: number) {
  return layoutJson((layout) => {
    layout.cards.push({
      id: 'c_100',
      type: 'image',
      filePath: 'a.jpg',
      originalPath: 'a.jpg',
      x,
      y,
      w: 240,
      h: 180,
      rotation: 0,
      zIndex: 0,
      note: '',
      meta: {},
    })
  })
}

describe('boardStore.loadSpace · 布局存软件目录（P1-2）', () => {
  beforeEach(() => {
    clearCardAssets()
  })

  it('软件目录里有布局时优先用它，且不会去读空间文件夹里的旧文件', async () => {
    let legacyReadCount = 0
    const provider = {
      async listDir() {
        return [entry('a.jpg')]
      },
      async readLayout() {
        legacyReadCount += 1
        return layoutWithOneCard(9999, 9999)
      },
    } as unknown as StorageProvider

    const store = createStore(provider, { read: async () => layoutWithOneCard(1500, 900) })
    await store.getState().loadSpace(SPACE)

    const card = store.getState().cards[0]
    expect([card.x, card.y]).toEqual([1500, 900])
    expect(legacyReadCount).toBe(0)
  })

  it('软件目录没有、空间文件夹里有旧布局 → 读旧文件、迁移写回并提示（不删旧文件）', async () => {
    const writes: { id: string; json: string }[] = []
    const provider = {
      async listDir() {
        return [entry('a.jpg')]
      },
      async readLayout() {
        return layoutWithOneCard(1500, 900)
      },
    } as unknown as StorageProvider

    const store = createStore(provider, {
      write: async (id, json) => {
        writes.push({ id, json })
      },
    })
    await store.getState().loadSpace(SPACE)

    // 布局生效
    expect(store.getState().cards[0].x).toBe(1500)
    // 已按空间 id 迁移写回软件目录
    expect(writes).toHaveLength(1)
    expect(writes[0].id).toBe(SPACE.id)
    expect(JSON.parse(writes[0].json).cards[0].x).toBe(1500)
    // 有可展示的迁移提示
    expect(store.getState().notices.some((notice) => notice.includes('已迁移到软件目录'))).toBe(true)
  })

  it('迁移写回失败 → 仍按旧布局打开，并说明迁移失败', async () => {
    const provider = {
      async listDir() {
        return [entry('a.jpg')]
      },
      async readLayout() {
        return layoutWithOneCard(1500, 900)
      },
    } as unknown as StorageProvider

    const store = createStore(provider, {
      write: async () => {
        throw new Error('磁盘写保护')
      },
    })
    await store.getState().loadSpace(SPACE)

    expect(store.getState().status).toBe('ready')
    expect(store.getState().cards[0].x).toBe(1500)
    expect(store.getState().notices.some((notice) => notice.includes('迁移失败'))).toBe(true)
  })

  it('全新空间（软件目录与空间文件夹都没有布局）→ 空布局、无提示、不写盘', async () => {
    let writeCount = 0
    const provider = {
      async listDir() {
        return [entry('a.jpg')]
      },
      async readLayout() {
        throw new Error('不该被调用：没有旧布局就不该读旧位置')
      },
    } as unknown as StorageProvider

    const store = createStore(provider, {
      legacyLayoutExists: async () => false,
      write: async () => {
        writeCount += 1
      },
    })
    await store.getState().loadSpace(SPACE)

    expect(store.getState().status).toBe('ready')
    expect(store.getState().notices).toEqual([])
    expect(writeCount).toBe(0)
  })

  it('只读版本（version 超过 DATA_VERSION）不迁移写盘', async () => {
    let writeCount = 0
    const future = JSON.stringify({ ...JSON.parse(emptyLayoutJson()), version: 99 })
    const provider = {
      async listDir() {
        return [entry('a.jpg')]
      },
      async readLayout() {
        return future
      },
    } as unknown as StorageProvider

    const store = createStore(provider, {
      write: async () => {
        writeCount += 1
      },
    })
    await store.getState().loadSpace(SPACE)

    expect(store.getState().readOnly).toBe(true)
    expect(writeCount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 彻底删除（2026-09-15 用户需求）：已移除视图的「永久删除」清内存态。
//   · removed 记录 + 灰卡（removedCards）+ 选中态三者一起清，无关项保留；
//   · 文件真删由流程层先行完成，这里只验证内存清理语义。
// ---------------------------------------------------------------------------

describe('boardStore.applyDeleteRemovedCards · 彻底删除内存清理', () => {
  function removedEntryOf(id: string, originalPath: string): RemovedEntry {
    return { id, originalPath, movedTo: `_已移除/${originalPath}` }
  }

  function removedCard(id: string, filePath: string) {
    return zCardSchema.parse({
      id,
      type: 'image',
      filePath,
      originalPath: filePath,
      x: 0,
      y: 0,
      w: 100,
      h: 80,
    })
  }

  function seedRemovedState(store: ReturnType<typeof createBoardStore>) {
    store.setState({
      removed: [removedEntryOf('c_001', 'gone.jpg'), removedEntryOf('c_002', 'keep.jpg')],
      removedCards: [removedCard('c_001', '_已移除/gone.jpg'), removedCard('c_002', '_已移除/keep.jpg')],
      selectedIds: ['c_001', 'c_002'],
    })
  }

  it('删除目标：removed 记录、灰卡、选中态三者一起清掉', () => {
    const store = createStore(createFakeProvider([]))
    seedRemovedState(store)

    store.getState().applyDeleteRemovedCards({ cardIds: ['c_001'], entryIds: ['c_001'] })

    expect(store.getState().removed.map((item) => item.id)).toEqual(['c_002'])
    expect(store.getState().removedCards.map((card) => card.id)).toEqual(['c_002'])
    expect(store.getState().selectedIds).toEqual(['c_002'])
  })

  it('无关的记录与卡片保留（只清传入的 id）', () => {
    const store = createStore(createFakeProvider([]))
    seedRemovedState(store)
    // 追加一个不在删除清单里的选中项（例如同视图另一张卡片）
    store.setState({ selectedIds: ['c_001', 'c_002', 'c_009'] })

    store.getState().applyDeleteRemovedCards({ cardIds: ['c_001'], entryIds: ['c_001'] })

    expect(store.getState().removed.map((item) => item.id)).toEqual(['c_002'])
    expect(store.getState().removedCards.map((card) => card.id)).toEqual(['c_002'])
    expect(store.getState().selectedIds).toEqual(['c_002', 'c_009'])
  })

  it('空清单是 no-op（早退，不触发任何变更）', () => {
    const store = createStore(createFakeProvider([]))
    seedRemovedState(store)
    const before = store.getState()

    store.getState().applyDeleteRemovedCards({ cardIds: [], entryIds: [] })

    expect(store.getState().removed).toBe(before.removed)
    expect(store.getState().removedCards).toBe(before.removedCards)
    expect(store.getState().selectedIds).toBe(before.selectedIds)
  })
})
