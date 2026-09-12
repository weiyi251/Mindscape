// ============================================================================
// 模块说明（中文）
// 空间列表 store 单元测试（对应 T1.1 / T1.2）。
// 用内存网关替换 Tauri fs，因此完全不依赖桌面环境。
//
// 实现任务：T1.1 / T1.2（阶段一）。
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest'

import { createSpacesStore, validateNewSpace } from '@/core/store/spacesStore'
import type { Space, SpacesFile } from '@/core/types'

interface MemoryGatewayOptions {
  file?: SpacesFile
  corrupted?: boolean
  error?: string
  loadError?: string
}

/** 内存网关：记录每次 save 的内容，便于断言落盘行为 */
function createMemoryGateway(options: MemoryGatewayOptions = {}) {
  let stored: SpacesFile = options.file ?? { version: 1, spaces: [] }
  const saves: SpacesFile[] = []
  let loadCount = 0

  const gateway = {
    async load() {
      loadCount += 1
      if (options.loadError) throw new Error(options.loadError)
      return { file: stored, corrupted: options.corrupted ?? false, error: options.error }
    },
    async save(file: SpacesFile) {
      stored = file
      saves.push(file)
    },
  }

  return {
    gateway,
    saves,
    get stored() {
      return stored
    },
    get loadCount() {
      return loadCount
    },
  }
}

function makeSpace(over: Partial<Space> = {}): Space {
  return {
    id: 'sp_001',
    name: '项目A',
    type: '项目',
    folderPath: 'D:\\Mindscape\\01_项目A',
    createdAt: '2026-09-10T11:00:00',
    lastOpenedAt: '2026-09-10T11:00:00',
    favorite: false,
    meta: {},
    ...over,
  }
}

describe('load', () => {
  it('初始状态为 idle', () => {
    const store = createSpacesStore(createMemoryGateway().gateway)
    expect(store.getState().status).toBe('idle')
    expect(store.getState().spaces).toEqual([])
  })

  it('读取成功 → ready，并按最近打开时间倒序', async () => {
    const memory = createMemoryGateway({
      file: {
        version: 1,
        spaces: [
          makeSpace({ id: 'sp_001', lastOpenedAt: '2026-09-01T10:00:00' }),
          makeSpace({ id: 'sp_002', lastOpenedAt: '2026-09-09T10:00:00' }),
        ],
      },
    })
    const store = createSpacesStore(memory.gateway)

    await store.getState().load()

    const state = store.getState()
    expect(state.status).toBe('ready')
    expect(state.spaces.map((item) => item.id)).toEqual(['sp_002', 'sp_001'])
  })

  it('文件损坏 → 以空列表启动并给出提示（不覆盖原文件）', async () => {
    const memory = createMemoryGateway({ corrupted: true, error: 'JSON 解析失败：xxx' })
    const store = createSpacesStore(memory.gateway)

    await store.getState().load()

    const state = store.getState()
    expect(state.status).toBe('ready')
    expect(state.spaces).toEqual([])
    expect(state.corruptedNotice).toContain('spaces.json')
    expect(state.corruptedNotice).toContain('JSON 解析失败')
    // 损坏时不应写盘
    expect(memory.saves).toHaveLength(0)
  })

  it('读取抛错 → status=error 且带中文原因', async () => {
    const store = createSpacesStore(createMemoryGateway({ loadError: '拒绝访问' }).gateway)

    await store.getState().load()

    expect(store.getState().status).toBe('error')
    expect(store.getState().error).toBe('拒绝访问')
  })
})

describe('createSpace', () => {
  let memory: ReturnType<typeof createMemoryGateway>

  beforeEach(() => {
    memory = createMemoryGateway()
  })

  it('生成 sp_001、时间戳符合 4.1 格式，并立即落盘', async () => {
    const store = createSpacesStore(memory.gateway)

    const space = await store.getState().createSpace({
      name: '项目A',
      type: '项目',
      folderPath: 'D:\\Mindscape\\01_项目A',
    })

    expect(space.id).toBe('sp_001')
    expect(space.name).toBe('项目A')
    expect(space.type).toBe('项目')
    expect(space.meta).toEqual({})
    expect(space.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
    expect(space.lastOpenedAt).toBe(space.createdAt)

    expect(memory.saves).toHaveLength(1)
    expect(memory.stored.spaces).toHaveLength(1)
    expect(memory.stored.spaces[0].id).toBe('sp_001')
  })

  it('连续新建 → 序号递增，新建的排在最前', async () => {
    const store = createSpacesStore(memory.gateway)

    await store.getState().createSpace({ name: 'A', type: '项目', folderPath: 'D:\\a' })
    await store.getState().createSpace({ name: 'B', type: '课题', folderPath: 'D:\\b' })

    const ids = store.getState().spaces.map((item) => item.id)
    expect(ids).toContain('sp_001')
    expect(ids).toContain('sp_002')
    expect(memory.stored.spaces).toHaveLength(2)
  })

  it('名称为空 → 抛中文错误且不落盘', async () => {
    const store = createSpacesStore(memory.gateway)

    await expect(
      store.getState().createSpace({ name: '   ', type: '项目', folderPath: 'D:\\a' }),
    ).rejects.toThrow('空间名称不能为空')
    expect(memory.saves).toHaveLength(0)
  })

  it('未选文件夹 → 抛中文错误', async () => {
    const store = createSpacesStore(memory.gateway)

    await expect(
      store.getState().createSpace({ name: 'A', type: '项目', folderPath: '' }),
    ).rejects.toThrow('请选择空间文件夹')
  })

  it('同名空间 → 拒绝', async () => {
    const store = createSpacesStore(memory.gateway)
    await store.getState().createSpace({ name: '项目A', type: '项目', folderPath: 'D:\\a' })

    await expect(
      store.getState().createSpace({ name: '项目A', type: '课题', folderPath: 'D:\\b' }),
    ).rejects.toThrow('已存在名为「项目A」的空间')
  })

  it('名称前后空格会被去掉', async () => {
    const store = createSpacesStore(memory.gateway)
    const space = await store.getState().createSpace({
      name: '  项目A  ',
      type: '项目',
      folderPath: 'D:\\a',
    })
    expect(space.name).toBe('项目A')
  })
})

describe('removeSpace / openSpace / closeSpace', () => {
  it('移除只删记录并落盘', async () => {
    const memory = createMemoryGateway({
      file: { version: 1, spaces: [makeSpace({ id: 'sp_001' }), makeSpace({ id: 'sp_002' })] },
    })
    const store = createSpacesStore(memory.gateway)
    await store.getState().load()

    await store.getState().removeSpace('sp_001')

    expect(store.getState().spaces.map((item) => item.id)).toEqual(['sp_002'])
    expect(memory.stored.spaces.map((item) => item.id)).toEqual(['sp_002'])
  })

  it('移除的正是当前空间 → currentSpaceId 归位', async () => {
    const memory = createMemoryGateway({
      file: { version: 1, spaces: [makeSpace({ id: 'sp_001' })] },
    })
    const store = createSpacesStore(memory.gateway)
    await store.getState().load()
    await store.getState().openSpace('sp_001')
    expect(store.getState().currentSpaceId).toBe('sp_001')

    await store.getState().removeSpace('sp_001')

    expect(store.getState().currentSpaceId).toBeNull()
  })

  it('openSpace 更新 lastOpenedAt、设置 currentSpaceId 并落盘', async () => {
    const memory = createMemoryGateway({
      file: { version: 1, spaces: [makeSpace({ id: 'sp_001', lastOpenedAt: '2020-01-01T00:00:00' })] },
    })
    const store = createSpacesStore(memory.gateway)
    await store.getState().load()

    const space = await store.getState().openSpace('sp_001')

    expect(space).not.toBeNull()
    expect(store.getState().currentSpaceId).toBe('sp_001')
    expect(memory.stored.spaces[0].lastOpenedAt).not.toBe('2020-01-01T00:00:00')
  })

  it('openSpace 传入不存在的 id → 返回 null 且不落盘', async () => {
    const memory = createMemoryGateway()
    const store = createSpacesStore(memory.gateway)
    await store.getState().load()

    const space = await store.getState().openSpace('sp_999')

    expect(space).toBeNull()
    expect(store.getState().currentSpaceId).toBeNull()
    expect(memory.saves).toHaveLength(0)
  })

  it('closeSpace 返回列表页', async () => {
    const memory = createMemoryGateway({
      file: { version: 1, spaces: [makeSpace({ id: 'sp_001' })] },
    })
    const store = createSpacesStore(memory.gateway)
    await store.getState().load()
    await store.getState().openSpace('sp_001')

    store.getState().closeSpace()

    expect(store.getState().currentSpaceId).toBeNull()
  })

  it('getCurrentSpace 返回完整对象', async () => {
    const memory = createMemoryGateway({
      file: { version: 1, spaces: [makeSpace({ id: 'sp_001', name: '项目A' })] },
    })
    const store = createSpacesStore(memory.gateway)
    await store.getState().load()
    await store.getState().openSpace('sp_001')

    expect(store.getState().getCurrentSpace()?.name).toBe('项目A')

    store.getState().closeSpace()
    expect(store.getState().getCurrentSpace()).toBeNull()
  })
})

describe('validateNewSpace', () => {
  it('合法输入返回 null', () => {
    expect(validateNewSpace({ name: 'A', type: '项目', folderPath: 'D:\\a' }, [])).toBeNull()
  })

  it('逐条给出中文原因', () => {
    expect(validateNewSpace({ name: '', type: '项目', folderPath: 'D:\\a' }, [])).toBe(
      '空间名称不能为空',
    )
    expect(validateNewSpace({ name: 'A', type: '项目', folderPath: '' }, [])).toBe(
      '请选择空间文件夹',
    )
    expect(validateNewSpace({ name: 'A', type: ' ', folderPath: 'D:\\a' }, [])).toBe(
      '空间类型不能为空',
    )
  })
})

// ---------------------------------------------------------------------------
// T1.2 验收：关闭应用再开，空间列表与之前一致
// ---------------------------------------------------------------------------

describe('T1.2 重启恢复', () => {
  it('同一份磁盘数据下，新实例 load 出来的列表与上一次完全一致', async () => {
    const memory = createMemoryGateway()

    // 第一次运行：建两个空间
    const firstRun = createSpacesStore(memory.gateway)
    await firstRun.getState().createSpace({
      name: '项目A',
      type: '项目',
      folderPath: 'D:\\Mindscape\\01_项目A',
    })
    await firstRun.getState().createSpace({
      name: '灵感库',
      type: '灵感库',
      folderPath: 'D:\\Mindscape\\02_灵感库',
    })

    // 模拟重启：新 store 实例，从同一份磁盘数据加载
    const secondRun = createSpacesStore(memory.gateway)
    await secondRun.getState().load()

    expect(secondRun.getState().status).toBe('ready')
    expect(secondRun.getState().spaces).toEqual(firstRun.getState().spaces)
    expect(secondRun.getState().spaces.map((space) => space.name)).toEqual(['灵感库', '项目A'])
  })

  it('落盘内容符合 4.1 结构（version + spaces 数组）', async () => {
    const memory = createMemoryGateway()
    const store = createSpacesStore(memory.gateway)

    await store.getState().createSpace({ name: 'A', type: '课题', folderPath: 'D:\\a' })

    expect(memory.stored.version).toBe(1)
    expect(Array.isArray(memory.stored.spaces)).toBe(true)
    expect(Object.keys(memory.stored.spaces[0]).sort()).toEqual(
      ['createdAt', 'favorite', 'folderPath', 'id', 'lastOpenedAt', 'meta', 'name', 'type'].sort(),
    )
  })

  it('重启后 lastOpenedAt 顺序被保留（最近打开的仍在最前）', async () => {
    const memory = createMemoryGateway({
      file: {
        version: 1,
        spaces: [
          makeSpace({ id: 'sp_001', name: '早', lastOpenedAt: '2026-09-01T00:00:00' }),
          makeSpace({ id: 'sp_002', name: '晚', lastOpenedAt: '2026-09-09T00:00:00' }),
        ],
      },
    })

    const store = createSpacesStore(memory.gateway)
    await store.getState().load()

    expect(store.getState().spaces.map((space) => space.name)).toEqual(['晚', '早'])
  })
})

describe('renameSpace（P1-5）', () => {
  const setup = async () => {
    const memory = createMemoryGateway({
      file: {
        version: 1,
        spaces: [
          makeSpace({ id: 'sp_001', name: '项目A', lastOpenedAt: '2026-09-01T00:00:00' }),
          makeSpace({ id: 'sp_002', name: '项目B', lastOpenedAt: '2026-09-09T00:00:00' }),
        ],
      },
    })
    const store = createSpacesStore(memory.gateway)
    await store.getState().load()
    return { memory, store }
  }

  it('改名成功并落盘；重启后仍是新名', async () => {
    const { memory, store } = await setup()
    await store.getState().renameSpace('sp_001', '新名字')
    expect(store.getState().spaces.find((space) => space.id === 'sp_001')?.name).toBe('新名字')
    expect(memory.stored.spaces.find((space) => space.id === 'sp_001')?.name).toBe('新名字')

    // 模拟重启：新 store 实例从同一份数据加载
    const secondRun = createSpacesStore(memory.gateway)
    await secondRun.getState().load()
    expect(secondRun.getState().spaces.find((space) => space.id === 'sp_001')?.name).toBe('新名字')
  })

  it('空名 / 纯空白拒绝', async () => {
    const { store } = await setup()
    await expect(store.getState().renameSpace('sp_001', '   ')).rejects.toThrow('空间名称不能为空')
  })

  it('与其他空间重名拒绝', async () => {
    const { store } = await setup()
    await expect(store.getState().renameSpace('sp_001', '项目B')).rejects.toThrow(
      '已存在名为「项目B」的空间',
    )
  })

  it('改成原名是空操作（不落盘、不报错）', async () => {
    const { memory, store } = await setup()
    const savesBefore = memory.saves.length
    await store.getState().renameSpace('sp_001', '项目A')
    expect(memory.saves.length).toBe(savesBefore)
  })

  it('不存在的 id 报中文错误', async () => {
    const { store } = await setup()
    await expect(store.getState().renameSpace('sp_404', '任意')).rejects.toThrow('空间不存在')
  })
})

describe('toggleSpaceFavorite（P1-5）', () => {
  const setup = async () => {
    const memory = createMemoryGateway({
      file: {
        version: 1,
        spaces: [
          makeSpace({ id: 'sp_001', name: '较早未收藏', lastOpenedAt: '2026-09-01T00:00:00' }),
          makeSpace({ id: 'sp_002', name: '较新未收藏', lastOpenedAt: '2026-09-09T00:00:00' }),
        ],
      },
    })
    const store = createSpacesStore(memory.gateway)
    await store.getState().load()
    return { memory, store }
  }

  it('收藏后排在未收藏前面并落盘；再切一次恢复原排序', async () => {
    const { memory, store } = await setup()

    await store.getState().toggleSpaceFavorite('sp_001')
    expect(store.getState().spaces.map((space) => space.id)).toEqual(['sp_001', 'sp_002'])
    expect(memory.stored.spaces.find((space) => space.id === 'sp_001')?.favorite).toBe(true)

    await store.getState().toggleSpaceFavorite('sp_001')
    expect(store.getState().spaces.map((space) => space.id)).toEqual(['sp_002', 'sp_001'])
    expect(memory.stored.spaces.find((space) => space.id === 'sp_001')?.favorite).toBe(false)
  })

  it('不存在的 id 是空操作（不崩、不落盘）', async () => {
    const { memory, store } = await setup()
    const savesBefore = memory.saves.length
    await store.getState().toggleSpaceFavorite('sp_404')
    expect(memory.saves.length).toBe(savesBefore)
  })
})
