// ============================================================================
// 模块说明（中文）
// 背景图（壁纸）的存取链路。
//
// 【为什么放 %APPDATA%\Mindscape\appearance\】
//   fs 插件的 scope 白名单是 `$DATA/Mindscape/**`（capabilities/default.json 与
//   mobile.json 同款），放这里读写都不用新增 Rust 命令、不用改能力声明；
//   且目录由软件自管理，用户的空间文件夹保持「只有用户自己的文件」。
//
// 【落盘口径】
//   偏好里只存**文件名**（wallpaper.<原扩展名>），不存绝对路径（用户裁决：
//   资源绝对路径不落盘）—— 目录位置由 getSpacesDir 运行时解析，搬家不失联。
//   换图流程 = 删旧文件 → 写新文件（writeFileBytes 遇重名会自动加 _1，
//   先删就是为了让返回名永远等于我们构造的名字）；删除是清理性质，
//   失败只吞掉（旧文件残留不影响正确性：加载只认偏好里记的名字）。
//
// 【校验】扩展名白名单复用 core/board/imageTypes.ts 的 isImageFile（与卡片
//   同一份图片类型口径）；大小上限 20MB —— 壁纸是整窗铺底，再大只会拖慢
//   解码与显存，不产生额外信息量。
//
// 【读取】plugin-fs 的 readFile（二进制）→ Blob → objectURL；
//   URL 生命周期由 appearanceStore 管理（换图 / 清除时 revoke 旧值）。
// ============================================================================

import { readFile } from '@tauri-apps/plugin-fs'

import { localStorageProvider } from '@/core/storage/LocalFolderProvider'
import { getSpacesDir } from '@/core/storage/spacesFile'
import { getExtension, isImageFile } from '@/core/board/imageTypes'
import { joinPath } from '@/core/utils/paths'

/** 软件目录内的外观资产子目录名 */
export const APPEARANCE_DIR_NAME = 'appearance'
/** 壁纸文件的基础名（扩展名跟用户选的图走） */
export const WALLPAPER_BASE_NAME = 'wallpaper'
/** 壁纸大小上限：20MB */
export const MAX_WALLPAPER_BYTES = 20 * 1024 * 1024

/** 扩展名 → Blob MIME（与 imageTypes 的图片白名单一一对应） */
const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
}

/** %APPDATA%\Mindscape\appearance */
export async function getAppearanceDir(): Promise<string> {
  return joinPath(await getSpacesDir(), APPEARANCE_DIR_NAME)
}

/** 由用户选的文件名推导我们的落盘名：wallpaper.<原扩展名> */
export function wallpaperFileNameFor(pickedName: string): string {
  const ext = getExtension(pickedName)
  if (!isImageFile(pickedName)) {
    throw new Error('背景图只支持 jpg / png / webp / gif / bmp 图片')
  }
  return `${WALLPAPER_BASE_NAME}.${ext}`
}

/**
 * 保存壁纸：删旧（含「重选同名」防 writeFileBytes 加 _1 后缀）→ 写新。
 * 返回落盘文件名（= wallpaperFileNameFor(pickedName)，调用方写进偏好）。
 */
export async function saveWallpaper(
  prevFileName: string | null,
  pickedName: string,
  bytes: Uint8Array,
): Promise<string> {
  if (bytes.byteLength === 0) {
    throw new Error('选中的文件是空的，换个图片试试')
  }
  if (bytes.byteLength > MAX_WALLPAPER_BYTES) {
    throw new Error('图片超过 20MB 上限，压缩后再试')
  }
  const targetName = wallpaperFileNameFor(pickedName)

  const dir = await getAppearanceDir()
  await localStorageProvider.createDir(dir)
  if (prevFileName !== null) {
    await removeWallpaperFile(prevFileName)
  }
  await localStorageProvider.writeFileBytes(dir, targetName, bytes)
  return targetName
}

/** 删除壁纸文件（清理性质：文件不在 / 删不掉都静默——加载只认偏好里记的名字） */
export async function removeWallpaperFile(fileName: string | null): Promise<void> {
  if (fileName === null) return
  try {
    const dir = await getAppearanceDir()
    await localStorageProvider.deleteFile(joinPath(dir, fileName))
  } catch {
    // 残留文件无害；下次保存同名图时也会先删
  }
}

/**
 * 读壁纸 → objectURL（ AppearanceBackground 组件直接当 background-image 用）。
 * 文件不存在 / 读不了 → null（上层回落到无图状态，body 底色兜底）。
 */
export async function loadWallpaperUrl(fileName: string): Promise<string | null> {
  try {
    const dir = await getAppearanceDir()
    const bytes = await readFile(joinPath(dir, fileName))
    const mime = MIME_BY_EXTENSION[getExtension(fileName)] ?? 'image/png'
    return URL.createObjectURL(new Blob([bytes], { type: mime }))
  } catch {
    return null
  }
}
