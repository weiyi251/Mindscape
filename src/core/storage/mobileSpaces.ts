// ============================================================================
// 模块说明（中文）
// 移动端空间目录的解析（2026-09-21 移动端适配 M1 / D3 方案 A 的第一步）。
//
// 背景：Tauri 的文件夹选择器**没有移动端实现**（对话框会报
// 「Folder picker is not implemented on mobile」），且 Android scoped storage
// 不允许 App 自由扫描用户的任意文件夹。按用户裁决（docs/移动端适配计划.md D3），
// 移动端空间统一放在**应用数据目录**下：
//   <dataDir>/Mindscape/spaces/<空间名>
// 进出内容走「导出布局 / 导入空间」的显式链路（与桌面同一套约定）。
//
// 分层：`buildMobileSpaceDir` 是纯函数（给定 dataDir 拼路径，可单测）；
// `resolveMobileSpaceDir` 是薄胶水（依赖注入 dataDir / createDir，node 可单测；
// `defaultMobileSpaceDeps` 才接触 Tauri）。
// ============================================================================

import { dataDir } from '@tauri-apps/api/path'

import { localStorageProvider } from '@/core/storage/LocalFolderProvider'
import { joinPath } from '@/core/utils/paths'

/** 应用数据目录里的空间根（与桌面 capabilities 的 `$DATA/Mindscape/**` 同一 scope） */
export function buildMobileSpaceDir(dataDirPath: string, spaceName: string): string {
  return joinPath(joinPath(dataDirPath, 'Mindscape'), joinPath('spaces', spaceName))
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
  const dir = buildMobileSpaceDir(await deps.dataDir(), spaceName)
  await deps.createDir(dir)
  return dir
}
