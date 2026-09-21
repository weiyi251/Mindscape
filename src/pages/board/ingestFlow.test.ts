// ============================================================================
// 模块说明（中文）
// ingestFlow.ts 的单元测试（2026-09-21 移动端适配 M4，从 Board.tsx 外抽的公共链路）。
// 锁的是三条入口（拖入 / 粘贴 / 导入）共用的行为：逐个复制、落点错开步长、
// 分区归属、失败按文件汇总而不中断、字节来源不带可重放源路径。
// 依赖全部假件注入，node 环境可测（不碰 DOM、不碰 Tauri）。
// ============================================================================

import { describe, expect, it, vi } from 'vitest'

import { INGEST_FLOW_TEXT, INGEST_OFFSET_STEP, ingestExternalItems } from './ingestFlow'
import type { ExternalIngestDeps, IngestItem } from './ingestFlow'
import type { DropDestination } from '@/core/board/ingest'
import type { Card } from '@/core/types'

const SPACE = 'D:\\space'
const DEST: DropDestination = {
  destDir: 'D:\\space\\参考资料',
  partitionId: 'p1',
  groupName: '参考资料',
}
const POINT = { x: 100, y: 200 }

function makeDeps(overrides: Partial<ExternalIngestDeps> = {}) {
  const copied: { name: string; path?: string; hasBytes: boolean; destDir: string }[] = []
  const deps: ExternalIngestDeps = {
    copyIn: vi.fn(async (item: IngestItem, destDir: string) => {
      copied.push({
        name: item.name,
        path: item.path,
        hasBytes: item.bytes !== undefined,
        destDir,
      })
      return `D:\\space\\参考资料\\${item.name}`
    }),
    buildCard: vi.fn(
      async ({ id, actualAbs, offset }: { id: string; actualAbs: string; offset: number }) =>
        ({ id, filePath: actualAbs, x: POINT.x + offset }) as unknown as Card,
    ),
    usedCardIds: () => ['c0'],
    nextCardId: (taken) => `c${taken.length}`,
    commit: vi.fn(async () => {}),
    reportError: vi.fn(),
    ...overrides,
  }
  return { deps, copied }
}

describe('ingestExternalItems 公共链路', () => {
  it('逐个复制并落盘，卡片落点按步长错开（不重叠成一坨）', async () => {
    const { deps, copied } = makeDeps()

    await ingestExternalItems(
      deps,
      [{ name: 'a.png', path: 'C:\\tmp\\a.png' }, { name: 'b.png', path: 'C:\\tmp\\b.png' }],
      SPACE,
      DEST,
      POINT,
      '拖入',
    )

    expect(copied.map((item) => item.name)).toEqual(['a.png', 'b.png'])
    expect(copied.every((item) => item.destDir === DEST.destDir)).toBe(true)
    const buildCard = deps.buildCard as ReturnType<typeof vi.fn>
    expect(buildCard.mock.calls.map((call) => (call[0] as { offset: number }).offset)).toEqual([
      0,
      INGEST_OFFSET_STEP,
    ])
  })

  it('卡片 id 递增时把本次已建出的 id 一起算进去（不与同批撞号）', async () => {
    const takenLists: string[][] = []
    const { deps } = makeDeps({
      nextCardId: (taken) => {
        takenLists.push([...taken])
        return `c${taken.length}`
      },
    })

    await ingestExternalItems(
      deps,
      [{ name: 'a.png', path: 'C:\\a.png' }, { name: 'b.png', path: 'C:\\b.png' }],
      SPACE,
      DEST,
      POINT,
      '拖入',
    )

    expect(takenLists[0]).toEqual(['c0'])
    // 第二轮的占用表里必须已经含第一轮生成的 c1，否则两张卡同号
    expect(takenLists[1]).toContain('c1')
  })

  it('落在分区内时卡片归入该分区，分区外不写 group', async () => {
    const inside = makeDeps()
    await ingestExternalItems(
      inside.deps,
      [{ name: 'a.png', path: 'C:\\a.png' }],
      SPACE,
      DEST,
      POINT,
      '拖入',
    )
    expect((inside.deps.commit as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toEqual([
      { id: 'c1', filePath: 'D:\\space\\参考资料\\a.png', x: POINT.x, group: '参考资料' },
    ])

    const outside = makeDeps()
    await ingestExternalItems(
      outside.deps,
      [{ name: 'a.png', path: 'C:\\a.png' }],
      SPACE,
      { destDir: SPACE, partitionId: null, groupName: null },
      POINT,
      '拖入',
    )
    expect(
      (outside.deps.commit as ReturnType<typeof vi.fn>).mock.calls[0]?.[0][0],
    ).not.toHaveProperty('group')
  })

  it('sources 记录：路径来源带 src（redo 可重建），字节来源带空串（与截图粘贴同一约定）', async () => {
    const { deps } = makeDeps()

    await ingestExternalItems(
      deps,
      [{ name: 'a.png', path: 'C:\\a.png' }, { name: 'b.png', bytes: new Uint8Array([1, 2]) }],
      SPACE,
      DEST,
      POINT,
      '导入',
    )

    const commit = deps.commit as ReturnType<typeof vi.fn>
    const [cards, createdFiles, sources] = commit.mock.calls[0] ?? []
    expect(cards).toHaveLength(2)
    expect(createdFiles).toEqual(['D:\\space\\参考资料\\a.png', 'D:\\space\\参考资料\\b.png'])
    expect(sources).toEqual([
      { src: 'C:\\a.png', destDir: DEST.destDir },
      { src: '', destDir: DEST.destDir },
    ])
  })

  it('单个文件失败不阻断其余，失败提示按入口名带文件名与原因', async () => {
    const { deps } = makeDeps({
      copyIn: vi.fn(async (item: IngestItem) => {
        if (item.name === 'bad.png') throw new Error('不是文件')
        return `D:\\space\\参考资料\\${item.name}`
      }),
    })

    await ingestExternalItems(
      deps,
      [{ name: 'bad.png', path: 'content://x' }, { name: 'good.png', path: 'C:\\good.png' }],
      SPACE,
      DEST,
      POINT,
      '导入',
    )

    expect((deps.commit as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toHaveLength(1)
    expect((deps.reportError as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(
      INGEST_FLOW_TEXT.failed('导入', 'bad.png（不是文件）'),
    )
  })

  it('全部失败：不提交任何东西（撤销栈保持干净）', async () => {
    const { deps } = makeDeps({
      copyIn: vi.fn(async () => {
        throw new Error('读不到')
      }),
    })

    await ingestExternalItems(
      deps,
      [{ name: 'a.png', path: 'C:\\a.png' }, { name: 'b.png', path: 'C:\\b.png' }],
      SPACE,
      DEST,
      POINT,
      '粘贴',
    )

    expect(deps.commit).not.toHaveBeenCalled()
    expect(deps.reportError).toHaveBeenCalledWith(INGEST_FLOW_TEXT.failed('粘贴', 'a.png（读不到）；b.png（读不到）'))
  })

  it('非全部失败时清空错误条（沿用拖入链路的既有行为，不新增噪音）', async () => {
    const { deps } = makeDeps()

    await ingestExternalItems(
      deps,
      [{ name: 'a.png', path: 'C:\\a.png' }],
      SPACE,
      DEST,
      POINT,
      '拖入',
    )

    expect(deps.reportError).toHaveBeenLastCalledWith(null)
  })
})
