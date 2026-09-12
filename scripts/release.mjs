// ============================================================================
// 模块说明（中文）
// 发版构建 + 更新清单生成。
//
// 自动更新需要两样东西同时正确，缺一不可：
//   ① 安装包旁的 .sig 签名文件（由 bundle.createUpdaterArtifacts 生成，签名私钥参与）
//   ② 仓库 Release 上托管的 latest.json（version / url / signature 三件套）
// 这一步很容易手工拼错（.sig 里必须是签名文本本身，不是路径），所以固化成脚本。
//
// 用法：
//   pnpm release                  签名构建（产出 NSIS / MSI 与各自的 .sig），并生成 latest.json
//   pnpm release --manifest-only  不构建，仅用已有产物重新生成 latest.json
//
// 签名私钥查找顺序：
//   1. TAURI_SIGNING_PRIVATE_KEY（密钥内容本身，CI 用）
//   2. TAURI_SIGNING_PRIVATE_KEY_PATH（密钥文件路径，仅本脚本认识）
//   3. 默认 ~/.tauri/mindscape.key
// ⚠️ 实测：@tauri-apps/cli 2.x **不认** TAURI_SIGNING_PRIVATE_KEY_PATH —— 只传路径会报
//    「A public key has been found, but no private key」。所以这里统一读成内容再注入。
// ⚠️ 私钥**绝不能进仓库**；生成命令见 CONTRIBUTING.md。
//
// 生成后的发布步骤：
//   把 latest.json 与安装包一起上传到 GitHub Release（tag 必须是 v 开头的版本号），
//   endpoints 指向 .../releases/latest/download/latest.json，客户端即可发现新版本。
// ============================================================================

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_PATH = path.join(ROOT, 'src-tauri', 'tauri.conf.json')
const BUNDLE_DIR = path.join(ROOT, 'src-tauri', 'target', 'release', 'bundle')
const TAURI_CLI = path.join(ROOT, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')
const DEFAULT_KEY_PATH = path.join(os.homedir(), '.tauri', 'mindscape.key')

/** 默认仓库；CI 里由 GITHUB_REPOSITORY 覆盖 */
const DEFAULT_REPO = 'weiyi251/Mindscape'

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
const version = config.version
const productName = config.productName

/**
 * 从 CHANGELOG.md 里抽出该版本的说明，作为更新弹窗里的 notes。
 * 抽不到就返回空串 —— 这只是锦上添花，不该让发版失败。
 */
function changelogNotes(target) {
  try {
    const lines = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8').split(/\r?\n/)
    const start = lines.findIndex((line) => line.startsWith(`## [${target}]`))
    if (start === -1) return ''
    const rest = lines.slice(start + 1)
    const end = rest.findIndex((line) => line.startsWith('## '))
    return rest.slice(0, end === -1 ? rest.length : end).join('\n').trim()
  } catch {
    return ''
  }
}

/** 找到 NSIS 安装包与它旁边的 .sig（Windows 上优先用 NSIS：installMode passive 支持最完整） */
function findUpdaterArtifact() {
  const nsisDir = path.join(BUNDLE_DIR, 'nsis')
  if (!fs.existsSync(nsisDir)) {
    throw new Error(`未找到打包目录 ${nsisDir}，请先执行一次不带 --manifest-only 的构建。`)
  }

  // ⚠️ 必须按版本号**精确匹配**：bundle 目录会累积历次构建的安装包，
  //    只按后缀取第一个会拿到旧版本的包与旧签名，生成的清单就指向了错误的安装包。
  const expected = `${productName}_${version}_x64-setup.exe`
  const names = fs.readdirSync(nsisDir)
  const setupFile = names.find((name) => name === expected)
  if (!setupFile) {
    throw new Error(
      `${nsisDir} 下没有本次版本（${version}）的安装包 ${expected}，打包可能未完成或版本号未同步。\n` +
        `目录里现有的文件：${names.join('、')}`,
    )
  }

  const sigPath = path.join(nsisDir, `${setupFile}.sig`)
  if (!fs.existsSync(sigPath)) {
    throw new Error(
      `缺少签名文件 ${path.basename(sigPath)}。\n` +
        '请确认 tauri.conf.json 的 bundle.createUpdaterArtifacts 为 true，' +
        '且构建时提供了签名私钥（TAURI_SIGNING_PRIVATE_KEY 或其路径）。',
    )
  }

  return { fileName: setupFile, signature: fs.readFileSync(sigPath, 'utf8').trim() }
}

function writeManifest() {
  const { fileName, signature } = findUpdaterArtifact()
  const repo = process.env.GITHUB_REPOSITORY || DEFAULT_REPO

  const manifest = {
    version,
    notes: changelogNotes(version),
    // ISO 8601（UTC）。插件按 RFC 3339 解析，用运行时时间而非硬编码。
    pub_date: new Date().toISOString(),
    platforms: {
      'windows-x86_64': {
        signature,
        url: `https://github.com/${repo}/releases/download/v${version}/${encodeURIComponent(fileName)}`,
      },
    },
  }

  const outPath = path.join(BUNDLE_DIR, 'latest.json')
  fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  console.log('')
  console.log(`✅ 已生成更新清单：${outPath}`)
  console.log(`   版本：${version}`)
  console.log(`   安装包：${fileName}`)
  console.log(`   签名长度：${signature.length} 字符`)
  console.log('')
  console.log('下一步（发布）：')
  console.log(`   1. 把 latest.json 与 ${fileName} 一起上传到 GitHub Release（tag = v${version}）`)
  console.log('   2. 确认该 Release 是「最新正式版」（非草稿、非预发布），否则 latest/download 会 404')
}

function build() {
  const inlineKey = process.env.TAURI_SIGNING_PRIVATE_KEY
  const keyPath = process.env.TAURI_SIGNING_PRIVATE_KEY_PATH || DEFAULT_KEY_PATH

  if (!inlineKey && !fs.existsSync(keyPath)) {
    console.error('❌ 找不到签名私钥，无法产出自动更新所需的 .sig 文件。')
    console.error(`   查找位置：${keyPath}`)
    console.error('')
    console.error('   先生成一对密钥（只需一次）：')
    console.error('     pnpm tauri signer generate -w "%USERPROFILE%\\.tauri\\mindscape.key"')
    console.error('   再把输出的公钥填进 tauri.conf.json 的 plugins.updater.pubkey。')
    process.exit(1)
  }

  const env = { ...process.env }
  if (inlineKey) {
    console.log('使用 TAURI_SIGNING_PRIVATE_KEY 中的内联私钥')
  } else {
    // 必须读成内容注入：CLI 不认 *_KEY_PATH（见文件头说明）
    env.TAURI_SIGNING_PRIVATE_KEY = fs.readFileSync(keyPath, 'utf8').trim()
    console.log(`使用签名私钥：${keyPath}`)
  }

  // ⚠️ 缺少这个变量时，CLI 会**交互式提示输入密码**（日志里是
  //    「Decrypting updater signing key, expect a prompt for password」），
  //    在无 TTY 的环境（脚本、CI）里会直接挂住不动。本项目的密钥未设密码，
  //    因此显式给空串；密钥另设密码时请自行导出 TAURI_SIGNING_PRIVATE_KEY_PASSWORD。
  if (env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD === undefined) {
    env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''
  }

  console.log(`开始构建 ${productName} v${version} …`)
  const result = spawnSync(process.execPath, [TAURI_CLI, 'build'], {
    cwd: ROOT,
    stdio: 'inherit',
    env,
  })

  if (result.status !== 0) {
    console.error(`❌ 构建失败，退出码 ${result.status}`)
    process.exit(result.status ?? 1)
  }
}

if (process.argv.includes('--manifest-only')) {
  console.log('跳过构建，仅重新生成 latest.json')
} else {
  build()
}

try {
  writeManifest()
} catch (error) {
  console.error(`❌ 生成 latest.json 失败：${error instanceof Error ? error.message : error}`)
  process.exit(1)
}
