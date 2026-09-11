// ============================================================================
// 模块说明（中文）
// 本地文件的显示通道。对应 17.10：启用 Tauri assetProtocol，通过
//   http://asset.localhost/<encodeURIComponent(绝对路径)>
// 让 WebView 直接读取硬盘上的图片（缩略图与原图），不需要经过 base64 或 blob。
//
// 【为什么需要这一层】
//   · Tauri 的 convertFileSrc 在非 Tauri 环境（浏览器 / 单元测试 / vite preview）
//     会直接抛错，调用点若不加保护会让整张画布渲染失败。
//   · 统一在这里做兜底：拿不到 URL 就返回空串，由渲染层退回占位样式。
//
// 【安全边界（17.10）】
//   可访问范围由 src-tauri/tauri.conf.json 的 security.assetProtocol.scope 决定，
//   前端无法绕过。本模块只负责把绝对路径转成 URL。
//
// 依赖：@tauri-apps/api/core（10.1 技术栈内的官方包）。
// 实现任务：T1.4（阶段一）。
// ============================================================================

import { convertFileSrc } from '@tauri-apps/api/core'

/**
 * 绝对路径 → WebView 可用的资源 URL。
 *
 * @param absolutePath 硬盘上的绝对路径（缩略图或原图）
 * @returns 可放进 <img src> 的 URL；路径为空或当前不在 Tauri 环境时返回空串
 */
export function toAssetUrl(absolutePath: string): string {
  if (!absolutePath) return ''
  try {
    return convertFileSrc(absolutePath)
  } catch {
    // 浏览器 / 单元测试环境：没有 Tauri 运行时，静默降级为「无图」
    return ''
  }
}
