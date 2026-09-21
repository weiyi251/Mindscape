// ============================================================================
// 模块说明（中文）
// scripts/android-build.mjs 的单元测试（2026-09-21 移动端适配 M5）。
//
// 为什么只测这些：真跑一次安卓构建要几十分钟（cargo 交叉编译四档 + gradle），
// 而脚本最容易错的地方恰恰是**抄来的名字** —— cargo target 三元组、NDK wrapper 文件名、
// gradle 任务名、versionCode 算法、APK 产物路径。这些全是纯字符串逻辑，编译期就能判。
// 需要动手的部分（spawn 真命令）留一条都不跑，`--dry-run` 就是给人核对用的。
//
// 环境仍是 node（AGENTS.md：不引 jsdom）；会碰盘的两个函数只往临时目录写。
// ============================================================================

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  TARGETS,
  apkPath,
  buildPlan,
  copySoToJniLibs,
  gradleTasks,
  ndkEnv,
  parseArgs,
  parseCargoLibName,
  pickBuildTools,
  quoteForShell,
  resolveSigning,
  soFileName,
  versionCodeOf,
  withSuffix,
  writeTauriProperties,
} from './android-build.mjs'

const tempFile = (name) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mindscape-android-')), name)

describe('parseArgs', () => {
  it('默认 = debug + 只编 arm64（真机绝大多数是它，四档齐出要等三份没用的编译）', () => {
    const opts = parseArgs([])
    expect(opts.profile).toBe('debug')
    expect(opts.targets).toEqual(['arm64'])
    expect(opts.flavor).toBe('arm64')
    expect(opts.dryRun).toBe(false)
  })

  it('四个架构齐出才叫 universal；单架构走对应 arch flavor', () => {
    expect(parseArgs(['--universal'])).toMatchObject({ flavor: 'universal', targets: ['arm64', 'arm', 'x86', 'x86_64'] })
    expect(parseArgs(['--targets', 'x86_64']).flavor).toBe('x86_64')
    expect(parseArgs(['--targets', 'arm64,arm']).flavor).toBe('universal')
  })

  it('架构名写错时把可选项说出来（这三个名字在 cargo / gradle / NDK 三方各不相同，打错很常见）', () => {
    expect(() => parseArgs(['--targets', 'aarch64'])).toThrow(/可选：arm64 \/ arm \/ x86 \/ x86_64/)
    expect(() => parseArgs(['--targets', 'arm64,arm64'])).toThrow(/重复/)
    expect(() => parseArgs(['--targets'])).toThrow(/后面要跟架构名/)
    expect(() => parseArgs(['--relase'])).toThrow(/不认识参数/)
  })
})

describe('产物与任务名', () => {
  it('[lib] name 决定 .so 文件名（横杠变下划线）', () => {
    const libName = parseCargoLibName('[lib]\nname = "mindscape_canvas_lib"\ncrate-type = ["cdylib"]\n')
    expect(libName).toBe('mindscape_canvas_lib')
    expect(soFileName('mindscape-canvas-lib')).toBe('libmindscape_canvas_lib.so')
    expect(() => parseCargoLibName('[package]\nname = "x"\n')).toThrow(/\[lib\] name/)
  })

  it('APK 路径按 flavor / buildType 分目录，release 的未签名包带 -unsigned', () => {
    const appDir = path.join('gen', 'android', 'app')
    expect(apkPath({ flavor: 'universal', profile: 'debug', appDir })).toBe(
      path.join(appDir, 'build', 'outputs', 'apk', 'universal', 'debug', 'app-universal-debug.apk'),
    )
    const release = apkPath({ flavor: 'universal', profile: 'release', appDir })
    expect(release.endsWith('app-universal-release-unsigned.apk')).toBe(true)
    expect(withSuffix(release, '-unsigned.apk', '-signed.apk')).toContain('app-universal-release-signed.apk')
    // debug 包没有 -unsigned 后缀，不该被改坏
    expect(withSuffix(apkPath({ flavor: 'arm64', profile: 'debug', appDir }), '-unsigned.apk', '-signed.apk')).toContain('app-arm64-debug.apk')
  })

  it('gradle 任务名 = assemble + Flavor + BuildType', () => {
    expect(gradleTasks('debug', 'arm64').assemble).toBe('assembleArm64Debug')
    expect(gradleTasks('release', 'universal').assemble).toBe('assembleUniversalRelease')
    expect(gradleTasks('debug', 'x86_64').assemble).toBe('assembleX86_64Debug')
  })

  it('rustBuild* 五个必须全列进 exclude —— 漏一个，gradle 就会回调 tauri CLI，撞上 M0 那个符号链接坑', () => {
    expect(gradleTasks('release', 'universal').exclude).toEqual([
      'rustBuildUniversalRelease',
      'rustBuildArm64Release',
      'rustBuildArmRelease',
      'rustBuildX86Release',
      'rustBuildX86_64Release',
    ])
  })
})

describe('ndkEnv', () => {
  it('键名是 cargo 的口径：target 里的横杠变下划线', () => {
    const env = ndkEnv('/ndk/bin', TARGETS.arm64)
    expect(Object.keys(env).sort()).toEqual([
      'AR_aarch64_linux_android',
      'CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER',
      'CC_aarch64_linux_android',
      'CXX_aarch64_linux_android',
    ])
  })

  it('⚠️ armv7 的 NDK wrapper 多一个 a（cargo 叫 armv7-…，NDK 叫 armv7a-…），照抄 target 名会找不到 clang', () => {
    const env = ndkEnv('/ndk/bin', TARGETS.arm)
    expect(env.CC_armv7_linux_androideabi).toContain('armv7a-linux-androideabi21-clang.cmd')
    expect(env.CXX_armv7_linux_androideabi).toContain('armv7a-linux-androideabi21-clang++.cmd')
    expect(env.AR_armv7_linux_androideabi).toContain('llvm-ar.exe')
  })
})

describe('versionCodeOf', () => {
  it('与 tauri CLI 写进 app/tauri.properties 的实际值一致（0.9.0 → 9000）', () => {
    expect(versionCodeOf('0.9.0')).toBe(9000)
    expect(versionCodeOf('1.2.3')).toBe(1_002_003)
    expect(versionCodeOf('0.10.4')).toBe(10_004)
  })

  it('版本号写歪时直接报错，不打一个装不上的包', () => {
    expect(() => versionCodeOf('0.9')).toThrow(/不是 x\.y\.z/)
  })
})

describe('pickBuildTools', () => {
  it('按版本号取最高，非版本目录（.DS_Store 之类）不参与', () => {
    const picked = pickBuildTools('/sdk', () => ['34.0.0', '36.0.0', '35.0.0', '.DS_Store', 'xml'])
    expect(picked).toBe(path.join('/sdk', 'build-tools', '36.0.0'))
  })

  it('一个都没有时给出可执行的下一步（不是 ENOENT 栈）', () => {
    expect(() => pickBuildTools('/sdk', () => ['.DS_Store'])).toThrow(/build-tools/)
    expect(() => pickBuildTools('/sdk', () => { throw new Error('ENOENT') })).toThrow(/不存在/)
  })
})

describe('resolveSigning', () => {
  const full = {
    MINDSCAPE_APK_KEYSTORE: '/outside/mindscape-android.keystore',
    MINDSCAPE_APK_KEY_ALIAS: 'mindscape',
    MINDSCAPE_APK_STOREPASS: 'correct horse battery staple',
  }

  it('三项缺一就不放行，并且把缺的那项按变量名说清楚', () => {
    expect(resolveSigning({}, () => true)).toMatchObject({
      ok: false,
      missing: [
        'MINDSCAPE_APK_KEYSTORE（keystore 文件路径，仓库外）',
        'MINDSCAPE_APK_KEY_ALIAS（密钥别名）',
        'MINDSCAPE_APK_STOREPASS（keystore 密码）',
      ],
    })
    expect(resolveSigning({ ...full, MINDSCAPE_APK_KEY_ALIAS: '' }, () => true).missing).toEqual([
      'MINDSCAPE_APK_KEY_ALIAS（密钥别名）',
    ])
  })

  it('keystore 路径写错时点名那个路径', () => {
    expect(resolveSigning(full, () => false).missing[0]).toContain('不存在')
  })

  it('返回体里不得出现密码（它只该待在环境变量里）', () => {
    const result = resolveSigning(full, () => true)
    expect(result.ok).toBe(true)
    expect(JSON.stringify(result)).not.toContain('correct horse battery staple')
  })
})

describe('buildPlan 步骤编排', () => {
  const ctx = {
    version: '0.9.0',
    libName: 'mindscape_canvas_lib',
    ndkBin: '/ndk/bin',
    buildToolsDir: '/sdk/build-tools/36.0.0',
    javaHome: '/jdk',
    isWindows: true,
  }
  const titles = (plan) => plan.steps.map((step) => step.title)

  it('顺序：前端 → cargo → 复制 .so → 版本号 → gradle（前端产物是编进 .so 的，反了就打空包）', () => {
    const plan = buildPlan(parseArgs(['--targets', 'arm64']), ctx)
    expect(plan.steps[0].args).toEqual(['build'])
    expect(plan.steps[1].title).toContain('cargo build --target aarch64-linux-android')
    expect(plan.steps[2].local).toBe('copySo')
    expect(plan.steps[3].local).toBe('version')
    expect(plan.steps[4].title).toContain('assembleArm64Debug')
    expect(titles(plan)).toHaveLength(5)
  })

  it('⚠️ 每条 cargo 都必须开 `tauri/custom-protocol`（漏了 = .so 里不打进 dist，装机后黑屏闪退）', () => {
    const plan = buildPlan(parseArgs(['--universal']), ctx)
    const cargo = plan.steps.filter((step) => step.cmd === 'cargo')
    expect(cargo).toHaveLength(4)
    for (const step of cargo) {
      expect(step.args.slice(-2)).toEqual(['--features', 'tauri/custom-protocol'])
    }
    // release 档：--release 排在 --features 之后，两者都在
    const signing = { keystore: '/outside/mindscape.keystore', alias: 'mindscape' }
    const rel = buildPlan(parseArgs(['--release', '--universal']), { ...ctx, signing }).steps.filter((s) => s.cmd === 'cargo')
    expect(rel[0].args).toContain('--release')
    expect(rel[0].args.slice(1, 3)).toEqual(['--target', 'aarch64-linux-android'])
  })

  it('universal 时每个架构一条 cargo，链接器 env 各配各的', () => {
    const plan = buildPlan(parseArgs(['--universal']), ctx)
    const cargo = plan.steps.filter((step) => step.cmd === 'cargo')
    expect(cargo.map((step) => step.args[2])).toEqual([
      'aarch64-linux-android',
      'armv7-linux-androideabi',
      'i686-linux-android',
      'x86_64-linux-android',
    ])
    expect(cargo[1].env.CC_armv7_linux_androideabi).toContain('armv7a-')
    const gradle = plan.steps.find((step) => step.title.startsWith('gradlew'))
    expect(gradle.args[0]).toBe('assembleUniversalDebug')
    // gradlew 排除掉回调 CLI 的那五个任务
    expect(gradle.args).toContain('-x')
    expect(gradle.args.filter((a) => String(a).startsWith('rustBuild'))).toHaveLength(5)
  })

  it('--skip-rust 时既不编也不复制（只改前端的那一轮）', () => {
    const plan = buildPlan(parseArgs(['--skip-rust']), ctx)
    expect(titles(plan).filter((t) => t.includes('cargo'))).toEqual([])
    expect(plan.steps.some((step) => step.local === 'copySo')).toBe(false)
  })

  it('debug 包绝不出现签名步骤', () => {
    const plan = buildPlan(parseArgs([]), ctx)
    expect(titles(plan).join('\n')).not.toMatch(/apksigner|zipalign/)
    expect(plan.apk).toContain('app-arm64-debug.apk')
  })

  it('release：zipalign → sign → verify，且密码只以 env: 引用出现', () => {
    const opts = parseArgs(['--release', '--universal'])
    const signing = { keystore: '/outside/mindscape.keystore', alias: 'mindscape' }
    const plan = buildPlan(opts, { ...ctx, signing })
    const cmds = plan.steps.map((step) => step.cmd)
    expect(cmds[cmds.length - 3]).toContain(path.join('36.0.0', 'zipalign.exe'))
    const sign = plan.steps.find((step) => step.args?.[0] === 'sign')
    const verify = plan.steps.find((step) => step.args?.[0] === 'verify')
    expect(sign).toBeTruthy()
    expect(sign.args).toContain('--ks')
    expect(sign.args).toContain('env:MINDSCAPE_APK_STOREPASS')
    // 密码只能以 `env:` 间接引用出现 —— 进命令行就会被进程列表与日志看到
    const passFlags = ['--ks-pass', '--key-pass', '--passout']
    for (const [index, arg] of sign.args.entries()) {
      if (passFlags.includes(arg)) expect(sign.args[index + 1]).toMatch(/^env:/)
    }
    expect(sign.args.filter((a) => !a.startsWith('--') && /pass/i.test(a) && !a.startsWith('env:'))).toEqual([])
    expect(verify).toBeTruthy()
    expect(plan.apk).toContain('app-universal-release-signed.apk')
  })

  it('release 少了签名信息就在编排阶段报错，而不是跑到一半才失败', () => {
    expect(() => buildPlan(parseArgs(['--release']), ctx)).toThrow(/签名/)
  })

  it('环境变量缺失只给警告，命令照样列出来（dry-run 时人要看的就是这份清单）', () => {
    const plan = buildPlan(parseArgs([]), { ...ctx, ndkBin: null, javaHome: null, buildToolsDir: null })
    expect(plan.warnings.join('\n')).toMatch(/NDK_HOME/)
    expect(plan.warnings.join('\n')).toMatch(/JAVA_HOME/)
    expect(plan.steps[1].env).toEqual({})
  })
})

describe('落盘的两件小事', () => {
  it('tauri.properties 三行齐全（首行注释是 CLI 的原样，保持一致免得 diff 吓人）', () => {
    const file = tempFile('tauri.properties')
    writeTauriProperties('0.9.0', file)
    const lines = fs.readFileSync(file, 'utf8').split('\n')
    expect(lines[0]).toContain('AUTOGENERATED')
    expect(lines[1]).toBe('tauri.android.versionName=0.9.0')
    expect(lines[2]).toBe('tauri.android.versionCode=9000')
  })

  it('找不到 .so 时直接报错，不把空 jniLibs 交给 gradle 打出一个装了会闪退的包', () => {
    const srcTauri = tempFile('src-tauri')
    const appDir = tempFile('app')
    expect(() => copySoToJniLibs({ targets: ['arm64'], profile: 'debug', libName: 'mindscape_canvas_lib', srcTauri, appDir })).toThrow(
      /cargo 步没产出/,
    )
  })

  it('产物在位时按 abi 目录落进去', () => {
    const srcTauri = fs.mkdtempSync(path.join(os.tmpdir(), 'mindscape-src-'))
    const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindscape-app-'))
    const dir = path.join(srcTauri, 'target', 'aarch64-linux-android', 'debug')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'libmindscape_canvas_lib.so'), 'fake', 'utf8')

    const written = copySoToJniLibs({ targets: ['arm64'], profile: 'debug', libName: 'mindscape_canvas_lib', srcTauri, appDir })
    expect(written).toEqual([path.join(appDir, 'src', 'main', 'jniLibs', 'arm64-v8a', 'libmindscape_canvas_lib.so')])
    expect(fs.readFileSync(written[0], 'utf8')).toBe('fake')
  })
})

describe('quoteForShell（Windows shell:true 下的参数转义）', () => {
  it('含空格的路径整块加引号（SDK 装 Program Files 时不被拆成两截）', () => {
    const zipalign = String.raw`C:\Program Files\Android\sdk\build-tools\35.0.0\zipalign.exe`
    expect(quoteForShell(zipalign)).toBe(`"${zipalign}"`)
  })

  it('无空白的普通参数原样不动，shell 元字符一律罩进引号', () => {
    expect(quoteForShell('pnpm')).toBe('pnpm')
    expect(quoteForShell('--ks-pass')).toBe('--ks-pass')
    expect(quoteForShell('env:MINDSCAPE_APK_STOREPASS')).toBe('env:MINDSCAPE_APK_STOREPASS')
    expect(quoteForShell('a>b')).toBe('"a>b"')
    // 仓库本身放在带空格的目录里时，产物路径也是参数
    const apk = String.raw`E:\My Projects\Mindscape\app-arm64-debug.apk`
    expect(quoteForShell(apk)).toBe(`"${apk}"`)
  })
})
