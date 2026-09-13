// ============================================================================
// 模块说明（中文）
// 快捷键绑定的持久化 store（2026-09-13 新增，对应「自定义快捷键」需求）。
//
// 设计取舍：
//   · 纯逻辑（默认表 / 匹配 / 冲突 / 序列化）全在 core/shortcuts/keys.ts，
//     本文件只负责「状态 + 落盘」，这样 node 环境可注入内存存储做单测
//     （与 createBoardStore 的 storage 注入是同一套路）；
//   · 读写键 `mindscape.shortcuts`；localStorage 不可用（无痕 / 非浏览器）
//     时静默降级为「本次有效、不记忆」，绝不让快捷键配置把应用拖挂；
//   · 键盘分流处用 `useShortcutsStore.getState()` 同步读，不进 React 订阅 ——
//     按键是高频路径，不能因为改绑定而让画布重渲染（对应 17.3 的精神）。
// ============================================================================

import { create } from 'zustand'

import {
  defaultBindings,
  defaultComboOf,
  parseBindings,
  serializeBindings,
} from '@/core/shortcuts/keys'
import type { ShortcutBindings, ShortcutCombo, ShortcutId } from '@/core/shortcuts/keys'

/** 快捷键偏好的 localStorage 键名 */
export const SHORTCUTS_PREF_KEY = 'mindscape.shortcuts'

/** 可注入的存储通道（单测注入内存实现） */
export interface ShortcutStorage {
  read: () => string | null
  write: (value: string) => void
}

/** 默认存储：localStorage；不可用时读回 null / 写入丢弃（只影响「记忆」） */
export const localShortcutStorage: ShortcutStorage = {
  read() {
    try {
      return localStorage.getItem(SHORTCUTS_PREF_KEY)
    } catch {
      return null
    }
  },
  write(value) {
    try {
      localStorage.setItem(SHORTCUTS_PREF_KEY, value)
    } catch {
      // 无痕模式等：不记忆，但当前会话的绑定照常生效
    }
  },
}

/** 内存实现（单测用；也可作为 localStorage 不可用时的兜底） */
export function createMemoryShortcutStorage(initial: string | null = null): ShortcutStorage {
  let current = initial
  return {
    read: () => current,
    write: (value) => {
      current = value
    },
  }
}

export interface ShortcutsState {
  /** 当前绑定（永远是完整的表：缺项已在 parseBindings 里回落到默认） */
  bindings: ShortcutBindings
  /** 改绑某个操作并立即落盘 */
  setBinding: (id: ShortcutId, value: ShortcutCombo) => void
  /** 某一项恢复默认并落盘 */
  resetBinding: (id: ShortcutId) => void
  /** 全部恢复默认并落盘 */
  resetAll: () => void
}

/**
 * 建一个快捷键 store。storage 可注入，默认落 localStorage。
 * 初始值在创建时读一次存储；坏数据由 parseBindings 兜底成默认表。
 */
export function createShortcutsStore(storage: ShortcutStorage = localShortcutStorage) {
  return create<ShortcutsState>((set, get) => ({
    bindings: parseBindings(storage.read()),

    setBinding: (id, value) => {
      const next = { ...get().bindings, [id]: { ...value } }
      set({ bindings: next })
      storage.write(serializeBindings(next))
    },

    resetBinding: (id) => {
      const next = { ...get().bindings, [id]: defaultComboOf(id) }
      set({ bindings: next })
      storage.write(serializeBindings(next))
    },

    resetAll: () => {
      const next = defaultBindings()
      set({ bindings: next })
      storage.write(serializeBindings(next))
    },
  }))
}

/** 应用级单例（画布 / 顶栏 / 设置页共用同一份绑定） */
export const useShortcutsStore = createShortcutsStore()
