// ============================================================================
// 模块说明（中文）
// 插件清单（manifest.json）的校验层。对应方案 §2.2「清单契约」。
//
// 为什么必须有这一层：外部插件的 manifest.json 是**不可信输入**——
// 用户可能手改、复制粘贴出错、或者它本来就是给别的工具用的。
// 所有从磁盘读入的清单必须先过 zod 校验，否则脏数据会直接流进插件列表与
// 动态 import 的路径拼接里（尤其是 main 字段，路径穿越的入口）。
//
// 安全边界（与 17.5「Rust 层只做安全执行」同一思路，这里是前端侧的最后一道）：
//   · id 必须是反向域名风格小写串 —— 它会被用作安装目录名
//   · main 必须是**纯文件名**（不允许含 `\` `/`，不允许 `..`），杜绝路径穿越
//
// 纯函数（不读文件、不碰 Tauri），node 环境可直接单测。
// ============================================================================

import { z } from 'zod'

import type { ParseResult } from '@/core/types'

/** 插件 id 的合法形状：小写字母/数字/连字符，至少两段，点分隔 */
export const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/

/** 入口文件名的合法形状：纯文件名 + .js / .mjs（不含任何路径分隔符） */
export const PLUGIN_MAIN_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]*\.m?js$/

/** 清单 schema（方案 §2.2） */
export const zPluginManifestSchema = z.object({
  id: z
    .string()
    .regex(PLUGIN_ID_PATTERN, '插件 id 必须是小写反向域名风格（如 com.example.hello）'),
  name: z.string().min(1, '插件名称不能为空'),
  version: z.string().min(1, '版本号不能为空'),
  description: z.string().default(''),
  author: z.string().default(''),
  /** 入口文件名（相对插件目录），默认 index.js */
  main: z
    .string()
    .regex(PLUGIN_MAIN_PATTERN, '入口必须是插件目录下的 .js / .mjs 文件名（不能含路径分隔符）')
    .default('index.js'),
})

export type PluginManifest = z.infer<typeof zPluginManifestSchema>

/** 是否形如合法的插件 id（UI 侧预校验用，避免用户白等一次读盘） */
export function isValidPluginId(id: string): boolean {
  return PLUGIN_ID_PATTERN.test(id)
}

function describeIssue(issue: z.ZodIssue): string {
  const path = issue.path.length > 0 ? issue.path.join('.') : '(根)'
  return `${path}: ${issue.message}`
}

/**
 * 解析并校验 manifest.json 的文本内容。
 * @returns 成功给出规范化后的清单（缺省字段已补全）；失败给出中文原因
 */
export function parseManifest(text: string): ParseResult<PluginManifest> {
  if (text.trim() === '') {
    return { ok: false, error: '清单文件为空' }
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { ok: false, error: `清单 JSON 解析失败：${(error as Error).message}` }
  }

  const result = zPluginManifestSchema.safeParse(raw)
  if (!result.success) {
    return { ok: false, error: `清单校验失败：${result.error.issues.map(describeIssue).join('；')}` }
  }
  return { ok: true, data: result.data }
}

/** 把清单序列化为写入磁盘的文本（两空格缩进 + 末尾换行，便于人工查看） */
export function serializeManifest(manifest: PluginManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}
