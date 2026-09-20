// ============================================================================
// 模块说明（中文）
// 「磁盘有文件夹、画布没有框」提示条的文案与拼接（A2，2026-09-20 用户计划第 2 步）。
//
// 为什么与组件分文件：本文件的导出全是常量与纯函数（无组件），
// 组件文件（unframed-folders-bar.tsx）因此只导出组件 —— 满足 lint 的
// react-refresh/only-export-components（否则每次改文案都会让画布整页热更新失效）。
// ============================================================================

/** 用户可见文案常量表（集中一处便于校对） */
export const UNFRAMED_FOLDERS_TEXT = {
  /** 提示条前缀 */
  lead: (count: number) => `这个空间有 ${count} 个文件夹还没有分区框：`,
  /** 名字折叠后缀 */
  more: (rest: number) => ` 等 ${rest} 个`,
  /** 一键补框按钮 */
  generate: '一键生成分区框',
  /** 补框进行中 */
  generating: '生成中…',
  /** 本次不补 */
  dismiss: '暂不生成',
} as const

/** 提示条里最多列出几个文件夹名，其余折叠为「等 N 个」 */
export const UNFRAMED_NAME_LIMIT = 3

/** 文件夹名列表 → 一行可读文案（纯函数，便于单测） */
export function unframedNamesLabel(names: readonly string[]): string {
  const head = names.slice(0, UNFRAMED_NAME_LIMIT).join('、')
  const rest = names.length - UNFRAMED_NAME_LIMIT
  return rest > 0 ? `${head}${UNFRAMED_FOLDERS_TEXT.more(rest)}` : head
}
