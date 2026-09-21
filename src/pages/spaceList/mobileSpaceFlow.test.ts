// ============================================================================
// 模块说明（中文）
// mobileSpaceFlow（空间列表页移动端的落点决策）单元测试（2026-09-21 移动端适配 M4）。
// 钉的是「移动端挑不了文件夹时，新建 / 导出 / 导入三条路各自落到哪、
// 什么时候必须先报错」——这些判断一旦写进 JSX 就没法在 node 环境验证。
// 桌面侧只验「行为与改动前一致」（能力表 desktop 分支）。
// ============================================================================

import { describe, expect, it, vi } from 'vitest'

import { createEmptyLayout } from '@/core/types'

import {
  planExportTarget,
  planSpaceFolder,
  readLayoutFileForImport,
  suggestedSpaceNameOf,
  SPACE_FLOW_TEXT,
} from './mobileSpaceFlow'
import type { LayoutFileDeps } from './mobileSpaceFlow'
import type { PickedFile } from '@/pages/board/ingestFlow'

/** 每个用例一套依赖：mock 不跨用例串味（「没被调用」这类断言才有意义） */
function mobileDeps() {
  return {
    canPickFolder: false,
    resolveMobileDir: vi.fn(async (name: string) => `/data/app/files/Mindscape/spaces/${name}`),
  }
}

function desktopDeps() {
  return { canPickFolder: true, resolveMobileDir: vi.fn(async () => '不该被调用') }
}

function pickedFile(name: string, text: string): PickedFile {
  return { name, arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer }
}

describe('planSpaceFolder（新建空间的落点）', () => {
  it('桌面：沿用用户挑的文件夹，一个字节都不改', async () => {
    const deps = desktopDeps()

    await expect(planSpaceFolder(deps, '项目A', 'D:\\项目A')).resolves.toEqual({
      ok: true,
      folderPath: 'D:\\项目A',
    })
    expect(deps.resolveMobileDir).not.toHaveBeenCalled()
  })

  it('桌面：没选文件夹仍然是「请选择空间文件夹」（与改动前同一句文案）', async () => {
    await expect(planSpaceFolder(desktopDeps(), '项目A', '  ')).resolves.toEqual({
      ok: false,
      error: '请选择空间文件夹',
    })
  })

  it('移动端：文件夹按空间名派生，不需要用户挑', async () => {
    const deps = mobileDeps()

    await expect(planSpaceFolder(deps, ' 项目A ', '随便什么')).resolves.toEqual({
      ok: true,
      folderPath: '/data/app/files/Mindscape/spaces/项目A',
    })
    expect(deps.resolveMobileDir).toHaveBeenCalledWith('项目A')
  })

  it('移动端：名字为空时先报错，不去建一个空目录', async () => {
    const deps = mobileDeps()

    await expect(planSpaceFolder(deps, '   ', '')).resolves.toEqual({
      ok: false,
      error: SPACE_FLOW_TEXT.needNameForFolder,
    })
    expect(deps.resolveMobileDir).not.toHaveBeenCalled()
  })

  it('移动端：派生目录失败（数据目录读不到等）原样向上抛，由弹窗显示', async () => {
    const deps = {
      ...mobileDeps(),
      resolveMobileDir: vi.fn(async () => {
        throw new Error('写入失败：/data（权限不足）')
      }),
    }

    await expect(planSpaceFolder(deps, '项目A', '')).rejects.toThrow('写入失败：/data（权限不足）')
  })
})

describe('planExportTarget（导出布局的落点）', () => {
  it('桌面：走文件夹对话框，用户取消返回 null（调用方静默返回）', async () => {
    const pickDir = vi.fn(async () => null)

    await expect(planExportTarget({ canPickFolder: true, pickDir, resolveMobileExportDir: vi.fn() }, '项目A')).resolves.toBeNull()
    expect(pickDir).toHaveBeenCalledTimes(1)
  })

  it('桌面：对话框给出的目录原样使用', async () => {
    const target = await planExportTarget(
      { canPickFolder: true, pickDir: async () => 'D:\\分享', resolveMobileExportDir: vi.fn() },
      '项目A',
    )

    expect(target).toBe('D:\\分享')
  })

  it('移动端：不弹对话框，落在应用数据目录的 exports 下', async () => {
    const pickDir = vi.fn(async () => '不该被调用')
    const resolveMobileExportDir = vi.fn(async (name: string) => `/data/app/files/Mindscape/exports/${name}`)

    await expect(
      planExportTarget({ canPickFolder: false, pickDir, resolveMobileExportDir }, '项目A'),
    ).resolves.toBe('/data/app/files/Mindscape/exports/项目A')
    expect(pickDir).not.toHaveBeenCalled()
  })
})

describe('readLayoutFileForImport（移动端导入的第一步）', () => {
  /** 与生产同一取字节方式：选择器给的是 File，字节要 await arrayBuffer 才有 */
  const readFromPicker: LayoutFileDeps['readBytes'] = async (file) =>
    new Uint8Array(await file.arrayBuffer())

  it('读到合法布局的字节 → ok，并给出建议空间名', async () => {
    const text = JSON.stringify(createEmptyLayout())
    const file = pickedFile('我的空间.json', text)

    const result = await readLayoutFileForImport({ readBytes: readFromPicker }, file)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(new TextDecoder().decode(result.bytes)).toBe(text)
    expect(result.suggestedName).toBe('我的空间')
  })

  it('没有选中文件（用户取消选择器）→ 中文提示，不读任何东西', async () => {
    const readBytes = vi.fn()

    await expect(readLayoutFileForImport({ readBytes }, undefined)).resolves.toEqual({
      ok: false,
      error: SPACE_FLOW_TEXT.noFilePicked,
    })
    expect(readBytes).not.toHaveBeenCalled()
  })

  it('选中的不是布局文件 → 报错并带上文件名（此时还没建空间，列表里不会留半个空空间）', async () => {
    const file = pickedFile('说明.txt', '这不是 JSON')

    await expect(readLayoutFileForImport({ readBytes: readFromPicker }, file)).resolves.toEqual({
      ok: false,
      error: SPACE_FLOW_TEXT.notALayout('说明.txt'),
    })
  })

  it('结构合法但字段不对（parseLayout 判定失败）同样按「不是布局」处理', async () => {
    const file = pickedFile('mindscape-layout.json', '{"version":1,"cards":"不是数组"}')

    const result = await readLayoutFileForImport({ readBytes: readFromPicker }, file)

    expect(result).toEqual({ ok: false, error: SPACE_FLOW_TEXT.notALayout('mindscape-layout.json') })
  })
})

describe('suggestedSpaceNameOf', () => {
  it('去掉 .json 后缀当作空间名', () => {
    expect(suggestedSpaceNameOf('项目A.json')).toBe('项目A')
    expect(suggestedSpaceNameOf('项目A.JSON')).toBe('项目A')
  })

  it('人人都叫 mindscape-layout 时换成可读的默认名', () => {
    expect(suggestedSpaceNameOf('mindscape-layout.json')).toBe('导入的空间')
    expect(suggestedSpaceNameOf('.json')).toBe('导入的空间')
  })
})
