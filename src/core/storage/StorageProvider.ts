// ============================================================================
// 模块说明（中文）
// 存储层接口抽象。对应开发计划书第十三章「准备 6：存储层接口抽象」。
//
// 上层业务（画布、卡片、分区框、命令系统）只依赖本接口，不直接调用 Tauri invoke。
// 将来接入云盘 / 服务器时，只需新增一个实现（如 CloudProvider），上层代码一行不改。
//
// 接口方法与 17.5「Rust 侧命令清单」对应（copy_image_with_thumbnail 已随方案 A 移除），
// 对应关系由 LocalFolderProvider.ts 的 STORAGE_COMMANDS 表显式列出，并有单元测试守护。
//
// 约定：
//   · 所有路径均为绝对路径（本层不做隐式路径拼接，拼接逻辑在上层）
//   · 所有方法失败时抛出 StorageError，其 message 即 Rust 返回的中文消息，可直接展示
// ============================================================================

/** 目录项，对应 Rust 的 commands::fs_ops::DirEntry（camelCase 序列化） */
export interface DirEntry {
  /** 文件名（不含目录部分） */
  name: string
  /** 完整路径 */
  path: string
  /** 是否为目录 */
  isDir: boolean
  /** 字节大小；目录恒为 0 */
  size: number
  /** 最后修改时间（Unix 毫秒）；取不到时为 null */
  modifiedAt: number | null
}

/** 一次移动请求（源路径 → 目标完整路径） */
export interface MovePair {
  from: string
  to: string
}

/** 批量移动结果：成功清单 + 失败清单 */
export interface BatchMoveResult {
  /** 成功写入的目标路径 */
  succeeded: string[]
  /** 失败项及原因（中文，可直接展示） */
  failed: { path: string; reason: string }[]
}

/** 缩略图信息（make_thumbnail 的返回值；方案 A 下该命令保留但前端不再调用） */
export interface ThumbInfo {
  path: string
  width: number
  height: number
}

/** 图片原始尺寸 */
export interface ImageSize {
  width: number
  height: number
}

/**
 * 布局文件损坏时的错误消息前缀。
 * ⚠️ 必须与 Rust 侧 src-tauri/src/commands/layout.rs 的 LAYOUT_CORRUPT_MARKER 保持一致。
 */
export const LAYOUT_CORRUPT_MARKER = '布局文件损坏'

/** 存储层统一错误类型：message 为可直接展示给用户的中文消息 */
export class StorageError extends Error {
  /** 原始错误对象（Tauri 抛出的通常是字符串） */
  readonly cause: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'StorageError'
    this.cause = cause
  }

  /**
   * 是否为「layout.json 损坏已恢复」这一类错误。
   * 上层收到时应当：展示 message → 改用空布局继续 → **不要立刻回写磁盘**。
   */
  get isLayoutCorrupt(): boolean {
    return this.message.startsWith(LAYOUT_CORRUPT_MARKER)
  }
}

/**
 * 存储层接口。
 * 方法顺序与 17.5 的命令清单一致，便于人工核对。
 */
export interface StorageProvider {
  // ---- fs_ops.rs · 文件与目录 ----
  /** 列出目录内容（一层，不递归）。跳过以 . 开头的目录，单个失败项跳过不中断 */
  listDir(path: string): Promise<DirEntry[]>
  /** 复制文件；目标已存在则自动重命名为 xxx_1。返回实际写入的完整路径 */
  copyFile(src: string, destDir: string): Promise<string>
  /** 移动文件（移除到 _已移除、以及恢复，都用它）。自动创建目标目录，重名自动加后缀 */
  moveFile(src: string, dest: string): Promise<string>
  /** 批量移动；返回成功与失败清单 */
  moveFiles(pairs: MovePair[]): Promise<BatchMoveResult>
  /** 重命名文件夹（分区框改名用）。非法字符与冲突校验由上层完成，本层只执行 */
  renameDir(oldPath: string, newName: string): Promise<string>
  /** 创建目录（含多级父目录）；已存在时视为成功 */
  createDir(path: string): Promise<void>
  /** 检测目录是否存在。无权限等真实错误会抛出，不静默当作「不存在」 */
  dirExists(path: string): Promise<boolean>

  // ---- fs_ops.rs · T3.6 / T3.8 拖入粘贴辅助（17.5 清单外新增，先例同 rename_dir）----
  /** 删除单个文件（addCards 命令撤销时清理本次创建的副本）。不存在视为成功；目录会报错 */
  deleteFile(path: string): Promise<void>
  /** 写入二进制数据到目标目录（T3.8 粘贴截图落盘）。重名自动加 _1；返回实际写入的完整路径 */
  writeFileBytes(destDir: string, fileName: string, bytes: Uint8Array): Promise<string>

  // ---- fs_ops.rs · 插件期新增（卸载外部插件要递归删目录）----
  /**
   * 递归删除整个目录。**命令清单里唯一的递归删除**，Rust 侧有严格边界校验
   * （空路径 / 盘符根 / 末段 `..` 一律拒绝；不是目录一律拒绝；不存在视为成功）。
   * ⚠️ 破坏性操作：调用方必须先经用户确认。
   */
  deleteDir(path: string): Promise<void>

  // ---- layout.rs · 布局文件 ----
  /**
   * 读取 layout.json 的**原始 JSON 字符串**（不做结构解析，结构校验由 core/types.ts 的 zod 负责）。
   * 文件不存在 → 返回默认空结构，不报错。
   * 文件损坏 → 抛出 StorageError（isLayoutCorrupt === true），原文件保持不动、已备份为 .bak。
   */
  readLayout(spacePath: string): Promise<string>
  /** 原子写入 layout.json（先写 .tmp 再 rename） */
  writeLayout(spacePath: string, json: string): Promise<void>

  // ---- thumbnail.rs · 缩略图 ----
  /**
   * ⚠️ 方案 A（2026-09-12 用户裁决：空间文件夹内不再生成缩略图）后前端不再调用。
   * 方法保留以维持「接口 ↔ Rust 命令」一一对应，回退时无需改接口。
   */
  makeThumbnail(src: string, spacePath: string): Promise<ThumbInfo>

  // ---- system.rs · 系统集成 ----
  /** 用系统默认程序打开文件 */
  openWithDefault(path: string): Promise<void>
  /** 降级方案：在资源管理器中定位并选中文件 */
  revealInExplorer(path: string): Promise<void>
  /** 读取图片原始尺寸（用于卡片初始宽高比） */
  readImageSize(path: string): Promise<ImageSize>
}
