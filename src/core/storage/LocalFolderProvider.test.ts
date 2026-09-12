// ============================================================================
// 模块说明（中文）
// StorageProvider 接口的守护测试。对应 T0.7 验收标准：
//   ① 接口与 17.5 命令一一对应（共 14 个）
//   ② 替换实现不影响上层（下层实现可被任意替身替换）
// ============================================================================

import { describe, expect, it, vi } from 'vitest'
import {
  LAYOUT_CORRUPT_MARKER,
  StorageError,
  type BatchMoveResult,
  type DirEntry,
  type StorageProvider,
} from './StorageProvider'
import { LocalFolderProvider, STORAGE_COMMANDS } from './LocalFolderProvider'

/** 17.5「Rust 侧命令清单」全文，逐条抄录作为守护基准。
 *  T3 阶段在清单外新增 2 个辅助命令（delete_file / write_file_bytes，
 *  先例同 T2.6 的 rename_dir —— 文档允许「补命令」但不允许改签名），
 *  因此守护基准分为「17.5 原文（含方案 A 修订）」与「实现全量」两层。
 *  ⚠️ 2026-09-12 方案 A：copy_image_with_thumbnail 随缩略图下线从清单移除。 */
const COMMANDS_FROM_DOC_17_5 = [
  // fs_ops.rs
  'list_dir',
  'copy_file',
  'move_file',
  'move_files',
  'rename_dir',
  'create_dir',
  'dir_exists',
  // layout.rs
  'read_layout',
  'write_layout',
  // thumbnail.rs
  'make_thumbnail',
  // system.rs
  'open_with_default',
  'reveal_in_explorer',
  'read_image_size',
] as const

/** 17.5 清单 + 各阶段任务新增的命令（rename_dir 属 T2.6，delete_file / write_file_bytes 属 T3.6/T3.8） */
const COMMANDS_IMPLEMENTED = [
  ...COMMANDS_FROM_DOC_17_5,
  'delete_file',
  'write_file_bytes',
] as const

describe('StorageProvider ↔ 17.5 命令一一对应', () => {
  it('对照表必须完整覆盖 17.5 原文列出的命令（含方案 A 修订）', () => {
    for (const command of COMMANDS_FROM_DOC_17_5) {
      expect(Object.values(STORAGE_COMMANDS)).toContain(command)
    }
  })

  it('对照表与实现全量一致（17.5 清单 + 新增 2 个）', () => {
    expect([...Object.values(STORAGE_COMMANDS)].sort()).toEqual(
      [...COMMANDS_IMPLEMENTED].sort()
    )
  })

  it('方法名与命令名的映射完整（无遗漏、无重复）', () => {
    const methodNames = Object.keys(STORAGE_COMMANDS)
    expect(methodNames).toHaveLength(COMMANDS_IMPLEMENTED.length)
    expect(new Set(methodNames).size).toBe(COMMANDS_IMPLEMENTED.length)
    expect(new Set(Object.values(STORAGE_COMMANDS)).size).toBe(COMMANDS_IMPLEMENTED.length)
  })

  it('LocalFolderProvider 实现了接口上的每一个方法', () => {
    const provider = new LocalFolderProvider()
    for (const method of Object.keys(STORAGE_COMMANDS)) {
      expect(typeof (provider as unknown as Record<string, unknown>)[method]).toBe('function')
    }
  })
})

describe('替换实现不影响上层', () => {
  /**
   * 一个只依赖接口的「上层函数」：换掉 provider，它不需要任何改动。
   * 若能通过编译并在两种实现下都正常工作，即证明抽象成立。
   */
  async function loadSpaceSummary(provider: StorageProvider, spacePath: string) {
    const [entries, hasRemovedDir, layoutJson] = await Promise.all([
      provider.listDir(spacePath),
      provider.dirExists(`${spacePath}\\_已移除`),
      provider.readLayout(spacePath),
    ])
    return {
      fileCount: entries.length,
      hasRemovedDir,
      layoutVersion: (JSON.parse(layoutJson) as { version: number }).version,
    }
  }

  /** 内存实现：完全不碰 Tauri，用来证明上层可被替换 */
  function createMemoryProvider(files: DirEntry[], layoutJson: string): StorageProvider {
    const notImplemented = (name: string) => () =>
      Promise.reject(new StorageError(`测试替身未实现 ${name}`))

    return {
      listDir: () => Promise.resolve(files),
      dirExists: () => Promise.resolve(true),
      readLayout: () => Promise.resolve(layoutJson),
      copyFile: notImplemented('copyFile'),
      moveFile: notImplemented('moveFile'),
      moveFiles: notImplemented('moveFiles'),
      renameDir: notImplemented('renameDir'),
      createDir: () => Promise.resolve(),
      deleteFile: () => Promise.resolve(),
      writeFileBytes: notImplemented('writeFileBytes'),
      writeLayout: () => Promise.resolve(),
      makeThumbnail: notImplemented('makeThumbnail'),
      openWithDefault: () => Promise.resolve(),
      revealInExplorer: () => Promise.resolve(),
      readImageSize: notImplemented('readImageSize'),
    } satisfies StorageProvider
  }

  it('同一段上层代码可跑在内存实现上（无需 Tauri 运行时）', async () => {
    const provider = createMemoryProvider(
      [
        { name: '参考图.jpg', path: 'E:\\sp\\参考图.jpg', isDir: false, size: 10, modifiedAt: 1 },
      ],
      '{"version":1,"cards":[],"partitions":[],"connections":[],"removed":[],"extensions":{}}'
    )

    const summary = await loadSpaceSummary(provider, 'E:\\sp')
    expect(summary).toEqual({ fileCount: 1, hasRemovedDir: true, layoutVersion: 1 })
  })

  it('LocalFolderProvider 也满足同一段上层代码的类型要求', () => {
    // 编译期约束：LocalFolderProvider 可直接赋给 StorageProvider
    const asInterface: StorageProvider = new LocalFolderProvider()
    expect(asInterface).toBeInstanceOf(LocalFolderProvider)
    expect(vi.isMockFunction(asInterface.listDir)).toBe(false)
  })
})

describe('StorageError', () => {
  it('可识别「布局文件损坏已恢复」这一类错误', () => {
    const err = new StorageError(`${LAYOUT_CORRUPT_MARKER}，已备份为 layout.json.bak 并重建。`)
    expect(err.isLayoutCorrupt).toBe(true)
    expect(err.name).toBe('StorageError')
  })

  it('普通 IO 错误不会被误判为损坏', () => {
    const err = new StorageError('无权限访问：E:\\sp\\.mindscape\\layout.json')
    expect(err.isLayoutCorrupt).toBe(false)
  })

  it('标记与 Rust 侧常量保持一致（同一字面量）', () => {
    // Rust: src-tauri/src/commands/layout.rs -> LAYOUT_CORRUPT_MARKER
    expect(LAYOUT_CORRUPT_MARKER).toBe('布局文件损坏')
  })
})

/** 批量移动结果的形状（对应 17.5「返回成功与失败清单」，见下） */
describe('BatchMoveResult 形状', () => {
  it('同时携带成功清单与失败清单', () => {
    const result: BatchMoveResult = {
      succeeded: ['E:\\sp\\_已移除\\参考资料\\ref-01.jpg'],
      failed: [{ path: 'E:\\sp\\灵感收集\\b.jpg', reason: '文件被占用' }],
    }
    expect(result.succeeded).toHaveLength(1)
    expect(result.failed[0].reason).toBe('文件被占用')
  })
})
