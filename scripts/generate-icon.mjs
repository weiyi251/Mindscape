#!/usr/bin/env node
/**
 * Mindscape 应用图标生成器（2026-09-12 改版：改为从用户提供的位图源生成）。
 *
 *   pnpm icon
 *
 * 流程：
 *   1. 以 `src-tauri/icons/app-icon.jpg`（1080×1080，蓝橙无限符号）为源，
 *      调用 Tauri CLI 的 icon 命令派生全部桌面端图标
 *      （32x32 / 64x64 / 128x128 / 128x128@2x / icon.png / icon.ico / icon.icns /
 *        StoreLogo 与 Square*.png）。
 *      Tauri 内部按目标尺寸等比缩放，比例恒定、无拉伸变形。
 *   2. 清理与桌面端无关的 android / ios 产物（保持仓库只含桌面端图标）。
 *   3. 由 128×128 派生图生成 `public/favicon.svg`（浏览器标签页图标）——
 *      2026-09-19 补：改版时曾漏掉这一步，favicon 停留在更早版本的苔绿旧图。
 *   4. 触碰 Rust 入口文件，强制下一次 cargo 构建重链接 exe。
 *      原因：tauri-build 重跑后若构建输出内容不变，cargo 认为 bin 指纹仍新鲜，
 *      不会用新 resource.lib 重链接 —— 图标就「换了但没完全换」（2026-09-12 实测坑）。
 *
 * 更换图标：替换 `src-tauri/icons/app-icon.jpg` 后重跑 `pnpm icon` 即可。
 */

import { execSync } from 'node:child_process'
import { rmSync, existsSync, utimesSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ICONS_DIR = path.join(ROOT, 'src-tauri', 'icons')
const SOURCE = path.join(ICONS_DIR, 'app-icon.jpg')

if (!existsSync(SOURCE)) {
  console.error(`图标源文件不存在：${SOURCE}`)
  process.exit(1)
}

// 1) Tauri CLI 派生各平台图标（离线，@tauri-apps/cli 本地已装）
execSync(`pnpm exec tauri icon "${SOURCE}" --output "src-tauri/icons"`, {
  cwd: ROOT,
  stdio: 'inherit',
})

// 2) 清理移动端产物（桌面应用用不到）
for (const dir of ['android', 'ios']) {
  const target = path.join(ICONS_DIR, dir)
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true })
    console.log(`已清理移动端产物：${dir}/`)
  }
}

// 3) 由 128×128 派生图生成浏览器 favicon（base64 嵌入的 SVG 包装，
//    保持 index.html 现有的 type="image/svg+xml" 引用不变）
const faviconPng = readFileSync(path.join(ICONS_DIR, '128x128.png'))
const faviconSvg = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">',
  `<image width="128" height="128" href="data:image/png;base64,${faviconPng.toString('base64')}"/>`,
  '</svg>',
  '',
].join('\n')
writeFileSync(path.join(ROOT, 'public', 'favicon.svg'), faviconSvg)
console.log('已生成 public/favicon.svg（与应用图标同源）')

// 4) 触碰 Rust 入口文件，强制下一次 cargo 构建重链接 exe。
//    原因：tauri-build 重跑后若构建输出内容不变，cargo 认为 bin 指纹仍新鲜，
//    不会用新 resource.lib 重链接 —— 图标就「换了但没完全换」（2026-09-12 实测坑）。
utimesSync(path.join(ROOT, 'src-tauri', 'src', 'main.rs'), new Date(), new Date())

console.log('图标生成完成。')
