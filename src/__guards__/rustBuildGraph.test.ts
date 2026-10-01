// ============================================================================
// 模块说明（中文）
// Rust 构建图守卫：锁住 src-tauri/Cargo.toml 里 indexmap 的 std 收编声明。
//
// 背景（2026-10-01）：schemars 0.8.2x（tauri-build / tauri-plugin 的**构建依赖**传递
// 引入）对 indexmap 1.9.3 用两参写法 `IndexMap<K, V>`，该写法只在 indexmap 的
// `has_std` cfg 下合法。indexmap 的 build.rs 走「探测」路径时（本机环境曾探测失败）
// 不设 has_std，连锁炸 E0107、几十个 crate 一起报错，看着像代码坏了。
// 修法：在 [build-dependencies] 显式声明 indexmap 1.9.3 并启用 std —— build.rs 见到
// CARGO_FEATURE_STD 直接设 has_std（硬路径，不再探测）。
//
// ⚠️ 两个都不能动，动了就复发：
//   1. 必须在 [build-dependencies] 段 —— resolver v2 下构建依赖图与普通依赖图的
//      feature 互不统一，写进 [dependencies] 管不到 schemars（实测无效）；
//   2. 必须带 features = ["std"]。
// 源码级断言（与 spaceListResponsive.test.ts 同思路）：渲染不了构建图，只能锁字面量。
// ============================================================================

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const manifest = readFileSync(join(ROOT, 'src-tauri', 'Cargo.toml'), 'utf8')

/** 抽出某个 TOML 表（到下一个 `[` 段头为止）的正文 */
function section(name: string): string {
  const start = manifest.indexOf(`[${name}]`)
  expect(start, `Cargo.toml 里应存在 [${name}] 段`).toBeGreaterThanOrEqual(0)
  const rest = manifest.slice(start + `[${name}]`.length)
  const next = rest.indexOf('\n[')
  return next === -1 ? rest : rest.slice(0, next)
}

describe('src-tauri 构建图守卫（schemars/indexmap E0107 复发闸门）', () => {
  it('[build-dependencies] 必须显式收编 indexmap 1.9.3 并启用 std（硬路径设 has_std）', () => {
    const buildDeps = section('build-dependencies')
    expect(buildDeps).toMatch(/indexmap\s*=\s*\{\s*version\s*=\s*"1\.9\.3"/)
    expect(buildDeps).toMatch(/features\s*=\s*\[\s*"std"\s*\]/)
  })

  it('该声明不得被挪进 [dependencies]（resolver v2 下普通依赖图管不到构建依赖图）', () => {
    expect(section('dependencies')).not.toMatch(/indexmap/)
  })

  it('不得把 indexmap 升到 2.x 冒充修法（schemars 0.8.2x 的约束解析不到 2.x，会分叉出两个实例）', () => {
    const buildDeps = section('build-dependencies')
    expect(buildDeps).not.toMatch(/indexmap\s*=\s*\{\s*version\s*=\s*"2/)
  })
})
