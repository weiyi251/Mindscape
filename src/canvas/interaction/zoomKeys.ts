// ============================================================================
// 模块说明（中文）
// 缩放快捷键的匹配纯函数（Canvas 键盘分流用）。抽成纯函数以便在 node 环境
// 单测（不引 jsdom，架构守卫规则 6），Canvas 里只留一行调用。
//
// ⚠️ 关键坑（2026-09-13 用户实测「Ctrl+Shift+0 无法生效」）：不能用
// event.key 判断数字键 —— 按住 Shift 时 key 是**上档字符**（美式键盘上
// Shift+0 = ')'），`key === '0'` 永远匹配不上。必须用 event.code（物理
// 键位，与上档/输入法无关）；主键盘数字为 Digit0，小键盘为 Numpad0。
// ============================================================================

/** 键盘事件的形状子集（避免依赖 DOM KeyboardEvent 类型，node 测试可构造） */
export interface KeyComboLike {
  key: string
  code: string
  ctrlKey: boolean
  shiftKey: boolean
}

/** 数字 0 键（物理键位）：主键盘 Digit0 / 小键盘 Numpad0；key 兜底兼容非标准布局 */
export function isZeroKey(event: KeyComboLike): boolean {
  return event.code === 'Digit0' || event.code === 'Numpad0' || event.key === '0'
}

/** Ctrl+Shift+0：缩放到全部内容（适应内容，P1-4） */
export function isZoomToFitShortcut(event: KeyComboLike): boolean {
  return event.ctrlKey && event.shiftKey && isZeroKey(event)
}

/** Ctrl+0（不带 Shift）：复原视图 */
export function isResetViewShortcut(event: KeyComboLike): boolean {
  return event.ctrlKey && !event.shiftKey && isZeroKey(event)
}
