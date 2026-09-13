// ============================================================================
// 模块说明（中文）
// shortcutsStore 的单测（node 环境，注入内存存储，不碰真实 localStorage）。
// ============================================================================
import { describe, expect, it } from 'vitest'

import {
  createMemoryShortcutStorage,
  createShortcutsStore,
  SHORTCUTS_PREF_KEY,
} from './shortcutsStore'
import { defaultBindings, defaultComboOf, parseBindings, serializeBindings } from '@/core/shortcuts/keys'
import type { ShortcutCombo } from '@/core/shortcuts/keys'

/** 构造组合键绑定 */
function bind(code: string, mods: Partial<ShortcutCombo> = {}): ShortcutCombo {
  return { ctrl: mods.ctrl ?? false, shift: mods.shift ?? false, alt: mods.alt ?? false, code }
}

describe('createMemoryShortcutStorage（单测用的内存存储）', () => {
  it('写入后可读回，初始为空', () => {
    const storage = createMemoryShortcutStorage()
    expect(storage.read()).toBeNull()
    storage.write('hello')
    expect(storage.read()).toBe('hello')
  })

  it('可用初始值构造', () => {
    expect(createMemoryShortcutStorage('seed').read()).toBe('seed')
  })
})

describe('createShortcutsStore（状态 + 落盘）', () => {
  it('初始绑定 = 默认表（存储为空）', () => {
    const store = createShortcutsStore(createMemoryShortcutStorage())
    expect(store.getState().bindings).toEqual(defaultBindings())
  })

  it('改绑：状态更新 + 立即落盘，可被新实例读回', () => {
    const storage = createMemoryShortcutStorage()
    const store = createShortcutsStore(storage)

    store.getState().setBinding('view.fit', bind('KeyG', { ctrl: true }))

    expect(store.getState().bindings['view.fit']).toEqual(bind('KeyG', { ctrl: true }))
    // 落盘内容与内存状态一致
    expect(parseBindings(storage.read())).toEqual(store.getState().bindings)
    // 新实例（模拟重启）读回同样的绑定
    expect(createShortcutsStore(storage).getState().bindings['view.fit']).toEqual(
      bind('KeyG', { ctrl: true }),
    )
  })

  it('改绑不回写其它项（其余保持原值）', () => {
    const store = createShortcutsStore(createMemoryShortcutStorage())
    const before = store.getState().bindings
    store.getState().setBinding('canvas.search', bind('KeyG', { ctrl: true }))
    const after = store.getState().bindings

    expect(after['canvas.search']).toEqual(bind('KeyG', { ctrl: true }))
    for (const id of Object.keys(before) as (keyof typeof before)[]) {
      if (id === 'canvas.search') continue
      expect(after[id]).toEqual(before[id])
    }
  })

  it('单项恢复默认：只影响该项，并落盘', () => {
    const storage = createMemoryShortcutStorage()
    const store = createShortcutsStore(storage)

    store.getState().setBinding('edit.undo', bind('KeyG', { ctrl: true }))
    store.getState().setBinding('edit.redo', bind('KeyH', { ctrl: true }))
    store.getState().resetBinding('edit.undo')

    expect(store.getState().bindings['edit.undo']).toEqual(defaultComboOf('edit.undo'))
    expect(store.getState().bindings['edit.redo']).toEqual(bind('KeyH', { ctrl: true }))
    expect(parseBindings(storage.read())['edit.undo']).toEqual(defaultComboOf('edit.undo'))
  })

  it('全部恢复默认：整表回到默认并落盘', () => {
    const storage = createMemoryShortcutStorage()
    const store = createShortcutsStore(storage)

    store.getState().setBinding('view.fit', bind('KeyG', { ctrl: true }))
    store.getState().setBinding('card.copy', bind('KeyH', { ctrl: true }))
    store.getState().resetAll()

    expect(store.getState().bindings).toEqual(defaultBindings())
    expect(parseBindings(storage.read())).toEqual(defaultBindings())
  })

  it('存储里是坏数据 → 回落默认表，不抛错', () => {
    const storage = createMemoryShortcutStorage('{ 这不是 JSON')
    const store = createShortcutsStore(storage)
    expect(store.getState().bindings).toEqual(defaultBindings())
  })

  it('存储里只有部分键 → 其余回落默认（半残配置不会让快捷键成片失效）', () => {
    const storage = createMemoryShortcutStorage(
      JSON.stringify({ 'edit.undo': { ctrl: true, shift: false, alt: false, code: 'KeyG' } }),
    )
    const store = createShortcutsStore(storage)
    const bindings = store.getState().bindings

    expect(bindings['edit.undo']).toEqual(bind('KeyG', { ctrl: true }))
    expect(bindings['canvas.search']).toEqual(defaultComboOf('canvas.search'))
  })

  it('setBinding 传入的对象被拷贝（外部再改不影响 store 内部状态）', () => {
    const store = createShortcutsStore(createMemoryShortcutStorage())
    const value = bind('KeyG', { ctrl: true })
    store.getState().setBinding('view.fit', value)
    value.code = 'KeyH'
    expect(store.getState().bindings['view.fit'].code).toBe('KeyG')
  })

  it('连续多次改绑后落盘的是最后一次的完整快照', () => {
    const storage = createMemoryShortcutStorage()
    const store = createShortcutsStore(storage)

    store.getState().setBinding('view.fit', bind('KeyG', { ctrl: true }))
    store.getState().setBinding('card.copy', bind('KeyH', { ctrl: true }))

    expect(storage.read()).toBe(serializeBindings(store.getState().bindings))
  })

  it('偏好键名固定（改动会让老用户的绑定丢失）', () => {
    expect(SHORTCUTS_PREF_KEY).toBe('mindscape.shortcuts')
  })
})
