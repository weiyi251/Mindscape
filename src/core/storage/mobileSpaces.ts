// ============================================================================
// 模块说明（中文）
// 移动端空间目录的解析（2026-09-21 移动端适配 M1 / D3 方案 A 的第一步）。
//
// 背景：Tauri 的文件夹选择器**没有移动端实现**（对话框会报
// 「Folder picker is not implemented on mobile」），且 Android scoped storage
// 不允许 App 自由扫描用户的任意文件夹。按用户裁决（docs/移动端适配计划.md D3），
// 移动端空间统一放在**应用数据目录**下：
//   <dataDir>/Mindscape/spaces/<空间名>          空间本体（用户文件）
//   <dataDir>/Mindscape/exports/<空间名>         「导出布局」的落点
// 进出内容走「导出布局 / 导入空间」的显式链路（与桌面同一套约定）。
//
// ⚠️ 空间名是用户随便起的，可以含 `/`、`:`、`..`。这些字符一旦进路径就会
// 越出 spaces 根目录（fs scope 挡不住越界后的拼接结果），所以**所有**由空间名
// 派生的目录都过 `spaceDirName()` 洗一遍（见下）。
//
// 分层：`spaceDirName` / `buildMobileSpaceDir` / `buildMobileExportDir` 是纯函数
// （给定 dataDir 拼路径，可单测）；`resolveMobileSpaceDir` / `resolveMobileExportDir`
// 是薄胶水（依赖注入 dataDir / createDir，node 可单测；`defaultMobileSpaceDeps`
// 才接触 Tauri）。
// ============================================================================

import { dataDir } from '@tauri-apps/api/path'

import { localStorageProvider } from '@/core/storage/LocalFolderProvider'
import { joinPath } from '@/core/utils/paths'

/** 空间名直接进目录名时的兜底（全被洗空的极端情况） */
export const UNNAMED_SPACE_DIR_NAME = '未命名空间'

/**
 * 空间名 → 目录名。安全底线是「一个空间名只对应一个目录段」：
 *   · 路径分隔符（`\ /`）→ `_`。段内残留的点（`../../etc` → `_.._etc`）没有
 *     分隔符就下不了目录，所以不去糟蹋 `v1.0` 这类正常名字；
 *   · 各平台非法文件名字符（`<>:"|?*`）→ 直接删（Windows 上这些做目录名会报错）；
 *   · 前导 / 尾随的 `.` 与空白洗掉（`..`、`.git`），纯点号的名字退回 `未命名空间`。
 * 长度截到 60（Android 单段目录名上限 255，留足余量）。
 */
export function spaceDirName(spaceName: string): string {
  const cleaned = spaceName
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '')
    .replace(/[\\/]/g, '_')
    .replace(/[<>:"|?*]/g, '')
    .trim()
    .slice(0, 60)
  return cleaned === '' ? UNNAMED_SPACE_DIR_NAME : cleaned
}

/** 应用数据目录里的空间根（与桌面 capabilities 的 `$DATA/Mindscape/**` 同一 scope） */
export function buildMobileSpaceDir(dataDirPath: string, spaceName: string): string {
  return mobileSubDir(dataDirPath, 'spaces', spaceName)
}

/** 「导出布局」在移动端的落点目录（没有文件夹选择器，只能落在自己的数据目录里） */
export function buildMobileExportDir(dataDirPath: string, spaceName: string): string {
  return mobileSubDir(dataDirPath, 'exports', spaceName)
}

function mobileSubDir(dataDirPath: string, kind: string, spaceName: string): string {
  return joinPath(joinPath(dataDirPath, 'Mindscape'), joinPath(kind, spaceDirName(spaceName)))
}

/** 解析空间目录所需的依赖（node 单测注入假件；生产用 defaultMobileSpaceDeps） */
export interface MobileSpaceDeps {
  dataDir: () => Promise<string>
  createDir: (path: string) => Promise<void>
}

/** 生产依赖：Tauri dataDir + 幂等创建（create_dir 已存在不算错） */
export function defaultMobileSpaceDeps(): MobileSpaceDeps {
  return {
    dataDir,
    createDir: (path) => localStorageProvider.createDir(path),
  }
}

/**
 * 解析移动端新建空间的落盘目录，并幂等创建它（NewSpace 流程要求文件夹已存在）。
 */
export async function resolveMobileSpaceDir(
  spaceName: string,
  deps: MobileSpaceDeps = defaultMobileSpaceDeps(),
): Promise<string> {
  return createMobileDir(buildMobileSpaceDir, spaceName, deps)
}

/** 解析移动端「导出布局」的目标目录，同样幂等创建 */
export async function resolveMobileExportDir(
  spaceName: string,
  deps: MobileSpaceDeps = defaultMobileSpaceDeps(),
): Promise<string> {
  return createMobileDir(buildMobileExportDir, spaceName, deps)
}

async function createMobileDir(
  build: (dataDirPath: string, spaceName: string) => string,
  spaceName: string,
  deps: MobileSpaceDeps,
): Promise<string> {
  const dir = build(await deps.dataDir(), spaceName)
  await deps.createDir(dir)
  return dir
}
