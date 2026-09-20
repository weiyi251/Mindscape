// ============================================================================
// 模块说明（中文）
// 菜单配置中心单元测试。覆盖 17 章 T0.10 验收标准：
//   「菜单由配置数组生成，改配置即时反映到 UI」—— 前一半在此验证（数组 → 聚合结果），
//   后一半由 components/ui/menu-list.test.tsx 验证（聚合结果 → 渲染输出）。
//
// 实现任务：T0.10（准备层）。
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { zCardSchema, zPartitionSchema } from '@/core/types'
import type { Card, Partition } from '@/core/types'
import { registerMenuItem, resetPluginCenter } from '@/core/registry/pluginCenter'
import {
  CARD_ACTION,
  PARTITION_ACTION,
  CONNECTION_ACTION,
  CORE_CARD_MENU_ITEMS,
  CORE_PARTITION_MENU_ITEMS,
  CORE_CONNECTION_MENU_ITEMS,
  buildCardMenuFor,
  buildPartitionMenuFor,
  buildConnectionMenuFor,
} from '@/core/registry/menus'
import { registerAction, resetActions } from '@/core/registry/actionRegistry'

function makeCard(over: Partial<Card> = {}): Card {
  return zCardSchema.parse({
    id: 'card-1',
    type: 'image',
    filePath: 'ref-01.jpg',
    originalPath: 'ref-01.jpg',
    x: 0,
    y: 0,
    w: 220,
    h: 220,
    ...over,
  })
}

function makePartition(over: Partial<Partition> = {}): Partition {
  return zPartitionSchema.parse({
    id: 'p-1',
    name: '参考资料',
    folderPath: '参考资料',
    x: 0,
    y: 0,
    w: 400,
    h: 300,
    ...over,
  })
}

function idsOf(items: { id: string }[]): string[] {
  return items.map((item) => item.id)
}

beforeEach(() => {
  resetPluginCenter()
  resetActions()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// 配置本身
// ---------------------------------------------------------------------------

describe('核心菜单配置', () => {
  it('卡片菜单配置与 5.2 的菜单清单一致（打开原图/移除/置顶/置底/加备注/编辑标签 + 连线 + 复制 + 移动到 + 便签颜色 + 重命名文件 + 锁定卡片）', () => {
    expect(idsOf(CORE_CARD_MENU_ITEMS)).toEqual([
      CARD_ACTION.openOriginal,
      CARD_ACTION.remove,
      CARD_ACTION.bringToFront,
      CARD_ACTION.sendToBack,
      CARD_ACTION.addNote,
      CARD_ACTION.editLabel,
      CARD_ACTION.connect,
      CARD_ACTION.copy,
      CARD_ACTION.move,
      CARD_ACTION.setColor,
      CARD_ACTION.renameFile,
      CARD_ACTION.toggleLock,
    ])
  })

  it('每个菜单项都有中文 label，且 id 不重复', () => {
    for (const item of CORE_CARD_MENU_ITEMS) {
      expect(item.label.length).toBeGreaterThan(0)
    }
    expect(new Set(idsOf(CORE_CARD_MENU_ITEMS)).size).toBe(CORE_CARD_MENU_ITEMS.length)
  })

  it('分区框菜单配置与第六章能力对应（粘贴 / 重命名 / 折叠展开 / 指定颜色）', () => {
    expect(idsOf(CORE_PARTITION_MENU_ITEMS)).toEqual([
      PARTITION_ACTION.paste,
      PARTITION_ACTION.rename,
      PARTITION_ACTION.toggleCollapse,
      PARTITION_ACTION.setColor,
    ])
  })
})

// ---------------------------------------------------------------------------
// 卡片菜单聚合
// ---------------------------------------------------------------------------

describe('buildCardMenuFor', () => {
  it('图片卡片：包含「打开原图」', () => {
    expect(idsOf(buildCardMenuFor(makeCard({ type: 'image' })))).toContain(CARD_ACTION.openOriginal)
  })

  it('便签 / 文件卡片：仅按 appliesTo 隐藏「打开原图」，「复制」对所有类型可见', () => {
    // 便签没有硬盘文件（filePath 为空）→ 不显示「移动到…」；
    // 显示「便签颜色…」（2026-09-15 用户需求，仅便签适用）；不显示「重命名文件」
    const noteIds = idsOf(buildCardMenuFor(makeCard({ type: 'note', filePath: '', originalPath: '' })))
    expect(noteIds).not.toContain(CARD_ACTION.openOriginal)
    expect(noteIds).not.toContain(CARD_ACTION.move)
    expect(noteIds).not.toContain(CARD_ACTION.renameFile)
    expect(noteIds).toContain(CARD_ACTION.copy)
    expect(noteIds).toEqual([
      CARD_ACTION.remove,
      CARD_ACTION.bringToFront,
      CARD_ACTION.sendToBack,
      CARD_ACTION.addNote,
      CARD_ACTION.editLabel,
      CARD_ACTION.connect,
      CARD_ACTION.copy,
      CARD_ACTION.setColor,
      CARD_ACTION.toggleLock,
    ])

    // 文件卡片有硬盘文件 → 显示「移动到…」（2026-09-12 用户裁决）与
    // 「重命名文件」（2026-09-15 用户需求）；非便签类型不显示「便签颜色…」
    const fileIds = idsOf(buildCardMenuFor(makeCard({ type: 'file' })))
    expect(fileIds).not.toContain(CARD_ACTION.openOriginal)
    expect(fileIds).toContain(CARD_ACTION.move)
    expect(fileIds).toContain(CARD_ACTION.renameFile)
    expect(fileIds).not.toContain(CARD_ACTION.setColor)
    expect(fileIds).toEqual([
      CARD_ACTION.remove,
      CARD_ACTION.bringToFront,
      CARD_ACTION.sendToBack,
      CARD_ACTION.addNote,
      CARD_ACTION.editLabel,
      CARD_ACTION.connect,
      CARD_ACTION.copy,
      CARD_ACTION.move,
      CARD_ACTION.renameFile,
      CARD_ACTION.toggleLock,
    ])
  })

  it('图片卡片：同时包含「打开原图」与「复制」', () => {
    const ids = idsOf(buildCardMenuFor(makeCard({ type: 'image' })))
    expect(ids).toContain(CARD_ACTION.openOriginal)
    expect(ids).toContain(CARD_ACTION.copy)
  })

  it('插件注册的菜单项自动追加在核心项之后', () => {
    registerMenuItem({ id: 'plugin.extractColor', label: '提取色彩', action: () => {} })

    const card = makeCard({ type: 'image' })
    const ids = idsOf(buildCardMenuFor(card))
    expect(ids.at(-1)).toBe('plugin.extractColor')
    // 长度 = 该卡片适用的核心项数 + 1 个插件项（核心项按 appliesTo 过滤后计数）
    expect(ids).toHaveLength(
      CORE_CARD_MENU_ITEMS.filter((item) => !item.appliesTo || item.appliesTo(card)).length + 1,
    )
  })

  it('插件菜单项与卡片类型不匹配时不出现', () => {
    registerMenuItem({ id: 'plugin.only-note', label: '便签专用', action: () => {} }, 'note')

    expect(idsOf(buildCardMenuFor(makeCard({ type: 'image' })))).not.toContain('plugin.only-note')
    expect(idsOf(buildCardMenuFor(makeCard({ type: 'note' })))).toContain('plugin.only-note')
  })

  it('插件与核心同名时：保留核心项并提示（核心优先）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registerMenuItem({ id: CARD_ACTION.remove, label: '插件版移除', action: () => {} })

    const items = buildCardMenuFor(makeCard())
    const removeItems = items.filter((item) => item.id === CARD_ACTION.remove)

    expect(removeItems).toHaveLength(1)
    expect(removeItems[0].label).toBe('移除')
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// 动作分发（准备层：未登记时提示，登记后生效）
// ---------------------------------------------------------------------------

describe('菜单动作分发', () => {
  it('动作尚未实现时：点击只打印提示，不抛错', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const removeItem = CORE_CARD_MENU_ITEMS.find((item) => item.id === CARD_ACTION.remove)

    expect(() => removeItem?.action({ spacePath: 'D:\\Mindscape\\空间A' })).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('移除')
  })

  it('登记实现后：点击会带着上下文调用实现', () => {
    const ctx = { spacePath: 'D:\\Mindscape\\空间A', card: makeCard() }
    const handler = vi.fn()
    registerAction(CARD_ACTION.remove, handler)

    CORE_CARD_MENU_ITEMS.find((item) => item.id === CARD_ACTION.remove)?.action(ctx)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(ctx)
  })
})

// ---------------------------------------------------------------------------
// 连线菜单聚合（断开连接，2026-09-11 用户裁决）
// ---------------------------------------------------------------------------

describe('buildConnectionMenuFor', () => {
  it('连线菜单 = 编辑标签 + 删除连线（顺序固定）', () => {
    expect(idsOf(buildConnectionMenuFor())).toEqual([
      CONNECTION_ACTION.editLabel,
      CONNECTION_ACTION.remove,
    ])
  })

  it('连线菜单项都有中文 label，且未登记动作时点击不抛错', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const item of CORE_CONNECTION_MENU_ITEMS) {
      expect(item.label.length).toBeGreaterThan(0)
      expect(() => item.action({ spacePath: 'D:\\Mindscape\\空间A' })).not.toThrow()
    }
    expect(warn).toHaveBeenCalledTimes(CORE_CONNECTION_MENU_ITEMS.length)
  })
})

// ---------------------------------------------------------------------------
// 分区菜单聚合
// ---------------------------------------------------------------------------

describe('buildPartitionMenuFor', () => {
  it('默认返回全部四个分区动作（粘贴 / 重命名 / 折叠展开 / 指定颜色）', () => {
    expect(idsOf(buildPartitionMenuFor(makePartition()))).toEqual([
      PARTITION_ACTION.paste,
      PARTITION_ACTION.rename,
      PARTITION_ACTION.toggleCollapse,
      PARTITION_ACTION.setColor,
    ])
  })

  it('appliesToPartition 过滤生效（自定义一条仅对折叠状态显示的项）', () => {
    // 直接验证过滤机制：核心项当前均无 appliesToPartition，故用真实数据断言全部可见
    const collapsed = makePartition({ collapsed: true })
    expect(idsOf(buildPartitionMenuFor(collapsed))).toContain(PARTITION_ACTION.toggleCollapse)
  })

  it('「重命名分区」动作把分区上下文带给实现（2026-09-14 修复的契约前提）', () => {
    // 修复前：右键「重命名分区」直接以「当前名」调 handleRenamePartition，因命中
    // `新名 === 现名` 早退守卫而毫无反应。修复后：动作仅把分区交给上层，
    // 由上层 canvasApi.beginPartitionRename(partition.id) 进入编辑态。
    // 本测试锁定「动作必须把 partition 上下文交给实现」这一契约——若有人把菜单项
    // 改成不带 partition，beginPartitionRename 就拿不到 id，修复即失效。
    const ctx = { spacePath: 'D:\\Mindscape\\空间A', partition: makePartition() }
    const handler = vi.fn()
    registerAction(PARTITION_ACTION.rename, handler)

    CORE_PARTITION_MENU_ITEMS.find((item) => item.id === PARTITION_ACTION.rename)?.action(ctx)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(ctx)
    expect(handler.mock.calls[0][0].partition?.id).toBe('p-1')
  })
})
