// ============================================================================
// 模块说明（中文）
// 空间列表状态（Zustand）。对应 17.3 的划分：
//   「Zustand（低频、需要触发 React 重渲染的数据）：空间列表、当前空间元数据」
//   —— 空间列表只在新建/删除/打开时变化，属低频数据，放这里完全合适；
//      画布上每帧变动的坐标则一律放 ref（见 canvas/interaction）。
//
// 单一数据源：spaces.json。内存态为准，任何变更后立即落盘（17.6 的防抖 500ms
// 是给 layout.json 的；spaces.json 变更频率极低，直接写更安全，避免丢数据）。
//
// 工厂函数 createSpacesStore 便于单元测试注入内存网关。
//
// 实现任务：T1.1 / T1.2（阶段一）。
// ============================================================================

import { create } from 'zustand'

import type { Space } from '@/core/types'
import { createEmptySpacesFile } from '@/core/types'
import { nextSpaceId } from '@/core/utils/id'
import { nowIsoSeconds } from '@/core/utils/time'
import { localStorageProvider } from '@/core/storage/LocalFolderProvider'
import { createSpacesFileGateway, sortSpacesForList } from '@/core/storage/spacesFile'
import type { SpacesFileGateway } from '@/core/storage/spacesFile'

/** 新建空间的入参 */
export interface NewSpaceInput {
  name: string
  type: string
  folderPath: string
}

export interface SpacesState {
  /** 全部空间，按「收藏 → 最近打开」排序（P1-5） */
  spaces: Space[]
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** 加载失败时的中文提示（spaces.json 自身损坏不会进这里，会走 corruptedNotice） */
  error: string | null
  /** spaces.json 损坏时的提示文案（原文件已备份为 .bak） */
  corruptedNotice: string | null
  /** 当前打开的空间 id；为 null 表示停留在空间列表页 */
  currentSpaceId: string | null

  /** 启动时加载空间列表（T1.2） */
  load: () => Promise<void>
  /** 新建空间并落盘 */
  createSpace: (input: NewSpaceInput) => Promise<Space>
  /** 从列表移除空间（只删记录，不动硬盘文件夹） */
  removeSpace: (id: string) => Promise<void>
  /** 重命名空间（P1-5）：只改显示名，绑定的文件夹不动 */
  renameSpace: (id: string, newName: string) => Promise<void>
  /** 切换收藏（P1-5）：收藏的排在列表前面 */
  toggleSpaceFavorite: (id: string) => Promise<void>
  /** 进入空间：更新 lastOpenedAt 并落盘（T1.2/T1.3） */
  openSpace: (id: string) => Promise<Space | null>
  /** 返回空间列表 */
  closeSpace: () => void
  /** 取当前空间对象 */
  getCurrentSpace: () => Space | null
}

/** 默认网关（真实 Tauri fs）；测试用 createSpacesStore(fakeGateway) 覆盖 */
const defaultGateway = createSpacesFileGateway(localStorageProvider)

/** 校验新建入参，返回中文错误或 null */
export function validateNewSpace(input: NewSpaceInput, existing: Space[]): string | null {
  if (input.name.trim() === '') return '空间名称不能为空'
  if (input.folderPath.trim() === '') return '请选择空间文件夹'
  if (input.type.trim() === '') return '空间类型不能为空'
  if (existing.some((space) => space.name === input.name.trim())) {
    return `已存在名为「${input.name.trim()}」的空间`
  }
  return null
}

export function createSpacesStore(gateway: SpacesFileGateway = defaultGateway) {
  return create<SpacesState>((set, get) => {
    /** 把内存态整份落盘 */
    async function persist(spaces: Space[]): Promise<void> {
      const file = createEmptySpacesFile()
      file.spaces = spaces
      await gateway.save(file)
    }

    return {
      spaces: [],
      status: 'idle',
      error: null,
      corruptedNotice: null,
      currentSpaceId: null,

      async load() {
        set({ status: 'loading', error: null })
        try {
          const interpreted = await gateway.load()
          set({
            spaces: sortSpacesForList(interpreted.file.spaces),
            status: 'ready',
            corruptedNotice: interpreted.corrupted
              ? `${interpreted.error ?? 'spaces.json 解析失败'}；原文件已备份为 spaces.json.bak，本次以空列表启动。`
              : null,
          })
        } catch (error) {
          set({
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
          })
        }
      },

      async createSpace(input) {
        const existing = get().spaces
        const problem = validateNewSpace(input, existing)
        if (problem) throw new Error(problem)

        const now = nowIsoSeconds()
        const space: Space = {
          id: nextSpaceId(existing.map((item) => item.id)),
          name: input.name.trim(),
          type: input.type.trim(),
          folderPath: input.folderPath.trim(),
          createdAt: now,
          lastOpenedAt: now,
          favorite: false,
          meta: {},
        }

        const next = sortSpacesForList([space, ...existing])
        await persist(next)
        set({ spaces: next })
        return space
      },

      async removeSpace(id) {
        const next = get().spaces.filter((space) => space.id !== id)
        await persist(next)
        set({
          spaces: next,
          currentSpaceId: get().currentSpaceId === id ? null : get().currentSpaceId,
        })
      },

      async renameSpace(id, newName) {
        const trimmed = newName.trim()
        if (trimmed === '') throw new Error('空间名称不能为空')

        const spaces = get().spaces
        const target = spaces.find((space) => space.id === id)
        if (!target) throw new Error('空间不存在，可能已被移除')
        if (spaces.some((space) => space.id !== id && space.name === trimmed)) {
          throw new Error(`已存在名为「${trimmed}」的空间`)
        }
        if (trimmed === target.name) return

        const next = sortSpacesForList(
          spaces.map((space) => (space.id === id ? { ...space, name: trimmed } : space)),
        )
        await persist(next)
        set({ spaces: next })
      },

      async toggleSpaceFavorite(id) {
        const target = get().spaces.find((space) => space.id === id)
        if (!target) return

        const next = sortSpacesForList(
          get().spaces.map((space) =>
            space.id === id ? { ...space, favorite: !space.favorite } : space,
          ),
        )
        await persist(next)
        set({ spaces: next })
      },

      async openSpace(id) {
        const target = get().spaces.find((space) => space.id === id)
        if (!target) return null

        const updated: Space = { ...target, lastOpenedAt: nowIsoSeconds() }
        const next = sortSpacesForList(
          get().spaces.map((space) => (space.id === id ? updated : space)),
        )
        await persist(next)
        set({ spaces: next, currentSpaceId: id })
        return updated
      },

      closeSpace() {
        set({ currentSpaceId: null })
      },

      getCurrentSpace() {
        const { spaces, currentSpaceId } = get()
        if (!currentSpaceId) return null
        return spaces.find((space) => space.id === currentSpaceId) ?? null
      },
    }
  })
}

/** 应用默认实例 */
export const useSpacesStore = createSpacesStore()
