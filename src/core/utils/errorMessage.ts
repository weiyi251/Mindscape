// ============================================================================
// 模块说明（中文）
// 错误值归一化：把任意 rejected / thrown 值转成可直接展示的中文消息。
//
// 【为什么单独成文件】
//   `LocalFolderProvider`（存储层）与 `updater`（更新模块）原先**各有一份私有实现**，
//   且两份行为已经漂移 —— 前者先判 `typeof error === 'string'`，后者没有。
//   Rust 命令 / Tauri 插件抛出的往往就是裸字符串（本项目的 Rust 侧统一返回中文消息），
//   少判一个分支就会把「文件已存在」这类正常提示变成 `String(error)` 的兜底噪声。
//   2026-09-14 收拢到此处，统一取**最全**的那版（string → Error → String）。
//
// 纯函数，可单元测试。
// ============================================================================

/**
 * 任意值 → 可展示的消息字符串。
 *
 * 判定顺序（顺序有意义，不可调换）：
 *   1. `string`        —— Rust 命令返回的中文消息、promise 直接 reject 的字符串
 *   2. `Error`         —— 标准错误对象，取 message
 *   3. 其余（对象 / 数字 / null / undefined）—— `String()` 兜底
 *
 * ⚠️ 对实际业务里的错误值（字符串 / Error）本函数不会抛错；
 *    理论边界是「对象自身的 toString 抛错」，那种值不属于真实的 reject 形态，
 *    故不额外加 try/catch 掩盖问题（与迁出前的两份实现行为保持一致）。
 */
export function toErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  return String(error)
}
