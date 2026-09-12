// ============================================================================
// 模块说明（中文）
// appLayoutStore 的单元测试。vitest 环境为 node（项目不引入 jsdom，用户裁决），
// 因此不渲染 UI：fs 插件与路径 API 全部 mock 成内存实现，provider 用假对象，
// 只验证「路径怎么算、文件怎么读写、旧布局怎么判定」这条纯逻辑链路。
//
// 实现任务：P1-2。
// ============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createEmptyLayout } from '@/core/types'

/* eslint-disable @typescript-eslint/no-explicit-any */

const { fsState, listDirMock, createDirMock, copyFileMock, deleteFileMock } = vi.hoisted(() => ({
  fsState: {
    files: new Map<string, string>(),
    /** 用户文件夹里的文件（copy_file 的源）；与软件目录的 files 分开存，便于断言「源没被动」 */
    sourceFiles: new Map<string, string>(),
    trace: [] as string[],
  },
  listDirMock: vi.fn(),
  createDirMock: vi.fn(),
  copyFileMock: vi.fn(),
  deleteFileMock: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: async (filePath: string) => fsState.files.has(filePath),
  readTextFile: async (filePath: string) => {
    const text = fsState.files.get(filePath)
    if (text === undefined) throw new Error(`文件不存在：${filePath}`)
    return text
  },
  writeTextFile: async (filePath: string, text: string) => {
    fsState.files.set(filePath, text)
    fsState.trace.push(`write:${filePath}`)
  },
  rename: async (from: string, to: string) => {
    const text = fsState.files.get(from)
    if (text === undefined) throw new Error(`文件不存在：${from}`)
    fsState.files.delete(from)
    fsState.files.set(to, text)
    fsState.trace.push(`rename:${from}->${to}`)
  },
}))

vi.mock('@tauri-apps/api/path', () => ({
  dataDir: async () => 'C:\\Users\\tester\\AppData\\Roaming',
  join: async (...parts: string[]) => parts.join('\\'),
}))

vi.mock('@/core/utils/runtime', () => ({ assertDesktopRuntime: () => {} }))

const {
  EXPORTED_LAYOUT_FILE,
  LEGACY_LAYOUT_DIR,
  LEGACY_LAYOUT_FILE,
  LAYOUTS_DIR_NAME,
  adoptExportedLayout,
  createAppLayoutStore,
  exportedLayoutExists,
  getLayoutsDir,
  isSafeLayoutKey,
  layoutFileName,
  removeExportedLayout,
} = await import('./appLayoutStore')

/** 假 provider：只实现 appLayoutStore 用到的四个方法 */
const provider = {
  createDir: createDirMock,
  listDir: listDirMock,
  copyFile: copyFileMock,
  deleteFile: deleteFileMock,
} as any

const store = createAppLayoutStore(provider)

const LAYOUTS_DIR = 'C:\\Users\\tester\\AppData\\Roaming\\Mindscape\\layouts'

beforeEach(() => {
  fsState.files.clear()
  fsState.sourceFiles.clear()
  fsState.trace = []
  listDirMock.mockReset()
  createDirMock.mockReset()
  copyFileMock.mockReset()
  deleteFileMock.mockReset()

  // copy_file 的模拟：把源内容按**原名**落进目标目录，返回真实落地路径
  copyFileMock.mockImplementation(async (src: string, destDir: string) => {
    const name = src.split('\\').pop() as string
    const target = `${destDir}\\${name}`
    fsState.files.set(target, fsState.sourceFiles.get(src) ?? '')
    fsState.trace.push(`copy:${src}->${target}`)
    return target
  })
  deleteFileMock.mockImplementation(async (filePath: string) => {
    fsState.files.delete(filePath)
    fsState.sourceFiles.delete(filePath)
    fsState.trace.push(`delete:${filePath}`)
  })
})

describe('isSafeLayoutKey / layoutFileName', () => {
  it('接受应用自己生成的 id', () => {
    for (const id of ['s_1', 'sp-20260912', 'abc123', 'A_b-9']) {
      expect(isSafeLayoutKey(id), id).toBe(true)
    }
  })

  it('挡住路径逃逸与非法字符', () => {
    for (const id of ['../x', 'a/b', 'a\\b', '..', '', '空格 id', 'a.b']) {
      expect(isSafeLayoutKey(id), id).toBe(false)
    }
  })

  it('文件名由 id 加 .json 组成', () => {
    expect(layoutFileName('s_1')).toBe('s_1.json')
  })

  it('非法 id 抛中文错误', () => {
    expect(() => layoutFileName('../x')).toThrowError(/非法字符/)
  })

  it('软件目录内的布局目录是 %APPDATA%\\Mindscape\\layouts', async () => {
    expect(await getLayoutsDir()).toBe(LAYOUTS_DIR)
    expect(LAYOUTS_DIR_NAME).toBe('layouts')
  })
})

describe('read', () => {
  it('文件不存在时返回 null（首次打开空间）', async () => {
    await expect(store.read('s_1')).resolves.toBeNull()
  })

  it('文件存在时返回原文', async () => {
    fsState.files.set(`${LAYOUTS_DIR}\\s_1.json`, '{"version":1}')
    await expect(store.read('s_1')).resolves.toBe('{"version":1}')
  })

  it('id 非法时返回 null 而不是抛错（手改过 spaces.json 也不该打不开空间）', async () => {
    await expect(store.read('../x')).resolves.toBeNull()
    await expect(store.read('')).resolves.toBeNull()
  })
})

describe('write', () => {
  it('先建目录，再写 .tmp 并 rename（与 spaces.json 同一套原子写入）', async () => {
    await store.write('s_1', '{"version":1}')

    expect(createDirMock).toHaveBeenCalledWith(LAYOUTS_DIR)
    expect(fsState.trace).toEqual([
      `write:${LAYOUTS_DIR}\\s_1.json.tmp`,
      `rename:${LAYOUTS_DIR}\\s_1.json.tmp->${LAYOUTS_DIR}\\s_1.json`,
    ])
    expect(fsState.files.get(`${LAYOUTS_DIR}\\s_1.json`)).toBe('{"version":1}')
    // 不残留 .tmp
    expect(fsState.files.has(`${LAYOUTS_DIR}\\s_1.json.tmp`)).toBe(false)
  })

  it('重复写入覆盖旧内容', async () => {
    await store.write('s_1', '旧')
    await store.write('s_1', '新')
    expect(fsState.files.get(`${LAYOUTS_DIR}\\s_1.json`)).toBe('新')
  })

  it('id 非法时抛中文错误', async () => {
    await expect(store.write('../x', '{}')).rejects.toThrowError(/非法字符/)
  })
})

describe('legacyLayoutExists', () => {
  const spacePath = 'D:\\我的项目'

  it('旧布局存在时返回 true', async () => {
    listDirMock.mockResolvedValue([
      { name: LEGACY_LAYOUT_FILE, path: '', isDir: false, size: 10, modifiedAt: null },
    ])

    await expect(store.legacyLayoutExists(spacePath)).resolves.toBe(true)
    expect(listDirMock).toHaveBeenCalledWith(`D:\\我的项目\\${LEGACY_LAYOUT_DIR}`)
  })

  it('同名目录不算布局文件', async () => {
    listDirMock.mockResolvedValue([
      { name: LEGACY_LAYOUT_FILE, path: '', isDir: true, size: 0, modifiedAt: null },
    ])
    await expect(store.legacyLayoutExists(spacePath)).resolves.toBe(false)
  })

  it('没有 .mindscape 目录时返回 false（新建空间）', async () => {
    listDirMock.mockRejectedValue(new Error('路径不存在：D:\\我的项目\\.mindscape'))
    await expect(store.legacyLayoutExists(spacePath)).resolves.toBe(false)
  })

  it('目录里是别的文件时返回 false', async () => {
    listDirMock.mockResolvedValue([
      { name: 'layout.json.bak', path: '', isDir: false, size: 10, modifiedAt: null },
    ])
    await expect(store.legacyLayoutExists(spacePath)).resolves.toBe(false)
  })

  it('导出文件名常量与用户裁决一致', () => {
    expect(EXPORTED_LAYOUT_FILE).toBe('mindscape-layout.json')
  })
})

// ---------------------------------------------------------------------------
// 导入 / 导出（P1-2b）
// ---------------------------------------------------------------------------

const SOURCE_DIR = 'D:\\别人的文件夹'
const SOURCE_FILE = `${SOURCE_DIR}\\${EXPORTED_LAYOUT_FILE}`
const VALID_LAYOUT = JSON.stringify(createEmptyLayout())

describe('exportedLayoutExists', () => {
  it('目标文件夹里有 mindscape-layout.json 时返回 true', async () => {
    listDirMock.mockResolvedValue([
      { name: 'a.txt', path: '', isDir: false, size: 1, modifiedAt: null },
      { name: EXPORTED_LAYOUT_FILE, path: '', isDir: false, size: 99, modifiedAt: null },
    ])

    await expect(exportedLayoutExists(provider, SOURCE_DIR)).resolves.toBe(true)
  })

  it('同名目录不算（只有文件才算）', async () => {
    listDirMock.mockResolvedValue([
      { name: EXPORTED_LAYOUT_FILE, path: '', isDir: true, size: 0, modifiedAt: null },
    ])

    await expect(exportedLayoutExists(provider, SOURCE_DIR)).resolves.toBe(false)
  })

  it('文件夹读不了时按「没有」处理，不抛错', async () => {
    listDirMock.mockRejectedValue(new Error('路径不存在：D:\\别人的文件夹'))

    await expect(exportedLayoutExists(provider, SOURCE_DIR)).resolves.toBe(false)
  })
})

describe('adoptExportedLayout', () => {
  it('把导出布局收进软件目录，落到 <空间 id>.json', async () => {
    fsState.sourceFiles.set(SOURCE_FILE, VALID_LAYOUT)

    await expect(adoptExportedLayout(provider, 's_9', SOURCE_DIR)).resolves.toBe('ok')

    expect(createDirMock).toHaveBeenCalledWith(LAYOUTS_DIR)
    expect(fsState.files.get(`${LAYOUTS_DIR}\\s_9.json`)).toBe(VALID_LAYOUT)
    // 中间那份拷贝已经改名，不残留
    expect(fsState.files.has(`${LAYOUTS_DIR}\\${EXPORTED_LAYOUT_FILE}`)).toBe(false)
    // 源文件夹里的那份没被动（是否移除由调用方征得用户同意后决定）
    expect(fsState.sourceFiles.has(SOURCE_FILE)).toBe(true)
  })

  it('内容不是合法布局 → 清掉拷贝并返回 invalid', async () => {
    fsState.sourceFiles.set(SOURCE_FILE, '{"version":1,"cards":"不是数组"}')

    await expect(adoptExportedLayout(provider, 's_9', SOURCE_DIR)).resolves.toBe('invalid')

    expect(fsState.files.has(`${LAYOUTS_DIR}\\${EXPORTED_LAYOUT_FILE}`)).toBe(false)
    expect(fsState.files.has(`${LAYOUTS_DIR}\\s_9.json`)).toBe(false)
  })

  it('copy_file 因重名加了序号时也以返回值为准', async () => {
    copyFileMock.mockImplementation(async () => {
      const target = `${LAYOUTS_DIR}\\${EXPORTED_LAYOUT_FILE}_1`
      fsState.files.set(target, VALID_LAYOUT)
      return target
    })

    await expect(adoptExportedLayout(provider, 's_9', SOURCE_DIR)).resolves.toBe('ok')
    expect(fsState.files.get(`${LAYOUTS_DIR}\\s_9.json`)).toBe(VALID_LAYOUT)
  })
})

describe('removeExportedLayout', () => {
  it('删掉的是源文件夹里的导出文件', async () => {
    fsState.sourceFiles.set(SOURCE_FILE, VALID_LAYOUT)

    await removeExportedLayout(provider, SOURCE_DIR)

    expect(fsState.sourceFiles.has(SOURCE_FILE)).toBe(false)
  })
})
