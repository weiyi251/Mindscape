// ============================================================================
// 模块说明（中文）
// 设置弹窗（2026-09-12 建立；2026-09-13 重构为「可拖动 / 可缩放弹窗 + 分页」）。
//
// 用户要求（2026-09-13）：
//   · 设置面板改为**弹窗模式**，支持拖动调整位置与大小；
//   · 面板内先放「自定义快捷键」「版本更新」两页，并**预留后续新增页面**的扩展能力；
//   · 「切换深浅色模式」「显示已移除」两项**移出面板**（改到顶栏图标按钮，
//      见 pages/Board.tsx），因此本组件不再需要 theme / removedView 这些 props。
//
// 扩展方式：往 `settingsPages.ts` 的 SETTINGS_PAGES 里加一项（id + label + Component），
// 左侧页签与内容区会自动跟上 —— 这是新增页面唯一需要改动的地方。
// 页面按平台裁剪同样在那张表上声明（`requires`，2026-09-21 移动端 M1）。
//
// 位置尺寸由 FloatingModal 记忆在 localStorage（键 = floatingModalPrefKey('settings')），
// 关掉再打开会回到上次拖动的位置；窗口被拉小时会自动收回可视区。
// ============================================================================

import { useState } from 'react'

import { FloatingModal } from './floating-modal'
import { floatingModalPrefKey } from './floatingModalGeometry'
import { SETTINGS_TEXT } from './settingsText'
import { SETTINGS_PAGES, visibleSettingsPages } from './settingsPages'
import type { SettingsPageId } from './settingsPages'
import { cn } from '@/lib/utils'

export interface SettingsPanelProps {
  open: boolean
  onClose: () => void
}

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  // 当前页：组件常驻（FloatingModal 在关闭时返回 null），故跨开关保持上次选择
  const [pageId, setPageId] = useState<SettingsPageId>(SETTINGS_PAGES[0].id)
  // 移动端隐藏不可用页；上次选的页被隐藏时回落到第一张可见页
  const pages = visibleSettingsPages()
  const active = pages.find((page) => page.id === pageId) ?? pages[0]
  const ActivePage = active.Component

  return (
    <FloatingModal
      open={open}
      title={SETTINGS_TEXT.title}
      onClose={onClose}
      storageKey={floatingModalPrefKey('settings')}
    >
      <div className="flex h-full min-h-0 gap-3">
        {/* 左侧页签：页面多了也能竖着排，不用挤在标题栏里 */}
        <nav className="flex w-28 shrink-0 flex-col gap-1">
          {pages.map((page) => (
            <button
              key={page.id}
              type="button"
              onClick={() => setPageId(page.id)}
              aria-current={page.id === active.id}
              className={cn(
                'rounded px-2 py-1.5 text-left text-xs transition-colors',
                page.id === active.id
                  ? 'bg-primary/10 text-primary'
                  : 'text-foreground/80 hover:bg-foreground/10 hover:text-foreground',
              )}
            >
              {page.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1 overflow-auto">
          <ActivePage />
        </div>
      </div>
    </FloatingModal>
  )
}
