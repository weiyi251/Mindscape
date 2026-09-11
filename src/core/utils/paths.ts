// ============================================================================
// 模块说明（中文）
// 路径拼接工具。
//
// 为什么前端自己拼：17.5 铁律「所有路径参数接受绝对路径；不做任何隐式路径拼接，
// 拼接逻辑放前端」—— Rust 端只接收完整绝对路径，拼接由这里负责。
//
// 分隔符策略：跟随 base 的写法。Windows 上 dialog 返回的路径带 `\` 就用 `\`，
// 用户手工输入带 `/` 的就用 `/`（Windows 两种都能识别）。
//
// 纯函数，可单元测试。
//
// 实现任务：T1.3（阶段一）。
// ============================================================================

/** base 用的是哪种分隔符 */
function detectSeparator(base: string): string {
  return base.includes('\\') ? '\\' : '/'
}

/** 拼一个相对路径到基准目录后，自动处理重复/缺失的分隔符 */
export function joinPath(base: string, relative: string): string {
  const sep = detectSeparator(base)
  const left = base.replace(/[\\/]+$/, '')
  const right = relative.replace(/^[\\/]+/, '')
  if (left === '') return right
  if (right === '') return left
  // 统一 right 内部的分隔符，避免 `D:\a` + `b/c` 混成两种风格
  return `${left}${sep}${right.split(/[\\/]+/).join(sep)}`
}

/** 取父目录；无分隔符时返回空串 */
export function dirnameOf(target: string): string {
  const normalized = target.replace(/[\\/]+$/, '')
  const index = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'))
  return index > 0 ? normalized.slice(0, index) : ''
}

/** 取最后一段（文件名） */
export function basenameOf(target: string): string {
  const normalized = target.replace(/[\\/]+$/, '')
  const index = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'))
  return normalized.slice(index + 1)
}

/**
 * 把绝对路径归约为相对 base 的路径（layout.json 里只存相对路径，4.2）。
 * Windows 大小写不敏感，比较时忽略大小写；前缀不匹配时原样返回（调用方自行兜底）。
 */
export function relativePathOf(fullPath: string, base: string): string {
  const normalized = fullPath.replace(/\\/g, '/')
  const baseNorm = base.replace(/\\/g, '/').replace(/\/+$/, '')
  if (baseNorm === '' ) return normalized
  const lower = normalized.toLowerCase()
  const lowerBase = baseNorm.toLowerCase()
  if (lower === lowerBase) return ''
  if (!lower.startsWith(`${lowerBase}/`)) return normalized
  return normalized.slice(baseNorm.length + 1)
}
