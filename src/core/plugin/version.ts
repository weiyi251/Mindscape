// ============================================================================
// 模块说明（中文）
// 零依赖的语义化版本比较（方案 §5「校验」与设置页「更新」都要用）。
//
// 为什么自己写：10.1 技术栈清单里没有 semver 之类的库，而这里只需要
// 「比较大小」和「是否更新」两件事，几十行足够；为一个比较函数引入依赖不划算。
//
// 支持的范围（够用即可，不做完整 semver 实现）：
//   · 可选的 `v` 前缀：v1.2.3
//   · 主版本 / 次版本 / 修订号，多数段可省略（1 / 1.2 / 1.2.3）
//   · 预发布标识：1.2.0-beta.2（预发布 < 正式版）
//   · 构建元数据：1.2.3+build.7（忽略，不参与比较）
//
// 纯函数，可直接单测。
// ============================================================================

export interface ParsedVersion {
  /** [主, 次, 修订]，缺省段补 0 */
  numbers: [number, number, number]
  /** 预发布标识段（`beta.2` → ['beta','2']）；空数组表示正式版 */
  prerelease: string[]
}

const VERSION_PATTERN =
  /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/**
 * 解析版本号。
 * @returns 解析结果；不合法（空串 / 含非法字符）时返回 null
 */
export function parseVersion(input: string): ParsedVersion | null {
  const matched = VERSION_PATTERN.exec(input.trim())
  if (!matched) return null

  return {
    numbers: [Number(matched[1]), Number(matched[2] ?? 0), Number(matched[3] ?? 0)],
    prerelease: matched[4] ? matched[4].split('.') : [],
  }
}

/** 预发布段比较：完全遵循 semver 的「数字标识符 < 字母标识符、段数少者更小」 */
function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) return 0
  // 有预发布标识的版本**小于**同号正式版
  if (left.length === 0) return 1
  if (right.length === 0) return -1

  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const a = left[index]
    const b = right[index]
    if (a === undefined) return -1
    if (b === undefined) return 1

    const aNumber = /^\d+$/.test(a) ? Number(a) : null
    const bNumber = /^\d+$/.test(b) ? Number(b) : null

    if (aNumber !== null && bNumber !== null) {
      if (aNumber !== bNumber) return aNumber < bNumber ? -1 : 1
      continue
    }
    if (aNumber !== null) return -1
    if (bNumber !== null) return 1
    if (a !== b) return a < b ? -1 : 1
  }
  return 0
}

/**
 * 比较两个版本号。
 * @returns `a < b` → -1；相等 → 0；`a > b` → 1
 *
 * 任一版本号不合法时返回 0（视为「无法比较、不更新」）——
 * 这样调用方不必到处写 try/catch，且「不合法」不会导致误报有更新。
 */
export function compareVersion(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) return 0

  for (let index = 0; index < 3; index += 1) {
    if (left.numbers[index] !== right.numbers[index]) {
      return left.numbers[index] < right.numbers[index] ? -1 : 1
    }
  }
  return comparePrerelease(left.prerelease, right.prerelease)
}

/** `candidate` 是否比 `current` 新（设置页「有可用更新」判定） */
export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersion(candidate, current) > 0
}
