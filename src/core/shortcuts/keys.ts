// ============================================================================
// 模块说明（中文）
// 快捷键注册中心（2026-09-13 新增，对应「自定义快捷键」需求）。
//
// 为什么要有一个中心：此前快捷键判断散落在 Canvas / Board 各自的 keydown 分支里
// （`event.ctrlKey && event.key === '0'` 之类），既没法统一展示给用户，也没法重新
// 绑定。现在把「有哪些操作 / 默认按什么键 / 怎么匹配 / 怎么显示 / 冲突怎么判」
// 全收在本文件（**纯函数**，node 环境可直接单测），UI 与画布只负责调用。
//
// ⚠️ 匹配一律按**物理键位** `KeyboardEvent.code`，绝不用 `event.key`：
//   按住 Shift 时 key 会变成上档字符（Shift+0 得到 ')'），`key === '0'` 永远落空
//   （2026-09-13 用户实测踩过）。code 与上档字符 / 输入法状态无关。
//
// ⚠️ 修饰键必须**精确相等**（ctrl / shift / alt 三项全对）：
//   否则 Ctrl+0（复原视图）与 Ctrl+Alt+0（适应内容）会互相误命中。
//   `ctrl` 一位同时代表 Ctrl 与 macOS 的 Cmd（匹配时 ctrl || meta）。
//
// 遗留兼容：历史组合键（Ctrl+Shift+0、Ctrl+Y、Backspace）写在 legacyCombos 里，
//   **只在该项仍为默认绑定时生效** —— 用户改过键之后旧键立即让位，不出现「改了还被抢」。
// ============================================================================

/** 键盘事件的形状子集（避免依赖 DOM KeyboardEvent 类型，node 测试可构造） */
export interface KeyComboLike {
  code: string
  ctrlKey: boolean
  metaKey?: boolean
  shiftKey: boolean
  altKey: boolean
}

/** 一条快捷键绑定：三个修饰键 + 一个物理键位 */
export interface ShortcutCombo {
  ctrl: boolean
  shift: boolean
  alt: boolean
  /** KeyboardEvent.code（Digit0 / KeyF / Numpad0 / Delete / Escape / F5 …） */
  code: string
}

export type ShortcutGroupId = 'view' | 'edit' | 'card' | 'canvas'

/** 分组表（设置页按组分节显示） */
export const SHORTCUT_GROUPS: { id: ShortcutGroupId; label: string }[] = [
  { id: 'view', label: '视图' },
  { id: 'edit', label: '编辑' },
  { id: 'card', label: '卡片' },
  { id: 'canvas', label: '画布' },
]

export type ShortcutId =
  | 'view.fit'
  | 'view.reset'
  | 'edit.undo'
  | 'edit.redo'
  | 'card.copy'
  | 'card.paste'
  | 'card.remove'
  | 'canvas.selectAll'
  | 'canvas.search'
  | 'canvas.escape'
  | 'layout.save'

export interface ShortcutDef {
  id: ShortcutId
  group: ShortcutGroupId
  /** 操作名（中文；设置页显示） */
  label: string
  /** 默认绑定 */
  defaultCombo: ShortcutCombo
  /** 历史组合键：仅当该项仍是默认绑定时一并生效 */
  legacyCombos?: ShortcutCombo[]
}

/** 手写组合键的小工具（表里读起来比字面量对象清楚） */
function combo(code: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) {
  return {
    ctrl: mods.ctrl ?? false,
    shift: mods.shift ?? false,
    alt: mods.alt ?? false,
    code,
  } satisfies ShortcutCombo
}

/**
 * 全部可绑定操作的清单。**顺序即匹配优先级**（先到先得），
 * 也是设置页与持久化文件的遍历顺序。
 */
export const SHORTCUT_DEFS: ShortcutDef[] = [
  {
    id: 'view.fit',
    group: 'view',
    label: '适应内容（缩放到全部内容）',
    // 主组合键 Ctrl+Alt+0：本机 Ctrl+Shift+0 被输入法/系统吞掉（探针实证数字 0 的
    // keydown 根本没送达），故换到无人占用的 Ctrl+Alt；旧组合键保留兼容
    defaultCombo: combo('Digit0', { ctrl: true, alt: true }),
    legacyCombos: [
      combo('Digit0', { ctrl: true, shift: true }),
      // 小键盘写法（旧实现按 Digit0 / Numpad0 两个物理键位判断，一并保留）
      combo('Numpad0', { ctrl: true, alt: true }),
      combo('Numpad0', { ctrl: true, shift: true }),
    ],
  },
  {
    id: 'view.reset',
    group: 'view',
    label: '复原视图（缩放 100% 并回到原点）',
    defaultCombo: combo('Digit0', { ctrl: true }),
    legacyCombos: [combo('Numpad0', { ctrl: true })],
  },
  {
    id: 'edit.undo',
    group: 'edit',
    label: '撤销',
    defaultCombo: combo('KeyZ', { ctrl: true }),
  },
  {
    id: 'edit.redo',
    group: 'edit',
    label: '重做',
    defaultCombo: combo('KeyZ', { ctrl: true, shift: true }),
    legacyCombos: [combo('KeyY', { ctrl: true })],
  },
  {
    id: 'card.copy',
    group: 'card',
    label: '复制选中卡片',
    defaultCombo: combo('KeyC', { ctrl: true }),
  },
  {
    id: 'card.paste',
    group: 'card',
    label: '粘贴',
    defaultCombo: combo('KeyV', { ctrl: true }),
  },
  {
    id: 'card.remove',
    group: 'card',
    label: '移除选中卡片（移入已移除，不删文件）',
    defaultCombo: combo('Delete'),
    legacyCombos: [combo('Backspace')],
  },
  {
    id: 'canvas.selectAll',
    group: 'canvas',
    label: '全选卡片',
    defaultCombo: combo('KeyA', { ctrl: true }),
  },
  {
    id: 'canvas.search',
    group: 'canvas',
    label: '搜索卡片',
    defaultCombo: combo('KeyF', { ctrl: true }),
  },
  {
    id: 'canvas.escape',
    group: 'canvas',
    label: '取消选中 / 取消连线',
    defaultCombo: combo('Escape'),
  },
  {
    id: 'layout.save',
    group: 'canvas',
    label: '立即保存布局',
    defaultCombo: combo('KeyS', { ctrl: true }),
  },
]

/** 绑定表（操作 id → 组合键） */
export type ShortcutBindings = Record<ShortcutId, ShortcutCombo>

// ---------------------------------------------------------------------------
// 键名与文本
// ---------------------------------------------------------------------------

/** 具名键位的中文/符号显示表（未列出的 code 原样显示） */
const NAMED_CODE_LABELS: Record<string, string> = {
  Escape: 'Esc',
  Space: '空格',
  Enter: '回车',
  NumpadEnter: '回车',
  Tab: 'Tab',
  Delete: 'Delete',
  Backspace: 'Backspace',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  NumpadAdd: '小键盘 +',
  NumpadSubtract: '小键盘 -',
  NumpadMultiply: '小键盘 *',
  NumpadDivide: '小键盘 /',
  NumpadDecimal: '小键盘 .',
}

/** 物理键位 → 显示文本（Digit0 → '0'、KeyF → 'F'、Numpad0 → '小键盘 0'） */
export function codeLabel(code: string): string {
  if (code === '') return '未设置'
  const named = NAMED_CODE_LABELS[code]
  if (named) return named
  const key = /^Key([A-Z])$/.exec(code)
  if (key) return key[1]
  const digit = /^Digit(\d)$/.exec(code)
  if (digit) return digit[1]
  const numpad = /^Numpad(\d)$/.exec(code)
  if (numpad) return `小键盘 ${numpad[1]}`
  if (/^F\d{1,2}$/.test(code)) return code
  return code
}

/** 组合键的稳定序列化（同一组合恒得同一字符串；持久化与冲突检测都用它） */
export function comboKey(value: ShortcutCombo): string {
  return `${value.ctrl ? 1 : 0}${value.shift ? 1 : 0}${value.alt ? 1 : 0}|${value.code}`
}

/** 组合键 → 显示文本（Ctrl+Alt+0 / Delete / Esc） */
export function formatCombo(value: ShortcutCombo): string {
  const parts: string[] = []
  if (value.ctrl) parts.push('Ctrl')
  if (value.alt) parts.push('Alt')
  if (value.shift) parts.push('Shift')
  parts.push(codeLabel(value.code))
  return parts.join('+')
}

// ---------------------------------------------------------------------------
// 匹配
// ---------------------------------------------------------------------------

/** 纯修饰键（录制时应继续等待真正的字符键） */
export function isModifierOnly(code: string): boolean {
  return /^(Control|Shift|Alt|Meta)(Left|Right)$/.test(code) || /^(Control|Shift|Alt|Meta)$/.test(code)
}

/** 三个修饰键精确相等 + 物理键位相同（ctrl 位涵盖 macOS 的 Cmd） */
export function matchesCombo(event: KeyComboLike, value: ShortcutCombo): boolean {
  const ctrl = event.ctrlKey || event.metaKey === true
  return (
    ctrl === value.ctrl &&
    event.shiftKey === value.shift &&
    event.altKey === value.alt &&
    event.code === value.code
  )
}

/** 从一次 keydown 捕获组合键；纯修饰键返回 null（继续等下一个键） */
export function comboFromEvent(event: KeyComboLike): ShortcutCombo | null {
  if (event.code === '' || isModifierOnly(event.code)) return null
  return {
    ctrl: event.ctrlKey || event.metaKey === true,
    shift: event.shiftKey,
    alt: event.altKey,
    code: event.code,
  }
}

// ---------------------------------------------------------------------------
// 默认值 / 序列化
// ---------------------------------------------------------------------------

/** 全部操作的默认绑定 */
export function defaultBindings(): ShortcutBindings {
  const result = {} as ShortcutBindings
  for (const def of SHORTCUT_DEFS) result[def.id] = { ...def.defaultCombo }
  return result
}

/** 取某项的默认绑定（找不到时抛错，属于编码错误而非数据问题） */
export function defaultComboOf(id: ShortcutId): ShortcutCombo {
  const def = SHORTCUT_DEFS.find((item) => item.id === id)
  if (!def) throw new Error(`未知的快捷键操作：${id}`)
  return { ...def.defaultCombo }
}

/** 单项是否仍是默认绑定 */
export function isDefaultBinding(bindings: ShortcutBindings, id: ShortcutId): boolean {
  return comboKey(bindings[id]) === comboKey(defaultComboOf(id))
}

/**
 * 把任意 JSON 值收敛成一个组合键；非法（缺 code / 纯修饰键 / 非对象）返回 null。
 * 用于读取本地存储 —— 坏数据一律回落默认，绝不让界面崩。
 */
function coerceCombo(value: unknown): ShortcutCombo | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const code = typeof raw.code === 'string' ? raw.code : ''
  if (code === '' || isModifierOnly(code)) return null
  return {
    ctrl: raw.ctrl === true,
    shift: raw.shift === true,
    alt: raw.alt === true,
    code,
  }
}

/** 解析本地存储的原始文本：坏数据 / 缺项一律回落默认（永远返回完整表） */
export function parseBindings(raw: string | null | undefined): ShortcutBindings {
  const result = defaultBindings()
  if (!raw) return result
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return result
  }
  if (!parsed || typeof parsed !== 'object') return result

  const record = parsed as Record<string, unknown>
  for (const def of SHORTCUT_DEFS) {
    const value = coerceCombo(record[def.id])
    if (value) result[def.id] = value
  }
  return result
}

/** 序列化绑定表（按 SHORTCUT_DEFS 顺序，输出稳定便于 diff） */
export function serializeBindings(bindings: ShortcutBindings): string {
  const payload: Record<string, ShortcutCombo> = {}
  for (const def of SHORTCUT_DEFS) {
    const value = bindings[def.id]
    payload[def.id] = {
      ctrl: value.ctrl,
      shift: value.shift,
      alt: value.alt,
      code: value.code,
    }
  }
  return JSON.stringify(payload, null, 2)
}

// ---------------------------------------------------------------------------
// 生效组合键 / 冲突检测 / 派发
// ---------------------------------------------------------------------------

/** 当前真正生效的组合键（含仍在生效的遗留组合键） */
export function activeCombos(
  bindings: ShortcutBindings,
): { id: ShortcutId; combo: ShortcutCombo; legacy: boolean }[] {
  const result: { id: ShortcutId; combo: ShortcutCombo; legacy: boolean }[] = []
  for (const def of SHORTCUT_DEFS) {
    const current = bindings[def.id]
    result.push({ id: def.id, combo: current, legacy: false })
    if (isDefaultBinding(bindings, def.id)) {
      for (const item of def.legacyCombos ?? []) {
        result.push({ id: def.id, combo: item, legacy: true })
      }
    }
  }
  return result
}

/** 一处组合键冲突 */
export interface ShortcutConflict {
  combo: ShortcutCombo
  ids: ShortcutId[]
}

/** 找出被多个操作占用的组合键（同一条目自身的遗留写法不算冲突） */
export function findConflicts(bindings: ShortcutBindings): ShortcutConflict[] {
  const map = new Map<string, { combo: ShortcutCombo; ids: Set<ShortcutId> }>()
  for (const item of activeCombos(bindings)) {
    const key = comboKey(item.combo)
    const entry = map.get(key) ?? { combo: item.combo, ids: new Set<ShortcutId>() }
    entry.ids.add(item.id)
    map.set(key, entry)
  }
  return [...map.values()]
    .filter((entry) => entry.ids.size > 1)
    .map((entry) => ({ combo: entry.combo, ids: [...entry.ids] }))
}

/** 参与了冲突的操作集合（设置页据此标红） */
export function conflictedIds(bindings: ShortcutBindings): Set<ShortcutId> {
  const result = new Set<ShortcutId>()
  for (const conflict of findConflicts(bindings)) {
    for (const id of conflict.ids) result.add(id)
  }
  return result
}

/** 每个操作与之冲突的**其它**操作（设置页逐行显示「与 xx 冲突」） */
export function conflictPartners(bindings: ShortcutBindings): Map<ShortcutId, ShortcutId[]> {
  const result = new Map<ShortcutId, ShortcutId[]>()
  for (const conflict of findConflicts(bindings)) {
    for (const id of conflict.ids) {
      result.set(
        id,
        conflict.ids.filter((other) => other !== id),
      )
    }
  }
  return result
}

/**
 * 若把 `id` 改绑为 `value`，会不会与**其它**操作冲突？
 * 返回冲突方（操作名数组）；无冲突返回空数组。**不关心 `id` 自身的遗留写法**。
 */
export function conflictsOf(bindings: ShortcutBindings, id: ShortcutId, value: ShortcutCombo): ShortcutId[] {
  const key = comboKey(value)
  const result: ShortcutId[] = []
  for (const item of activeCombos(bindings)) {
    if (item.id === id) continue
    if (comboKey(item.combo) === key) result.push(item.id)
  }
  return result
}

/** 按物理键位派发：这次 keydown 命中哪个操作（未命中返回 null） */
export function resolveShortcut(event: KeyComboLike, bindings: ShortcutBindings): ShortcutId | null {
  for (const def of SHORTCUT_DEFS) {
    if (matchesCombo(event, bindings[def.id])) return def.id
    if (isDefaultBinding(bindings, def.id)) {
      for (const legacy of def.legacyCombos ?? []) {
        if (matchesCombo(event, legacy)) return def.id
      }
    }
  }
  return null
}

/** 操作名（设置页提示冲突时用） */
export function labelOf(id: ShortcutId): string {
  return SHORTCUT_DEFS.find((item) => item.id === id)?.label ?? id
}
