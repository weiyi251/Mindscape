// ============================================================================
// 模块说明（中文）
// 分区框组件单元测试。重点覆盖 2026-09-14 修复的「改名编辑态外部驱动」：
//   编辑态改为由父层（Canvas）单一数据源 `editing` 驱动，双击标题与右键菜单
//   「重命名分区」共用同一路径。本测试用 renderToStaticMarkup 做服务端静态渲染
//   （与 components/ui/menu-list.test.tsx 同手法，无需 jsdom），断言：
//     · editing=false → 渲染名称 span，不渲染输入框；
//     · editing=true  → 渲染输入框且初始值等于当前分区名（菜单即走此态）；
//     · 折叠状态标题条仍正常渲染。
//
// 实现任务：T2.6 / 2026-09-14 修复。
// ============================================================================

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { zPartitionSchema } from '@/core/types'
import type { Partition } from '@/core/types'
import { PartitionView } from './Partition'

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

describe('PartitionView 改名编辑态（2026-09-14 修复：外部驱动）', () => {
  it('未进入编辑态：渲染名称 span，不渲染输入框', () => {
    const html = renderToStaticMarkup(<PartitionView partition={makePartition()} color="#3b82f6" />)

    // 标题展示了分区名
    expect(html).toContain('参考资料')
    // 不应出现输入框（改名输入框只在 editing 时为 true 时渲染）
    expect(html).not.toContain('<input')
  })

  it('进入编辑态（editing=true）：渲染输入框且值初始化为当前名（菜单「重命名分区」即走此态）', () => {
    const html = renderToStaticMarkup(
      <PartitionView
        partition={makePartition()}
        color="#3b82f6"
        editing
        onBeginEdit={() => {}}
        onCancelEdit={() => {}}
        onRename={() => {}}
      />,
    )

    // 改名输入框已出现（由父层 editing 单一数据源驱动，不再依赖组件内部 state）
    expect(html).toContain('<input')
    // 初始草稿等于当前分区名（进入编辑态时由父层注入），用户直接改即可
    expect(html).toContain('value="参考资料"')
    // 编辑态下不再渲染「双击改名」提示 span（输入框已取代它）
    expect(html).not.toContain('（双击改名）')
  })

  it('折叠状态：标题条与展开按钮正常渲染', () => {
    const html = renderToStaticMarkup(
      <PartitionView partition={makePartition({ collapsed: true })} color="#3b82f6" />,
    )
    // 折叠按钮存在且文案正确
    expect(html).toContain('title="展开分区"')
  })
})
