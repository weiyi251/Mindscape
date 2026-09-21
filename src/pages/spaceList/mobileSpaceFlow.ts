// ============================================================================
// 模块说明（中文）
// 空间列表页「新建 / 导入 / 导出」在移动端的落点决策（2026-09-21 移动端适配 M4，
// 对应 docs/移动端适配计划.md §3 M4「按 D3 方案 A 落地：空间数据目录模型 +
// 导入 / 导出接线」）。
//
// 桌面版让用户挑文件夹（`plugin-dialog` 的 `open({directory:true})`），移动端挑不了：
// Tauri 的文件夹对话框没有移动端实现（调用即报「Folder picker is not implemented on
// mobile」），Android 也不允许 App 扫任意目录。所以这三条路在移动端各自换成：
//   · 新建 → 空间文件夹由**空间名**派生（core/storage/mobileSpaces.ts）；
//   · 导出布局 → 落在 <dataDir>/Mindscape/exports/<空间名>；
//   · 导入空间 → 用系统文件选择器选一个布局**文件**（M4 第一步那条 `<input type=file>`
//     通道，拿到的是字节而不是路径），校验后收进软件目录。
//
// 为什么单独成文件（与 pages/board/ingestFlow.ts 同一手法）：分支判定全是纯逻辑，
// 抽出来加依赖注入就能在 node 环境（不引 jsdom，用户裁决）逐条钉住；
// SpaceList.tsx 只留胶水与 JSX。
//
// 铁律①（不动用户文件）：移动端导出的落点在我们自己的数据目录里，
// 导入也不删用户选中的那份文件（字节是复制进来的，原件天然无损）。
// ============================================================================

import { EXPORTED_LAYOUT_FILE } from '@/core/storage/appLayoutStore'
import { parseLayout } from '@/core/types'
import type { PickedFile } from '@/pages/board/ingestFlow'

/** 移动端「导入空间」的选择器过滤：只要布局文件（JSON） */
export const LAYOUT_FILE_ACCEPT = 'application/json,.json'

/** 中文文案常量表（本项目约定：用户可见文案不散落在 JSX 里） */
export const SPACE_FLOW_TEXT = {
  subtitleDesktop: '把文件夹变成思考空间 · 空间记录存于 %APPDATA%\\Mindscape\\spaces.json',
  subtitleMobile: '把文件夹变成思考空间 · 空间与布局都存放在应用数据目录里',
  folderHintDesktop:
    '可以直接选已有文件夹；布局存在软件目录里，不会往这个文件夹里写任何文件',
  folderHintMobile: (spaceName: string): string =>
    '移动端不能挑文件夹：空间会自动建在应用数据目录的 Mindscape/spaces/' +
    `${spaceName === '' ? '<空间名>' : spaceName} 下`,
  emptyHintDesktop: '点右上角的 ＋ 按钮新建空间，选一个已有文件夹即可开始',
  emptyHintMobile: '点右上角的 ＋ 按钮新建空间，文件夹由软件自动建好即可开始',
  needFolder: '请选择空间文件夹',
  needNameForFolder: '先填空间名称——移动端的空间文件夹按名字创建',
  importLayoutTitle: `导入空间（选一个 ${EXPORTED_LAYOUT_FILE} 文件）`,
  importLayoutLabel: '导入空间',
  noFilePicked: '没有读到选中的文件',
  notALayout: (fileName: string): string =>
    `「${fileName}」不是合法的布局文件（它由「导出布局」生成），已忽略`,
  /** 建空间之后才发现内容不合法（桌面与移动端同一句；两条导入路共用） */
  importedInvalid: `「${EXPORTED_LAYOUT_FILE}」不是合法的布局文件，已忽略。空间已经建好，画布会重新铺开。`,
  exportedDesktop: (path: string): string =>
    `布局已导出：\n${path}\n\n` +
    '把生成的文件（或整个文件夹）给到别人，对方用「导入空间」选中它即可还原摆放与连线。',
  exportedMobile: (path: string): string =>
    `布局已导出到应用数据目录：\n${path}\n\n` +
    '移动端挑不了导出位置；换设备时用「导入空间」选中这个文件即可还原摆放与连线。',
} as const

/** 新建空间时确定落盘文件夹所需的依赖（生产由 SpaceList 注入真实实现） */
export interface SpaceFolderDeps {
  /** 平台能力 folderPicker：桌面 true，移动端 false */
  canPickFolder: boolean
  /** 移动端：按空间名派生并创建应用数据目录里的空间文件夹 */
  resolveMobileDir: (spaceName: string) => Promise<string>
}

export type SpaceFolderResult = { ok: true; folderPath: string } | { ok: false; error: string }

/**
 * 「新建空间」提交时决定 folderPath 的落点。
 * 桌面沿用「没选文件夹就报错」；移动端反过来——文件夹按名字派生，所以**名字**是前提。
 * 错误以中文字符串返回，由调用方显示在弹窗里（与 formError 同一条路）。
 */
export async function planSpaceFolder(
  deps: SpaceFolderDeps,
  spaceName: string,
  pickedFolderPath: string,
): Promise<SpaceFolderResult> {
  if (deps.canPickFolder) {
    return pickedFolderPath.trim() === ''
      ? { ok: false, error: SPACE_FLOW_TEXT.needFolder }
      : { ok: true, folderPath: pickedFolderPath }
  }
  const name = spaceName.trim()
  if (name === '') return { ok: false, error: SPACE_FLOW_TEXT.needNameForFolder }
  return { ok: true, folderPath: await deps.resolveMobileDir(name) }
}

export interface ExportTargetDeps {
  canPickFolder: boolean
  /** 桌面：弹文件夹对话框，用户取消时返回 null */
  pickDir: () => Promise<string | null>
  /** 移动端：应用数据目录下的导出落点（幂等创建） */
  resolveMobileExportDir: (spaceName: string) => Promise<string>
}

/** 「导出布局」的目标目录；返回 null 表示用户取消（移动端不存在取消这一步） */
export async function planExportTarget(
  deps: ExportTargetDeps,
  spaceName: string,
): Promise<string | null> {
  if (deps.canPickFolder) return await deps.pickDir()
  return await deps.resolveMobileExportDir(spaceName)
}

export interface LayoutFileDeps {
  /** 读选择器里那个文件的内容字节（SAF 只给内容，不给可重放的路径） */
  readBytes: (file: PickedFile) => Promise<Uint8Array>
}

export type LayoutFileResult =
  | { ok: true; bytes: Uint8Array; suggestedName: string }
  | { ok: false; error: string }

/**
 * 移动端「导入空间」的第一步：读入选中的布局文件并当场校验。
 * 校验放在建空间**之前**，与桌面 `exportedLayoutExists` 同一用意——
 * 别让一个建了一半的空空间躺在列表里。
 */
export async function readLayoutFileForImport(
  deps: LayoutFileDeps,
  file: PickedFile | undefined,
): Promise<LayoutFileResult> {
  if (!file) return { ok: false, error: SPACE_FLOW_TEXT.noFilePicked }

  const bytes = await deps.readBytes(file)
  if (!parseLayout(new TextDecoder().decode(bytes)).ok) {
    return { ok: false, error: SPACE_FLOW_TEXT.notALayout(file.name) }
  }
  return { ok: true, bytes, suggestedName: suggestedSpaceNameOf(file.name) }
}

/**
 * 选中的文件名 → 建议的空间名（预填到弹窗，用户可改）。
 * 直接导出的那份文件人人都叫 `mindscape-layout.json`，拿它当空间名毫无辨识度，
 * 所以换成一个可读的默认名。
 */
export function suggestedSpaceNameOf(fileName: string): string {
  const stem = fileName.replace(/\.json$/i, '').trim()
  if (stem === '' || stem === EXPORTED_LAYOUT_FILE.replace(/\.json$/i, '')) return '导入的空间'
  return stem
}
