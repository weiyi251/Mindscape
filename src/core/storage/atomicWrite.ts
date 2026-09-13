// ============================================================================
// 模块说明（中文）
// 文本文件的**原子写入**：先写同目录的 `<目标>.tmp`，再 rename 覆盖目标。
//
// 【为什么要原子写（17.6）】
//   直接 writeTextFile 到目标文件，若写到一半进程被杀 / 断电，用户拿到的就是
//   半截 JSON —— 解析必然失败，等于数据损坏。先写临时文件再 rename，则
//   「目标文件」要么是完整的旧内容、要么是完整的新内容，不存在中间态。
//   rename 在同一目录内是原子替换（Windows 上 Tauri 的 rename 走 std::fs::rename）。
//
// 【为什么单独成文件（2026-09-14）】
//   同一段「tmp + rename」原先在 spacesFile.ts 与 appLayoutStore.ts 各写了一遍，
//   本模块把它收成唯一实现；将来 plugins.json（插件启用状态）等应用级元数据
//   直接复用，不必再抄第三遍。
//
// ⚠️ 本模块不做 `assertDesktopRuntime()`：在非桌面环境调用是调用方的接线错误，
//    由各上层网关在入口处统一拦截并给出中文提示（与 spacesFile / appLayoutStore 一致）。
// ⚠️ 不负责创建父目录：目标目录必须已存在（上层的 createDir 幂等创建在先）。
// ============================================================================

import { rename, writeTextFile } from '@tauri-apps/plugin-fs'

/**
 * 原子写文本到 `path`。
 *
 * @param path 目标文件的**绝对路径**
 * @param text 要写入的完整文本（调用方负责序列化，通常已含末尾换行）
 *
 * 失败语义：写 `.tmp` 失败或 rename 失败都会向上抛（原样抛出插件错误），
 * 调用方据此提示用户。`.tmp` 残留不致命 —— 下次写入会覆盖它。
 */
export async function atomicWriteTextFile(path: string, text: string): Promise<void> {
  const tmpPath = `${path}.tmp`
  await writeTextFile(tmpPath, text)
  await rename(tmpPath, path)
}
