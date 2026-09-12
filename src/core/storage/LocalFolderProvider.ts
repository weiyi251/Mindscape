// ============================================================================
// 模块说明（中文）
// 存储层的本地实现：通过 Tauri invoke 调用 17.5 规定的 Rust 命令，直接读写硬盘文件夹。
//
// 这是第一版唯一的实现（第十三章「准备 6」）。将来接入云盘 / 服务器时新增 CloudProvider
// 即可，上层业务代码不需要改动 —— 上层只 import StorageProvider 接口，不 import 本文件。
//
// 参数命名：Tauri v2 默认把 Rust 的 snake_case 参数在 JS 侧暴露为 camelCase，
// 因此 `space_path` 对应 `{ spacePath }`、`dest_dir` 对应 `{ destDir }`。
//
// 错误处理：所有命令失败时统一抛 StorageError，message 即 Rust 返回的中文消息。
// ============================================================================

import { invoke } from '@tauri-apps/api/core'
import { assertDesktopRuntime } from '@/core/utils/runtime'
import {
  StorageError,
  type BatchMoveResult,
  type DirEntry,
  type ImageSize,
  type MovePair,
  type StorageProvider,
  type ThumbInfo,
} from './StorageProvider'

/**
 * 方法名 → Rust 命令名对照表。
 * 与 17.5「Rust 侧命令清单」一一对应（copy_image_with_thumbnail 已随方案 A 移除，
 * make_thumbnail 保留但前端不再调用），由 LocalFolderProvider.test.ts 守护。
 */
export const STORAGE_COMMANDS = {
  listDir: 'list_dir',
  copyFile: 'copy_file',
  moveFile: 'move_file',
  moveFiles: 'move_files',
  renameDir: 'rename_dir',
  createDir: 'create_dir',
  dirExists: 'dir_exists',
  deleteFile: 'delete_file',
  writeFileBytes: 'write_file_bytes',
  readLayout: 'read_layout',
  writeLayout: 'write_layout',
  makeThumbnail: 'make_thumbnail',
  openWithDefault: 'open_with_default',
  revealInExplorer: 'reveal_in_explorer',
  readImageSize: 'read_image_size',
} as const

/** 把任意 reject 值归一化成可直接展示的中文消息 */
function toMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  return String(error)
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    // 浏览器里没有 Rust 后端，invoke 会抛英文 TypeError；这里先换成可执行的中文提示
    assertDesktopRuntime()
    return await invoke<T>(command, args)
  } catch (error) {
    throw new StorageError(toMessage(error), error)
  }
}

/** 本地文件夹存储实现（调用 Rust 端命令） */
export class LocalFolderProvider implements StorageProvider {
  listDir(path: string): Promise<DirEntry[]> {
    return call<DirEntry[]>(STORAGE_COMMANDS.listDir, { path })
  }

  copyFile(src: string, destDir: string): Promise<string> {
    return call<string>(STORAGE_COMMANDS.copyFile, { src, destDir })
  }

  moveFile(src: string, dest: string): Promise<string> {
    return call<string>(STORAGE_COMMANDS.moveFile, { src, dest })
  }

  moveFiles(pairs: MovePair[]): Promise<BatchMoveResult> {
    return call<BatchMoveResult>(STORAGE_COMMANDS.moveFiles, { pairs })
  }

  renameDir(oldPath: string, newName: string): Promise<string> {
    return call<string>(STORAGE_COMMANDS.renameDir, { oldPath, newName })
  }

  createDir(path: string): Promise<void> {
    return call<void>(STORAGE_COMMANDS.createDir, { path })
  }

  dirExists(path: string): Promise<boolean> {
    return call<boolean>(STORAGE_COMMANDS.dirExists, { path })
  }

  deleteFile(path: string): Promise<void> {
    return call<void>(STORAGE_COMMANDS.deleteFile, { path })
  }

  writeFileBytes(destDir: string, fileName: string, bytes: Uint8Array): Promise<string> {
    // Tauri invoke 的参数序列化：Uint8Array → JSON 数组（Rust 端收 Vec<u8>）
    return call<string>(STORAGE_COMMANDS.writeFileBytes, { destDir, fileName, bytes: Array.from(bytes) })
  }

  readLayout(spacePath: string): Promise<string> {
    return call<string>(STORAGE_COMMANDS.readLayout, { spacePath })
  }

  writeLayout(spacePath: string, json: string): Promise<void> {
    return call<void>(STORAGE_COMMANDS.writeLayout, { spacePath, json })
  }

  makeThumbnail(src: string, spacePath: string): Promise<ThumbInfo> {
    // ⚠️ 方案 A 后前端无调用点；保留以维持与 Rust 命令一一对应（回退保命符）
    return call<ThumbInfo>(STORAGE_COMMANDS.makeThumbnail, { src, spacePath })
  }

  openWithDefault(path: string): Promise<void> {
    return call<void>(STORAGE_COMMANDS.openWithDefault, { path })
  }

  revealInExplorer(path: string): Promise<void> {
    return call<void>(STORAGE_COMMANDS.revealInExplorer, { path })
  }

  readImageSize(path: string): Promise<ImageSize> {
    return call<ImageSize>(STORAGE_COMMANDS.readImageSize, { path })
  }
}

/** 默认实例：上层直接 import 它即可（测试时可替换为其他实现） */
export const localStorageProvider: StorageProvider = new LocalFolderProvider()
