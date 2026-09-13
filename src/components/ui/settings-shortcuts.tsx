// ============================================================================
// 模块说明（中文）
// 设置弹窗「自定义快捷键」页（2026-09-13 新增，用户要求：查看当前绑定、
// 重新绑定、恢复默认、冲突检测、持久化保存）。
//
// 职责划分：
//   · 有哪些操作 / 默认键 / 匹配 / 冲突判定 / 读写 —— 全在 core/shortcuts/keys.ts
//     与 core/store/shortcutsStore.ts（纯函数 + 单测）；
//   · 本文件只负责「渲染 + 录制按键」。
//
// ⚠️ 录制按键必须挂在 **window 捕获阶段** 并 stopPropagation：
//   画布与画板都在 window 冒泡阶段监听 keydown，若不抢在前面，改绑时按下的
//   Delete / Ctrl+F 会先把卡片删掉或把搜索框叫出来。捕获阶段拦截后事件不再下传，
//   也顺带避免了 WebView 的默认行为（Ctrl+S 保存对话框、Ctrl+F 页内查找等）。
// ============================================================================

import { useEffect, useState } from 'react'

import { Button } from './button'
import { SHORTCUTS_TEXT, conflictHintText, conflictRowText } from './settingsText'
import { cn } from '@/lib/utils'
import {
  SHORTCUT_DEFS,
  SHORTCUT_GROUPS,
  comboFromEvent,
  conflictPartners,
  conflictsOf,
  formatCombo,
  isDefaultBinding,
  labelOf,
} from '@/core/shortcuts/keys'
import type { ShortcutId } from '@/core/shortcuts/keys'
import { useShortcutsStore } from '@/core/store/shortcutsStore'

export function SettingsShortcutsPage() {
  // 订阅绑定：改绑后本页立刻反映最新值（低频操作，可以放心走 React 状态）
  const bindings = useShortcutsStore((state) => state.bindings)
  const setBinding = useShortcutsStore((state) => state.setBinding)
  const resetBinding = useShortcutsStore((state) => state.resetBinding)
  const resetAll = useShortcutsStore((state) => state.resetAll)

  /** 正在录制的操作（null = 未录制） */
  const [recordingId, setRecordingId] = useState<ShortcutId | null>(null)
  /** 录制期的冲突 / 提示文案 */
  const [hint, setHint] = useState<string | null>(null)

  useEffect(() => {
    if (!recordingId) return

    const handleKeyDown = (event: KeyboardEvent) => {
      // 抢在画布 / 画板之前：既不触发原有快捷键，也不放行 WebView 默认行为
      event.preventDefault()
      event.stopPropagation()

      // Esc 放弃本次录制（Esc 本身不作为可绑定键）
      if (event.code === 'Escape') {
        setRecordingId(null)
        setHint(null)
        return
      }

      const combo = comboFromEvent(event)
      // 纯修饰键（只按了 Ctrl / Shift）：继续等真正的按键
      if (!combo) return

      const clashes = conflictsOf(bindings, recordingId, combo)
      if (clashes.length > 0) {
        // 冲突 → 拒绝保存并说明被谁占用，保持录制态让用户直接再按一个
        setHint(conflictHintText(formatCombo(combo), clashes.map(labelOf)))
        return
      }

      setBinding(recordingId, combo)
      setRecordingId(null)
      setHint(null)
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [recordingId, bindings, setBinding])

  /** 每一行与之冲突的其它操作（默认表无冲突时为空） */
  const partners = conflictPartners(bindings)

  const startRecording = (id: ShortcutId) => {
    setHint(null)
    setRecordingId((current) => (current === id ? null : id))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] leading-relaxed text-muted-foreground">{SHORTCUTS_TEXT.hint}</p>
        <Button variant="outline" size="sm" className="shrink-0" onClick={resetAll}>
          {SHORTCUTS_TEXT.resetAll}
        </Button>
      </div>

      {hint ? (
        <p
          role="alert"
          className="rounded border border-destructive/40 bg-destructive/5 px-2 py-1 text-[11px] text-destructive"
        >
          {hint}
        </p>
      ) : null}

      {SHORTCUT_GROUPS.map((group) => {
        const items = SHORTCUT_DEFS.filter((def) => def.group === group.id)
        if (items.length === 0) return null

        return (
          <section key={group.id} className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {group.label}
            </p>
            <div className="divide-y divide-border/60 overflow-hidden rounded-md border border-border">
              {items.map((def) => {
                const recording = recordingId === def.id
                const clashing = partners.get(def.id) ?? []
                const fallback = isDefaultBinding(bindings, def.id)

                return (
                  <div key={def.id} className="flex items-center gap-2 px-2 py-1.5">
                    <p className="min-w-0 flex-1 truncate text-xs text-foreground/90" title={def.label}>
                      {def.label}
                    </p>

                    {clashing.length > 0 && !recording ? (
                      <span
                        className="shrink-0 text-[11px] text-destructive"
                        title={conflictRowText(clashing.map(labelOf))}
                      >
                        {SHORTCUTS_TEXT.conflictBadge}
                      </span>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => startRecording(def.id)}
                      title={recording ? SHORTCUTS_TEXT.recording : SHORTCUTS_TEXT.recordHint}
                      aria-label={`${def.label}：${formatCombo(bindings[def.id])}`}
                      className={cn(
                        'shrink-0 rounded border px-2 py-1 font-mono text-[11px] transition-colors',
                        recording
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-muted/30 text-foreground/90 hover:border-primary/60',
                        clashing.length > 0 && !recording ? 'border-destructive/60 text-destructive' : '',
                      )}
                    >
                      {recording ? SHORTCUTS_TEXT.recording : formatCombo(bindings[def.id])}
                    </button>

                    <button
                      type="button"
                      onClick={() => resetBinding(def.id)}
                      disabled={fallback}
                      title={fallback ? SHORTCUTS_TEXT.alreadyDefault : SHORTCUTS_TEXT.reset}
                      className="shrink-0 rounded border border-border px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground disabled:cursor-default disabled:opacity-40 hover:disabled:border-border hover:disabled:text-muted-foreground"
                    >
                      {SHORTCUTS_TEXT.reset}
                    </button>
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
