// ============================================================================
// 模块说明（中文）
// shortcuts/keys 的单测。重点回归：
//   · 「Shift 按下时 key 变成上档字符」——匹配只看 event.code，不看 event.key，
//     因此 Shift+0 无论如何都是 Digit0（2026-09-13 用户实测踩过的坑）；
//   · 修饰键必须精确相等：Ctrl+0 / Ctrl+Alt+0 / Ctrl+Shift+0 三者互不误命中；
//   · 遗留组合键只在「该项仍是默认绑定」时生效（改过键就立刻让位）。
// ============================================================================
import { describe, expect, it } from 'vitest'

import {
  SHORTCUT_DEFS,
  activeCombos,
  codeLabel,
  comboFromEvent,
  comboKey,
  conflictedIds,
  conflictPartners,
  conflictsOf,
  defaultBindings,
  defaultComboOf,
  findConflicts,
  formatCombo,
  isDefaultBinding,
  isModifierOnly,
  labelOf,
  matchesCombo,
  parseBindings,
  resolveShortcut,
  serializeBindings,
} from './keys'
import type { KeyComboLike, ShortcutBindings, ShortcutCombo } from './keys'

/** 构造按键事件（默认：无修饰键） */
function press(code: string, mods: Partial<KeyComboLike> = {}): KeyComboLike {
  return {
    code,
    ctrlKey: mods.ctrlKey ?? false,
    metaKey: mods.metaKey ?? false,
    shiftKey: mods.shiftKey ?? false,
    altKey: mods.altKey ?? false,
  }
}

/** 构造组合键绑定 */
function bind(code: string, mods: Partial<ShortcutCombo> = {}): ShortcutCombo {
  return { ctrl: mods.ctrl ?? false, shift: mods.shift ?? false, alt: mods.alt ?? false, code }
}

describe('codeLabel（物理键位 → 显示文本）', () => {
  it('字母 / 主键盘数字 / 功能键', () => {
    expect(codeLabel('KeyF')).toBe('F')
    expect(codeLabel('Digit0')).toBe('0')
    expect(codeLabel('F5')).toBe('F5')
    expect(codeLabel('F12')).toBe('F12')
  })

  it('小键盘带前缀，避免与主键盘混淆', () => {
    expect(codeLabel('Numpad0')).toBe('小键盘 0')
    expect(codeLabel('NumpadAdd')).toBe('小键盘 +')
  })

  it('具名键与符号键', () => {
    expect(codeLabel('Escape')).toBe('Esc')
    expect(codeLabel('Delete')).toBe('Delete')
    expect(codeLabel('Space')).toBe('空格')
    expect(codeLabel('ArrowUp')).toBe('↑')
    expect(codeLabel('Comma')).toBe(',')
  })

  it('空 code 与未知 code 都有兜底', () => {
    expect(codeLabel('')).toBe('未设置')
    expect(codeLabel('IntlBackslash')).toBe('IntlBackslash')
  })
})

describe('comboKey / formatCombo（稳定序列化与显示）', () => {
  it('同一组合恒得同一 key，不同组合必不同', () => {
    expect(comboKey(bind('Digit0', { ctrl: true, alt: true }))).toBe(
      comboKey(bind('Digit0', { ctrl: true, alt: true })),
    )
    expect(comboKey(bind('Digit0', { ctrl: true, alt: true }))).not.toBe(
      comboKey(bind('Digit0', { ctrl: true, shift: true })),
    )
  })

  it('显示顺序固定为 Ctrl+Alt+Shift+键', () => {
    expect(formatCombo(bind('Digit0', { ctrl: true, alt: true }))).toBe('Ctrl+Alt+0')
    expect(formatCombo(bind('KeyZ', { ctrl: true, shift: true }))).toBe('Ctrl+Shift+Z')
    expect(formatCombo(bind('Numpad0', { ctrl: true }))).toBe('Ctrl+小键盘 0')
  })

  it('无修饰键时只显示键名', () => {
    expect(formatCombo(bind('Delete'))).toBe('Delete')
    expect(formatCombo(bind('Escape'))).toBe('Esc')
  })
})

describe('isModifierOnly（录制时跳过纯修饰键）', () => {
  it('左右修饰键都算', () => {
    for (const code of [
      'ControlLeft',
      'ControlRight',
      'ShiftLeft',
      'ShiftRight',
      'AltLeft',
      'AltRight',
      'MetaLeft',
      'MetaRight',
    ]) {
      expect(isModifierOnly(code), code).toBe(true)
    }
  })

  it('真实按键不算', () => {
    expect(isModifierOnly('Digit0')).toBe(false)
    expect(isModifierOnly('Escape')).toBe(false)
    expect(isModifierOnly('KeyA')).toBe(false)
  })
})

describe('matchesCombo（修饰键精确相等 + 物理键位相同）', () => {
  it('Shift 按下时同样命中 —— 匹配完全不看 event.key（回归：曾用 key 判断导致失效）', () => {
    // 真实事件的 key 此时是上档字符 ')'，但我们根本不读它
    expect(matchesCombo(press('Digit0', { ctrlKey: true, shiftKey: true }), bind('Digit0', { ctrl: true, shift: true }))).toBe(true)
  })

  it('修饰键多一个 / 少一个都不命中（Ctrl+0 ≠ Ctrl+Alt+0）', () => {
    const ctrlAltZero = bind('Digit0', { ctrl: true, alt: true })
    expect(matchesCombo(press('Digit0', { ctrlKey: true }), ctrlAltZero)).toBe(false)
    expect(matchesCombo(press('Digit0', { ctrlKey: true, altKey: true }), ctrlAltZero)).toBe(true)
    expect(matchesCombo(press('Digit0', { ctrlKey: true, altKey: true, shiftKey: true }), ctrlAltZero)).toBe(false)
  })

  it('物理键位不同不命中（Digit0 ≠ Numpad0）', () => {
    expect(matchesCombo(press('Numpad0', { ctrlKey: true }), bind('Digit0', { ctrl: true }))).toBe(false)
  })

  it('ctrl 位涵盖 macOS 的 Cmd（metaKey）', () => {
    expect(matchesCombo(press('KeyF', { metaKey: true }), bind('KeyF', { ctrl: true }))).toBe(true)
    // 但 meta 不能算成「无修饰键」
    expect(matchesCombo(press('KeyF', { metaKey: true }), bind('KeyF'))).toBe(false)
  })
})

describe('comboFromEvent（录制组合键）', () => {
  it('纯修饰键返回 null（继续等真正的键）', () => {
    expect(comboFromEvent(press('ControlLeft', { ctrlKey: true }))).toBeNull()
    expect(comboFromEvent(press('ShiftLeft', { shiftKey: true }))).toBeNull()
  })

  it('空 code 返回 null', () => {
    expect(comboFromEvent(press(''))).toBeNull()
  })

  it('普通键产出组合键，Meta 归一为 ctrl', () => {
    expect(comboFromEvent(press('Digit0', { ctrlKey: true, altKey: true }))).toEqual(
      bind('Digit0', { ctrl: true, alt: true }),
    )
    expect(comboFromEvent(press('KeyF', { metaKey: true }))).toEqual(bind('KeyF', { ctrl: true }))
    expect(comboFromEvent(press('F5'))).toEqual(bind('F5'))
  })
})

describe('默认绑定表', () => {
  const bindings = defaultBindings()

  it('每个操作都有绑定，且默认表自身无冲突', () => {
    for (const def of SHORTCUT_DEFS) expect(bindings[def.id], def.id).toBeDefined()
    expect(findConflicts(bindings)).toEqual([])
  })

  it('操作 id 不重复', () => {
    const ids = SHORTCUT_DEFS.map((def) => def.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('isDefaultBinding 判定正确', () => {
    expect(isDefaultBinding(bindings, 'view.fit')).toBe(true)
    const changed: ShortcutBindings = { ...bindings, 'view.fit': bind('KeyG', { ctrl: true }) }
    expect(isDefaultBinding(changed, 'view.fit')).toBe(false)
  })

  it('defaultComboOf 取到默认值；未知 id 抛错', () => {
    expect(defaultComboOf('view.reset')).toEqual(bind('Digit0', { ctrl: true }))
    // @ts-expect-error 故意传非法 id，验证运行时兜底
    expect(() => defaultComboOf('nope.nope')).toThrow(/未知的快捷键操作/)
  })

  it('labelOf 取操作名；未知 id 原样返回', () => {
    expect(labelOf('edit.undo')).toBe('撤销')
    // @ts-expect-error 故意传非法 id
    expect(labelOf('nope.nope')).toBe('nope.nope')
  })
})

describe('resolveShortcut（按物理键位派发）', () => {
  const bindings = defaultBindings()

  it('适应内容：Ctrl+Alt+0 命中（主组合键）', () => {
    expect(resolveShortcut(press('Digit0', { ctrlKey: true, altKey: true }), bindings)).toBe('view.fit')
  })

  it('适应内容：Ctrl+Shift+0 命中（遗留组合键）', () => {
    expect(resolveShortcut(press('Digit0', { ctrlKey: true, shiftKey: true }), bindings)).toBe('view.fit')
  })

  it('适应内容：小键盘 Ctrl+Alt+0 / Ctrl+Shift+0 命中（遗留写法）', () => {
    expect(resolveShortcut(press('Numpad0', { ctrlKey: true, altKey: true }), bindings)).toBe('view.fit')
    expect(resolveShortcut(press('Numpad0', { ctrlKey: true, shiftKey: true }), bindings)).toBe('view.fit')
  })

  it('复原视图：Ctrl+0 命中，且不会被适应内容抢走', () => {
    expect(resolveShortcut(press('Digit0', { ctrlKey: true }), bindings)).toBe('view.reset')
    expect(resolveShortcut(press('Numpad0', { ctrlKey: true }), bindings)).toBe('view.reset')
  })

  it('撤销 / 重做（Ctrl+Shift+Z 与遗留 Ctrl+Y）', () => {
    expect(resolveShortcut(press('KeyZ', { ctrlKey: true }), bindings)).toBe('edit.undo')
    expect(resolveShortcut(press('KeyZ', { ctrlKey: true, shiftKey: true }), bindings)).toBe('edit.redo')
    expect(resolveShortcut(press('KeyY', { ctrlKey: true }), bindings)).toBe('edit.redo')
  })

  it('复制 / 粘贴 / 全选 / 搜索 / 保存', () => {
    expect(resolveShortcut(press('KeyC', { ctrlKey: true }), bindings)).toBe('card.copy')
    expect(resolveShortcut(press('KeyV', { ctrlKey: true }), bindings)).toBe('card.paste')
    expect(resolveShortcut(press('KeyA', { ctrlKey: true }), bindings)).toBe('canvas.selectAll')
    expect(resolveShortcut(press('KeyF', { ctrlKey: true }), bindings)).toBe('canvas.search')
    expect(resolveShortcut(press('KeyS', { ctrlKey: true }), bindings)).toBe('layout.save')
  })

  it('移除选中：Delete 与遗留 Backspace', () => {
    expect(resolveShortcut(press('Delete'), bindings)).toBe('card.remove')
    expect(resolveShortcut(press('Backspace'), bindings)).toBe('card.remove')
  })

  it('取消选中：Esc', () => {
    expect(resolveShortcut(press('Escape'), bindings)).toBe('canvas.escape')
  })

  it('未绑定的组合返回 null（不误伤普通打字）', () => {
    expect(resolveShortcut(press('KeyA'), bindings)).toBeNull()
    expect(resolveShortcut(press('Digit1'), bindings)).toBeNull()
    expect(resolveShortcut(press('KeyF', { altKey: true }), bindings)).toBeNull()
  })

  it('用户改绑后，旧键立即让位（遗留组合键仅在默认绑定时生效）', () => {
    const changed: ShortcutBindings = { ...bindings, 'view.fit': bind('KeyG', { ctrl: true }) }
    expect(resolveShortcut(press('KeyG', { ctrlKey: true }), changed)).toBe('view.fit')
    expect(resolveShortcut(press('Digit0', { ctrlKey: true, shiftKey: true }), changed)).toBeNull()
    expect(resolveShortcut(press('Digit0', { ctrlKey: true }), changed)).toBe('view.reset')
  })
})

describe('parseBindings / serializeBindings（本地存储读写）', () => {
  it('null / 空串 → 全默认', () => {
    expect(parseBindings(null)).toEqual(defaultBindings())
    expect(parseBindings('')).toEqual(defaultBindings())
  })

  it('坏 JSON / 非对象 → 全默认（不抛错）', () => {
    expect(parseBindings('{oops')).toEqual(defaultBindings())
    expect(parseBindings('"abc"')).toEqual(defaultBindings())
    expect(parseBindings('null')).toEqual(defaultBindings())
  })

  it('部分键合法 → 合法的生效，非法的回落默认', () => {
    const raw = JSON.stringify({
      'view.fit': { ctrl: true, shift: false, alt: false, code: 'KeyG' },
      'view.reset': { ctrl: true, shift: false, alt: false, code: '' }, // code 空 → 非法
      'edit.undo': { ctrl: true, shift: false, alt: false, code: 'ShiftLeft' }, // 纯修饰键 → 非法
      'edit.redo': 'not-an-object', // 类型不对 → 非法
      'not.an.id': { ctrl: true, shift: false, alt: false, code: 'KeyQ' }, // 未知 id → 忽略
    })
    const parsed = parseBindings(raw)
    expect(parsed['view.fit']).toEqual(bind('KeyG', { ctrl: true }))
    expect(parsed['view.reset']).toEqual(defaultComboOf('view.reset'))
    expect(parsed['edit.undo']).toEqual(defaultComboOf('edit.undo'))
    expect(parsed['edit.redo']).toEqual(defaultComboOf('edit.redo'))
  })

  it('序列化 → 解析可往返，且输出顺序稳定', () => {
    const bindings = defaultBindings()
    bindings['card.copy'] = bind('KeyG', { ctrl: true, alt: true })
    const text = serializeBindings(bindings)
    expect(parseBindings(text)).toEqual(bindings)
    expect(text).toBe(serializeBindings(bindings))
    expect(Object.keys(JSON.parse(text))).toEqual(SHORTCUT_DEFS.map((def) => def.id))
  })
})

describe('冲突检测', () => {
  const bindings = defaultBindings()

  it('activeCombos 含默认绑定 + 仍在生效的遗留写法', () => {
    const items = activeCombos(bindings)
    const fit = items.filter((item) => item.id === 'view.fit')
    // 默认 1 条 + 遗留 3 条（Ctrl+Shift+0 / 小键盘 Ctrl+Alt+0 / 小键盘 Ctrl+Shift+0）
    expect(fit).toHaveLength(4)
    expect(fit.filter((item) => item.legacy)).toHaveLength(3)
  })

  it('冲突：把两个操作绑到同一个组合键', () => {
    const dup: ShortcutBindings = { ...bindings, 'edit.undo': bind('KeyF', { ctrl: true }) }
    const conflicts = findConflicts(dup)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].combo).toEqual(bind('KeyF', { ctrl: true }))
    expect([...conflicts[0].ids].sort()).toEqual(['canvas.search', 'edit.undo'])
    expect([...conflictedIds(dup)].sort()).toEqual(['canvas.search', 'edit.undo'])
  })

  it('改绑后自身的遗留写法不再参与，故不与自己冲突', () => {
    const changed: ShortcutBindings = { ...bindings, 'view.fit': bind('Digit0', { ctrl: true, shift: true }) }
    // 显式把 fit 绑成旧组合：它现在与「默认写法」无关，只有一条生效
    const fit = activeCombos(changed).filter((item) => item.id === 'view.fit')
    expect(fit).toHaveLength(1)
    expect(findConflicts(changed)).toEqual([])
  })

  it('conflictsOf：预检某个组合键会不会撞别人', () => {
    expect(conflictsOf(bindings, 'layout.save', bind('KeyF', { ctrl: true }))).toEqual(['canvas.search'])
    expect(conflictsOf(bindings, 'layout.save', bind('KeyG', { ctrl: true }))).toEqual([])
    // 与自己当前绑定的组合键不算冲突
    expect(conflictsOf(bindings, 'canvas.search', bind('KeyF', { ctrl: true }))).toEqual([])
  })

  it('conflictsOf 能发现与「仍是默认的遗留写法」撞车', () => {
    expect(conflictsOf(bindings, 'layout.save', bind('KeyY', { ctrl: true }))).toEqual(['edit.redo'])
  })

  it('conflictPartners：逐行给出与之冲突的其它操作', () => {
    const dup: ShortcutBindings = { ...bindings, 'edit.undo': bind('KeyF', { ctrl: true }) }
    const partners = conflictPartners(dup)
    expect(partners.get('edit.undo')).toEqual(['canvas.search'])
    expect(partners.get('canvas.search')).toEqual(['edit.undo'])
    expect(partners.get('layout.save')).toBeUndefined()
    // 默认表无冲突 → 空 map
    expect(conflictPartners(bindings).size).toBe(0)
  })
})
