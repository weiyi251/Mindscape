import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import type { PlatformCapability } from '@/core/system/platformCapabilities'

// MiniMap 的触屏取舍是模块加载期定下的常量（一次判定，不在渲染里），
// 所以只能重设模块 + 替换能力表来分别验收。
async function markup(touchPlatform: boolean): Promise<string> {
  vi.resetModules()
  vi.doMock('@/core/system/platformCapabilities', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    supportsCapability: (capability: PlatformCapability | undefined) =>
      capability === 'touchGestures' ? touchPlatform : true,
  }))
  const { MiniMap } = await import('./MiniMap')
  return renderToStaticMarkup(<MiniMap cards={[]} partitions={[]} />)
}

describe('MiniMap 底部位置（真机第一轮：被触屏浮层压住）', () => {
  it('桌面：沿用 bottom-12', async () => {
    expect(await markup(false)).toContain('bottom-12')
  })

  it('触屏：抬到 bottom-28，让开「状态条 + 工具条」竖排两行', async () => {
    const html = await markup(true)
    expect(html).toContain('bottom-28')
    expect(html).not.toContain('bottom-12')
  })
})
