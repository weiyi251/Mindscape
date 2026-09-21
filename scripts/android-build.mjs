// ============================================================================
// 模块说明（中文）
// 安卓 APK 构建脚本（2026-09-21 移动端适配 M5，对应 docs/移动端适配计划.md §3 M5）。
//
// 为什么不直接用 `pnpm tauri android build`：M0 实测该命令在 Windows 上要**开发者模式**
// （打包过程建符号链接），本机没开；当时的绕法是「手动 cargo → 把 .so 复制进 jniLibs →
// gradlew assemble*，并排除掉 gradle 里那个会回调 tauri CLI 的 rustBuild* 任务」。
// 绕法有效但全靠手敲，容易漏一步（漏了 vite build 就打空包、忘了同步版本号就打旧包），故固化成脚本。
//
// 用法：
//   pnpm android                       debug arm64 APK（真机测试用，不需要签名密钥）
//   pnpm android --release             release + zipalign + apksigner 签名（密钥见 docs/移动端发布流程.md）
//   pnpm android --targets arm64,arm,x86,x86_64   四档齐出 → universal 包（分发用）
//   pnpm android --targets x86_64      模拟器用
//   pnpm android --dry-run             只打印将要执行的命令，不动手
//   pnpm android --skip-frontend       跳过 pnpm build（dist/ 是新的）
//   pnpm android --skip-rust           跳过 cargo 编译与 .so 复制（只改了前端时省一大截编译）
//
// 顺序不能变：前端产物 `dist/` 是被 `tauri::generate_context!` 在 **Rust 编译期**嵌进 .so 的，
// 所以 vite build 必须早于 cargo；.so 又必须早于 gradle（gradle 只负责打包，不再编 Rust）。
//
// 签名不写进 gen/android：`gen/android/**` 是 `tauri android init` 的生成物且**不入库**
// （本地已为此手改过 BuildTask.kt 一处），再往 build.gradle.kts 里塞 signingConfig 就是第三处
// 「重新 init 即失效」的手改。所以 release 走「gradle 出未签名包 → apksigner 外挂签名」。
//
// 平台映射 / 环境变量名 / gradle 任务名 / 版本号 / 命令编排都是导出的纯函数，
// 由同目录 android-build.test.mjs 断言 —— 真跑一次几十分钟，编译期能判的别让机器等。
// ============================================================================

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC_TAURI = path.join(ROOT, 'src-tauri')
const ANDROID_DIR = path.join(SRC_TAURI, 'gen', 'android')
const APP_DIR = path.join(ANDROID_DIR, 'app')
const TAURI_CONF_PATH = path.join(SRC_TAURI, 'tauri.conf.json')
const CARGO_TOML_PATH = path.join(SRC_TAURI, 'Cargo.toml')

/** NDK clang wrapper 的 API 级别档；与 HANDOVER §6 那条编译验证命令同档 */
const NDK_API_LEVEL = 21

/**
 * cargo 必须显式开 `tauri/custom-protocol`，否则打出来的包**没有界面**。
 *
 * tauri 的 build.rs 里 `let dev = !has_feature("custom-protocol")` → `#[cfg(dev)]`；
 * dev 下 `generate_context!` **不把 `dist/` 打进 .so**，运行时改连 `build.devUrl`（本机 1420）。
 * 平时这个 feature 由 tauri CLI 自动补，绕过 CLI 手敲 cargo 就得自己加 ——
 * 漏加的症状：APK 装得上、点开闪一下黑屏就退出（2026-09-21 真机第一轮就是这么撞上的）。
 */
export const MOBILE_CARGO_FEATURES = ['tauri/custom-protocol']

/**
 * 四档 ABI 的四份名字。前三份来自生成物 `RustPlugin.kt` 的 targetList / archList / abiList，
 * `wrapper` 是 NDK 里按 API 级别分发的 clang 脚本名前缀 ——
 * ⚠️ armv7 那档对不上：cargo 的 target 是 `armv7-linux-androideabi`，
 * NDK 的 wrapper 却叫 `armv7a-linux-androideabi21-clang`（多一个 a），所以只能逐条列。
 */
export const TARGETS = {
  arm64: { rust: 'aarch64-linux-android', gradleArch: 'Arm64', abi: 'arm64-v8a', wrapper: 'aarch64-linux-android' },
  arm: { rust: 'armv7-linux-androideabi', gradleArch: 'Arm', abi: 'armeabi-v7a', wrapper: 'armv7a-linux-androideabi' },
  x86: { rust: 'i686-linux-android', gradleArch: 'X86', abi: 'x86', wrapper: 'i686-linux-android' },
  x86_64: { rust: 'x86_64-linux-android', gradleArch: 'X86_64', abi: 'x86_64', wrapper: 'x86_64-linux-android' },
}

const ALL_ARCHES = Object.keys(TARGETS)

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------

/** 命令行 → 构建配置。选一个架构 = 该 arch flavor 包；选四个 = universal 包。 */
export function parseArgs(argv) {
  const opts = {
    profile: 'debug',
    targets: ['arm64'],
    dryRun: false,
    skipFrontend: false,
    skipRust: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--release') opts.profile = 'release'
    else if (arg === '--debug') opts.profile = 'debug'
    else if (arg === '--dry-run') opts.dryRun = true
    else if (arg === '--skip-frontend') opts.skipFrontend = true
    else if (arg === '--skip-rust') opts.skipRust = true
    else if (arg === '--universal') opts.targets = [...ALL_ARCHES]
    else if (arg === '--targets' || arg === '--target') opts.targets = splitList(argv[(i += 1)], arg)
    else if (arg.startsWith('--targets=')) opts.targets = splitList(arg.slice('--targets='.length), '--targets')
    else throw new Error(`不认识参数 ${arg}（--help 看用法）`)
  }

  const unknown = opts.targets.filter((t) => !(t in TARGETS))
  if (unknown.length > 0) {
    throw new Error(`架构名 ${unknown.join('、')} 不存在，可选：${ALL_ARCHES.join(' / ')}`)
  }
  if (opts.targets.length === 0) throw new Error('--targets 不能为空')
  const dup = new Set(opts.targets)
  if (dup.size !== opts.targets.length) throw new Error(`--targets 有重复：${opts.targets.join(',')}`)
  return { ...opts, flavor: opts.targets.length === 1 ? opts.targets[0] : 'universal' }
}

function splitList(raw, flag) {
  if (!raw) throw new Error(`${flag} 后面要跟架构名（arm64 / arm / x86 / x86_64，逗号分隔）`)
  return raw.split(/[,\s]+/).filter(Boolean)
}

export function helpText() {
  return [
    '用法：pnpm android [参数]',
    '  （无参数）      debug arm64 APK，真机测试用，不需要签名密钥',
    '  --universal     四档架构齐出（universal 包，分发用）',
    '  --targets a,b   指定架构（arm64 / arm / x86 / x86_64；模拟器用 x86_64）',
    '  --release       release 构建并 zipalign + apksigner 签名（密钥走环境变量，见 docs/移动端发布流程.md）',
    '  --dry-run       只打印将执行的命令',
    '  --skip-frontend 跳过 pnpm build',
    '  --skip-rust     跳过 cargo 编译与 .so 复制（只改前端时用）',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// 纯逻辑
// ---------------------------------------------------------------------------

/** 从 Cargo.toml 读 [lib] name —— .so 的文件名由它决定，不拼死 */
export function parseCargoLibName(cargoTomlText) {
  const afterLib = cargoTomlText.split(/^\[lib\]\s*$/m)[1]
  const match = afterLib && /^\s*name\s*=\s*"([^"]+)"/m.exec(afterLib)
  if (!match) throw new Error('Cargo.toml 里没找到 [lib] name，无法确定 .so 文件名')
  return match[1]
}

/** cargo 产出的动态库名（crate 名的 `-` 变 `_`，前面补 lib） */
export function soFileName(libName) {
  return `lib${libName.replace(/-/g, '_')}.so`
}

export function cargoProfileDir(profile) {
  return profile === 'release' ? 'release' : 'debug'
}

/**
 * 交叉编译所需的 NDK 工具链环境变量（M0 实测清单）。
 * cc 系 crate 认 `CC_<target>` / `CXX_<target>` / `AR_<target>`，链接认 `CARGO_TARGET_<TARGET>_LINKER`；
 * 少这几个会报「找不到 clang」，或者链出宿主 ABI 的库。
 */
export function ndkEnv(ndkBin, target) {
  const underscore = target.rust.replace(/-/g, '_')
  const clang = path.join(ndkBin, `${target.wrapper}${NDK_API_LEVEL}-clang.cmd`)
  return {
    [`CC_${underscore}`]: clang,
    [`CXX_${underscore}`]: path.join(ndkBin, `${target.wrapper}${NDK_API_LEVEL}-clang++.cmd`),
    [`AR_${underscore}`]: path.join(ndkBin, 'llvm-ar.exe'),
    [`CARGO_TARGET_${underscore.toUpperCase()}_LINKER`]: clang,
  }
}

/**
 * gradle 任务名。`exclude` 那五个是生成物里会回调 tauri CLI 的 rustBuild* 任务
 * （`RustPlugin.kt` 对 debug / release 各建 5 个，所以整体排除当前档是安全的）。
 */
export function gradleTasks(profile, flavor) {
  const profileCap = profile === 'release' ? 'Release' : 'Debug'
  const flavorCap = flavor === 'universal' ? 'Universal' : TARGETS[flavor].gradleArch
  return {
    assemble: `assemble${flavorCap}${profileCap}`,
    exclude: [`rustBuildUniversal${profileCap}`].concat(
      ALL_ARCHES.map((key) => `rustBuild${TARGETS[key].gradleArch}${profileCap}`),
    ),
  }
}

/**
 * tauri CLI 的版本号算法（本机实测：`0.9.0` → `versionCode=9000`，写在 app/tauri.properties 里）。
 * 绕过 CLI 就得自己写这两行 —— Android 只认整数 versionCode，且**只能增不能减**（旧码装不上）。
 */
export function versionCodeOf(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  if (!match) throw new Error(`版本号 ${version} 不是 x.y.z，算不出 versionCode`)
  return Number(match[1]) * 1_000_000 + Number(match[2]) * 1_000 + Number(match[3])
}

/** gradle 的 APK 产物路径（release 的未签名包带 -unsigned 后缀） */
export function apkPath({ flavor, profile, appDir = APP_DIR }) {
  const suffix = profile === 'release' ? '-unsigned' : ''
  return path.join(appDir, 'build', 'outputs', 'apk', flavor, profile, `app-${flavor}-${profile}${suffix}.apk`)
}

export function withSuffix(apk, from, to) {
  return apk.endsWith(from) ? `${apk.slice(0, -from.length)}${to}` : apk
}

/** build-tools 里挑版本号最高的那份（装了 34/35/36 时不该让人手填路径） */
export function pickBuildTools(androidHome, readdir = (dir) => fs.readdirSync(dir)) {
  const dir = path.join(androidHome, 'build-tools')
  let names
  try {
    names = readdir(dir)
  } catch {
    throw new Error(`${dir} 不存在 —— 先 sdkmanager 装 build-tools`)
  }
  const versions = names.filter((name) => /^\d+(\.\d+)*$/.test(name)).sort(compareVersion)
  if (versions.length === 0) throw new Error(`${dir} 下没有版本目录 —— 先 sdkmanager 装 build-tools`)
  return path.join(dir, versions[versions.length - 1])
}

function compareVersion(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * release 签名前置检查：只认环境变量，**密码不进命令行参数、不落盘、不回显**。
 * 命令行里只出现 `env:MINDSCAPE_APK_STOREPASS`，让 apksigner 自己去读。
 */
export function resolveSigning(env, exists = (file) => fs.existsSync(file)) {
  const missing = []
  if (!env.MINDSCAPE_APK_KEYSTORE) missing.push('MINDSCAPE_APK_KEYSTORE（keystore 文件路径，仓库外）')
  if (!env.MINDSCAPE_APK_KEY_ALIAS) missing.push('MINDSCAPE_APK_KEY_ALIAS（密钥别名）')
  if (!env.MINDSCAPE_APK_STOREPASS) missing.push('MINDSCAPE_APK_STOREPASS（keystore 密码）')
  if (missing.length > 0) return { ok: false, missing }
  if (!exists(env.MINDSCAPE_APK_KEYSTORE)) {
    return { ok: false, missing: [`MINDSCAPE_APK_KEYSTORE 指向的文件不存在：${env.MINDSCAPE_APK_KEYSTORE}`] }
  }
  return { ok: true, keystore: env.MINDSCAPE_APK_KEYSTORE, alias: env.MINDSCAPE_APK_KEY_ALIAS }
}

// ---------------------------------------------------------------------------
// 构建计划（dry-run 与真实执行共用同一份，避免「打印的是一套、跑的是另一套」）
// ---------------------------------------------------------------------------

/**
 * @param opts parseArgs 的结果
 * @param ctx  { version, libName, ndkBin, buildToolsDir, javaHome, signing, isWindows }
 * @returns { steps, apk, warnings }
 */
export function buildPlan(opts, ctx) {
  const { version, libName, ndkBin, buildToolsDir, javaHome, signing = null, isWindows = true } = ctx

  const warnings = []
  if (!ndkBin) warnings.push('NDK_HOME 未设置 —— cargo 交叉编译会失败，先补环境变量（HANDOVER §6）')
  if (!buildToolsDir) warnings.push('找不到 build-tools —— release 签名需要 zipalign / apksigner')
  if (!javaHome) warnings.push('JAVA_HOME 未设置 —— gradlew 起不了 JVM')

  const { assemble, exclude } = gradleTasks(opts.profile, opts.flavor)
  const steps = []

  if (!opts.skipFrontend) {
    steps.push({ title: '前端产物（会被编进 .so，必须第一步）', cmd: 'pnpm', args: ['build'], cwd: ROOT })
  }

  if (!opts.skipRust) {
    for (const key of opts.targets) {
      const target = TARGETS[key]
      const args = ['build', '--target', target.rust, '--lib', '--features', MOBILE_CARGO_FEATURES.join(',')]
      if (opts.profile === 'release') args.push('--release')
      steps.push({
        title: `cargo build --target ${target.rust}（${opts.profile}）`,
        cmd: 'cargo',
        args,
        cwd: SRC_TAURI,
        env: ndkBin ? ndkEnv(ndkBin, target) : {},
      })
    }
    steps.push({ title: `复制 .so 进 app/src/main/jniLibs/<abi>/`, local: 'copySo' })
  }

  steps.push({
    title: `同步版本号 → app/tauri.properties（${version} / ${versionCodeOf(version)}）`,
    local: 'version',
  })

  steps.push({
    title: `gradlew ${assemble}（排除 rustBuild*：Rust 已由上一步编好）`,
    cmd: path.join(ANDROID_DIR, isWindows ? 'gradlew.bat' : 'gradlew'),
    args: [assemble, ...exclude.flatMap((task) => ['-x', task])],
    cwd: ANDROID_DIR,
  })

  const unsigned = apkPath({ flavor: opts.flavor, profile: opts.profile })
  let apk = unsigned
  if (opts.profile === 'release') {
    if (!signing) throw new Error('release 构建缺签名信息（resolveSigning 没过就不该走到这里）')
    const tools = buildToolsDir || path.join('<ANDROID_HOME>', 'build-tools', '<版本>')
    const signer = (name) => path.join(tools, isWindows ? `${name}.bat` : name)
    const aligned = withSuffix(unsigned, '-unsigned.apk', '-aligned.apk')
    apk = withSuffix(unsigned, '-unsigned.apk', '-signed.apk')
    steps.push({
      title: 'zipalign（签名前必须对齐；-p 4 让 .so 页对齐）',
      cmd: path.join(tools, isWindows ? 'zipalign.exe' : 'zipalign'),
      args: ['-f', '-p', '4', unsigned, aligned],
    })
    steps.push({
      title: 'apksigner sign（V2/V3；密码从环境变量读，不进命令行）',
      cmd: signer('apksigner'),
      args: [
        'sign',
        '--ks',
        signing.keystore,
        '--ks-key-alias',
        signing.alias,
        '--ks-pass',
        'env:MINDSCAPE_APK_STOREPASS',
        '--out',
        apk,
        aligned,
      ],
    })
    steps.push({
      title: 'apksigner verify（签坏了装机只报一句 INSTALL_FAILED，不如现在报错）',
      cmd: signer('apksigner'),
      args: ['verify', '--print-certs', apk],
    })
  }

  return { steps, apk, warnings }
}

// ---------------------------------------------------------------------------
// 本脚本自己动盘的两件小事
// ---------------------------------------------------------------------------

/** cargo 产物 → app/src/main/jniLibs/<abi>/（只覆盖我们那一个文件，不整删目录：里面还有插件的 .so） */
export function copySoToJniLibs({ targets, profile, libName, srcTauri = SRC_TAURI, appDir = APP_DIR }) {
  const so = soFileName(libName)
  const written = []
  for (const key of targets) {
    const target = TARGETS[key]
    const from = path.join(srcTauri, 'target', target.rust, cargoProfileDir(profile), so)
    if (!fs.existsSync(from)) {
      throw new Error(
        `找不到 ${from}\n  → 该 target 的 cargo 步没产出（编译失败了？还是加了 --skip-rust 但 jniLibs 里本来就没有）`,
      )
    }
    const dir = path.join(appDir, 'src', 'main', 'jniLibs', target.abi)
    fs.mkdirSync(dir, { recursive: true })
    const to = path.join(dir, so)
    fs.copyFileSync(from, to)
    written.push(to)
  }
  return written
}

/** 覆写 gen/android/app/tauri.properties（文件本身是 CLI 生成物，注释头照抄保持一致） */
export function writeTauriProperties(version, file = path.join(APP_DIR, 'tauri.properties')) {
  fs.writeFileSync(
    file,
    [
      '// THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.',
      `tauri.android.versionName=${version}`,
      `tauri.android.versionCode=${versionCodeOf(version)}`,
      '',
    ].join('\n'),
    'utf8',
  )
  return file
}

// ---------------------------------------------------------------------------
// 执行
// ---------------------------------------------------------------------------

function missingEnv(names) {
  return names.filter((name) => !process.env[name])
}

/**
 * Windows 上要 `shell: true` 才起得来 `.bat`/`.cmd`（gradlew、apksigner），
 * 而那种模式下 Node 只把参数**拼**进命令串、不做转义 —— 路径里带一个空格
 * （SDK 装在 `C:\Program Files\...` 的机器）命令就被拆成两截。这里自己补引号。
 * 顺带把 shell 元字符一起罩进引号，免得参数被当成重定向。
 */
export function quoteForShell(token) {
  return /[\s&<>|^]/.test(token) ? `"${token}"` : token
}

function runStep(step) {
  const useShell = process.platform === 'win32'
  const args = (step.args || []).map((arg) => (useShell ? quoteForShell(arg) : arg))
  const cmd = useShell ? quoteForShell(step.cmd) : step.cmd
  const result = spawnSync(cmd, args, {
    cwd: step.cwd || ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...(step.env || {}) },
    shell: useShell,
  })
  if (result.error) {
    throw new Error(
      `${step.cmd} 起不来：${result.error.message}\n  Windows 上 PATH 里没有时给绝对路径（cargo 在 %USERPROFILE%\\.cargo\\bin）`,
    )
  }
  if (result.status !== 0) throw new Error(`${step.title} 失败，退出码 ${result.status}`)
}

function ndkBinPath(env) {
  if (!env.NDK_HOME) return null
  const platformDir = process.platform === 'win32' ? 'windows-x86_64' : process.platform === 'darwin' ? 'darwin-x86_64' : 'linux-x86_64'
  return path.join(env.NDK_HOME, 'toolchains', 'llvm', 'prebuilt', platformDir, 'bin')
}

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(helpText())
    return
  }

  let opts
  try {
    opts = parseArgs(argv)
  } catch (error) {
    console.error(`❌ ${error.message}`)
    process.exit(1)
    return
  }

  if (!fs.existsSync(ANDROID_DIR)) {
    console.error(`❌ 没有 ${ANDROID_DIR}`)
    console.error('   先跑：pnpm tauri android init（gen/ 不入库，换机器要重新 init，并重做 BuildTask.kt 里 npm 绝对路径那处手改）')
    process.exit(1)
    return
  }

  const envMissing = missingEnv(['JAVA_HOME', 'ANDROID_HOME', 'NDK_HOME'])
  if (envMissing.length > 0) {
    console.error(`❌ 缺环境变量：${envMissing.join('、')}`)
    console.error('   取值口径见 HANDOVER.md §6「安卓 target 编译验证」')
    process.exit(1)
    return
  }

  const version = JSON.parse(fs.readFileSync(TAURI_CONF_PATH, 'utf8')).version
  const libName = parseCargoLibName(fs.readFileSync(CARGO_TOML_PATH, 'utf8'))

  let signing = null
  if (opts.profile === 'release') {
    const resolved = resolveSigning(process.env)
    if (!resolved.ok) {
      console.error('❌ release 需要签名密钥，缺：')
      for (const item of resolved.missing) console.error(`   · ${item}`)
      console.error(`   生成 keystore 的命令与约定见 docs/移动端发布流程.md（密钥必须在仓库外）`)
      process.exit(1)
      return
    }
    signing = resolved
  }

  let buildToolsDir = null
  try {
    buildToolsDir = pickBuildTools(process.env.ANDROID_HOME)
  } catch (error) {
    if (opts.profile === 'release') {
      console.error(`❌ ${error.message}`)
      process.exit(1)
      return
    }
  }

  const plan = buildPlan(opts, {
    version,
    libName,
    ndkBin: ndkBinPath(process.env),
    buildToolsDir,
    javaHome: process.env.JAVA_HOME,
    signing,
    isWindows: process.platform === 'win32',
  })

  for (const warning of plan.warnings) console.log(`⚠️ ${warning}`)
  console.log(`构建：${opts.flavor} / ${opts.profile} / ${opts.targets.join(',')}`)
  console.log(`宿主：${os.type()} ${os.release()}`)

  for (const step of plan.steps) {
    console.log(`\n▶ ${step.title}`)
    if (step.local === 'copySo') {
      if (!opts.dryRun) {
        for (const file of copySoToJniLibs({ targets: opts.targets, profile: opts.profile, libName })) {
          console.log(`   → ${file}`)
        }
      }
      continue
    }
    if (step.local === 'version') {
      if (!opts.dryRun) console.log(`   → ${writeTauriProperties(version)}`)
      continue
    }
    console.log(`   ${step.cmd} ${step.args.join(' ')}`)
    if (opts.dryRun) continue
    runStep(step)
  }

  if (opts.dryRun) {
    console.log(`\n（dry-run，未执行。产物会是 ${plan.apk}）`)
    return
  }

  console.log(`\n✅ APK：${plan.apk}`)
  console.log('   装机：adb install -r "<apk>"（-r 才保数据）')
  console.log('   测试：按 docs/移动端真机测试清单.md 逐条走')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
