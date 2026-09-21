// ============================================================================
// 模块说明（中文）
// importFilesFlow.ts 的单元测试（2026-09-21 移动端适配 M4）。
// 锁的是移动端「选择器 → 落盘」这一条独有链路的关键裁决：
//   · 前置条件不满足时给不给提示（只读要给、取消选择不给）；
//   · 字节走 write_file_bytes 而不是 copy_file（SAF 的 content:// 复制不了）；
//   · 字节来源不留可重放的源路径（undo 删副本、redo 不重建）；
//   · 失败提示的动词是「导入」而不是「拖入」。
// 依赖全部假件注入，node 环境可测（不碰 DOM、不碰 Tauri）。
// ============================================================================

import { describe, expect, it, vi } from 'vitest'

import { IMPORT_FILE_ACCEPT, IMPORT_FILES_TEXT, importPickedFiles, pickedFilesFrom } from './importFilesFlow'
import type { ImportFilesDeps } from './importFilesFlow'
import type { DropDestination } from '@/core/board/ingest'
import type { Card } from '@/core/types'

const SPACE = 'D:\\space'
const DEST: DropDestination = {
  destDir: 'D:\\space\\参考资料',
  partitionId: 'p1',
  groupName: '参考资料',
}
const POINT = { x: 100, y: 200 }

/** 假 File：选择器交回来的就是「名字 + 字节」这两样 */
function makePickedFile(name: string, bytes: number[] = [1, 2, 3]) {
  return { name, arrayBuffer: async () => new Uint8Array(bytes).buffer }
}

function makeDeps(overrides: Partial<ImportFilesDeps> = {}) {
  const written: { destDir: string; name: string; size: number }[] = []
  const deps: ImportFilesDeps = {
    spaceFolder: () => SPACE,
    readOnly: () => false,
    destination: () => DEST,
    dropPoint: () => POINT,
    writeFile: vi.fn(async (destDir: string, name: string, bytes: Uint8Array) => {
      written.push({ destDir, name, size: bytes.byteLength })
      return `${destDir}\\${name}`
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
  return { deps, written }
}

describe('importPickedFiles 前置条件', () => {
  it('用户取消选择（一个文件都没交回来）：静默返回，不打扰', async () => {
    const { deps, written } = makeDeps()

    await importPickedFiles(deps, [])

    expect(written).toEqual([])
    expect(deps.reportError).not.toHaveBeenCalled()
  })

  it('只读模式：给出「无法导入文件」的提示，且不碰文件系统', async () => {
    const { deps, written } = makeDeps({ readOnly: () => true })

    await importPickedFiles(deps, [makePickedFile('a.png')])

    expect(deps.reportError).toHaveBeenCalledWith(IMPORT_FILES_TEXT.readOnly)
    expect(written).toEqual([])
  })

  it('没打开空间：静默返回（顶栏入口本就无从点起）', async () => {
    const { deps, written } = makeDeps({ spaceFolder: () => null })

    await importPickedFiles(deps, [makePickedFile('a.png')])

    expect(written).toEqual([])
  })

  it('拿不到落点或落盘目录：一个字节都不写', async () => {
    const { deps: noDest, written } = makeDeps({ destination: () => null })
    await importPickedFiles(noDest, [makePickedFile('a.png')])
    expect(written).toEqual([])

    const { deps: noPoint } = makeDeps({ dropPoint: () => null })
    await importPickedFiles(noPoint, [makePickedFile('a.png')])
    expect(written).toEqual([])
  })
})

describe('importPickedFiles 落盘与提交', () => {
  it('字节写进落盘目录（不是复制：SAF 只给字节），文件名取选择器的原名', async () => {
    const { deps, written } = makeDeps()

    await importPickedFiles(deps, [makePickedFile('a.png', [7, 7]), makePickedFile('b.jpg')])

    expect(written).toEqual([
      { destDir: DEST.destDir, name: 'a.png', size: 2 },
      { destDir: DEST.destDir, name: 'b.jpg', size: 3 },
    ])
  })

  it('字节来源不留可重放的源路径：sources 的 src 是空串（redo 不重建）', async () => {
    const { deps } = makeDeps()
    const commit = deps.commit as ReturnType<typeof vi.fn>

    await importPickedFiles(deps, [makePickedFile('a.png')])

    const [cards, createdFiles, sources, dest] = commit.mock.calls[0] as unknown as [
      Card[],
      string[],
      { src: string; destDir: string }[],
      DropDestination,
    ]
    expect(cards.map((card) => card.id)).toEqual(['c1'])
    expect(createdFiles).toEqual([`${DEST.destDir}\\a.png`])
    expect(sources).toEqual([{ src: '', destDir: DEST.destDir }])
    expect(dest).toBe(DEST)
  })

  it('落在分区内时卡片归入该分区（与拖入同一条规则）', async () => {
    const { deps } = makeDeps()
    const commit = deps.commit as ReturnType<typeof vi.fn>

    await importPickedFiles(deps, [makePickedFile('a.png')])

    const cards = commit.mock.calls[0][0] as Card[]
    expect(cards[0]).toMatchObject({ group: '参考资料' })
  })

  it('单个文件写盘失败不阻断其余，且提示动词是「导入」', async () => {
    const { deps } = makeDeps({
      writeFile: async (_destDir, name) => {
        if (name === 'bad.png') throw new Error('空间外不允许写')
        return `D:\\space\\${name}`
      },
    })

    await importPickedFiles(deps, [makePickedFile('bad.png'), makePickedFile('a.png')])

    expect(deps.reportError).toHaveBeenCalledWith(
      '以下文件导入失败：bad.png（空间外不允许写）',
    )
    const commit = deps.commit as ReturnType<typeof vi.fn>
    expect(commit).toHaveBeenCalledTimes(1)
    expect((commit.mock.calls[0][0] as Card[]).length).toBe(1)
  })

  it('全部失败：不入撤销栈，也不把错误条清空', async () => {
    const { deps } = makeDeps({
      writeFile: async () => {
        throw new Error('只读文件系统')
      },
    })

    await importPickedFiles(deps, [makePickedFile('a.png'), makePickedFile('b.png')])

    expect(deps.commit).not.toHaveBeenCalled()
    expect(deps.reportError).toHaveBeenCalledTimes(1)
  })

  it('全部成功：错误条清空（导入成功后旧提示不能留着）', async () => {
    const { deps } = makeDeps()

    await importPickedFiles(deps, [makePickedFile('a.png')])

    expect(deps.reportError).toHaveBeenLastCalledWith(null)
  })
})

describe('pickedFilesFrom（选择器 → 业务链路的唯一一道转换）', () => {
  it('取消选择（files 为 null / undefined）→ 空数组，不抛错', () => {
    expect(pickedFilesFrom(null)).toEqual([])
    expect(pickedFilesFrom(undefined)).toEqual([])
  })

  it('FileList 没有迭代器：按索引取，原样交给业务层', () => {
    const a = makePickedFile('a.png')
    const b = makePickedFile('b.png')
    expect(pickedFilesFrom({ length: 2, 0: a, 1: b })).toEqual([a, b])
  })

  it('长度为 0 的列表 → 空数组', () => {
    expect(pickedFilesFrom({ length: 0 })).toEqual([])
  })

  it('accept 里必须有图片通配：手机相册挑出来的绝大多数是 image/*', () => {
    expect(IMPORT_FILE_ACCEPT).toContain('image/')
  })
})
