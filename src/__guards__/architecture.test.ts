// ============================================================================
// 模块说明（中文）
// 架构守卫测试 —— 把「此前只写在文档与注释里的约定」变成**会自动失败的测试**。
// 对应 17.3 / 17.11 的架构红线、AGENTS.md 的代码约定。实现任务：P1-1。
//
// 为什么需要它：约定没有反馈渠道时，违反只会以「半年后人工 review 才发现」的形式暴露。
// 这里用 vitest 的 node 环境直接读源码做静态检查（**零新依赖**，不渲染任何 UI），
// 任何人（含 AI 会话）加功能踩线时 `pnpm test` 立刻红。
//
// 六条规则：
//   1. 大文件行数只减不增（棘轮阈值）
//   2. window.confirm / alert / prompt 只许出现在 core/utils/nativeDialogs.ts
//   3. 不得硬编码配色（Tailwind 调色板类名 / hex / rgb()）
//   4. core 层只允许 import core 与自己（白名单；2026-09-14 由黑名单改来）
//   5. 模块之间不得循环依赖
//   6. 新增源文件必须带同名测试（存量用豁免清单锁定，只减不增）
//
// 改动阈值或豁免清单**必须显式改本文件** —— 这正是目的：让「这次破例」留下记录。
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/** src/ 绝对路径（本文件位于 src/__guards__/ 下） */
const SRC_DIR = fileURLToPath(new URL('..', import.meta.url))
/** 仓库根目录，用于把绝对路径转成稳定的相对路径 */
const ROOT_DIR = path.resolve(SRC_DIR, '..')

const rel = (file: string): string => path.relative(ROOT_DIR, file).replace(/\\/g, '/')

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) listFiles(full, out)
    else out.push(full)
  }
  return out
}

const read = (file: string): string => fs.readFileSync(file, 'utf8')
/** 行数口径：`\r?\n` 切分后的段数（不受行尾风格影响） */
const lineCount = (file: string): number => read(file).split(/\r?\n/).length

/** 逐行产出 `{ no, text }`，并剔除整行注释（注释里的示例不该被当成违规） */
function codeLines(file: string): { no: number; text: string }[] {
  return read(file)
    .split(/\r?\n/)
    .map((text, index) => ({ no: index + 1, text }))
    .filter(({ text }) => {
      const trimmed = text.trimStart()
      return !(trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*'))
    })
}

const ALL_FILES = listFiles(SRC_DIR)
/** 待检源文件：排除测试、类型声明 */
const SOURCE_FILES = ALL_FILES.filter(
  (file) => /\.(ts|tsx)$/.test(file) && !/\.test\.(ts|tsx)$/.test(file) && !/\.d\.ts$/.test(file),
)
const TEST_FILES = ALL_FILES.filter((file) => /\.test\.(ts|tsx)$/.test(file))

// ---------------------------------------------------------------------------
// 规则 1：大文件行数只减不增
// ---------------------------------------------------------------------------

/**
 * 阈值就是「当前实际行数」。下调随时欢迎；上调必须显式改这里，
 * 也就是必须在提交说明里解释「为什么这个文件又要变长」。
 * Board / Canvas 是全项目最大的两个文件，继续膨胀会显著抬高每次改动的风险。
 */
const FILE_SIZE_BUDGET: Record<string, number> = {
  // P1-3（2026-09-12）：搜索接线（hook 调用 + 浮层 JSX + Canvas 三个 props）约 +40 行；
  // 可拆的状态逻辑已抽进 core/hooks/useCardSearch.ts
  // 便签行内编辑（2026-09-13，用户要求）：弹窗版 handleEditNoteCard 换成 handleCommitNote +
  // 菜单「备注」对便签改走 beginNoteEdit，净 +6 行
  // 「未分类」规则调整（2026-09-13，用户要求）：不再创建物理「未分类」文件夹，
  // 未分组文件直接落空间主目录——菜单项改写 + 过滤条件与注释更新，净 +5 行
  // 跨应用剪贴板互通（2026-09-13，用户批准 clipboard-win）：外部文件导入抽公共端
  // ingestExternalFiles（拖入/粘贴共用）+ pasteExternalFiles + handleCopyCards
  // 写系统剪贴板 + Ctrl+V 外部分支，净 +79 行
  // 粘贴净化接线（2026-09-13，用户裁决）：cardWithoutEditables 调用 + 注释，净 +3 行
  'src/pages/Board.tsx': 2117,
  // P1-3（2026-09-12）：计划要求 Ctrl+F 快捷键分支放在画布侧 + 搜索高亮 props + CardView 状态，
  // 均属「画布交互入口」的固有职责，约 +28 行
  // P1-4（2026-09-12）：Ctrl+Shift+0 快捷键分支 + 状态条「适应内容」按钮，约 +21 行
  // 快捷键组合键调整（2026-09-13，用户实测）：本机 Ctrl+Shift+0 被输入法/系统吞掉
  // （数字 0 的 keydown 不送达应用，代码层无法绕过），主组合键改 Ctrl+Alt+0；
  // 匹配逻辑抽到 interaction/zoomKeys.ts（纯函数 + 单测），Canvas 侧只留一行调用，行数持平
  // 便签行内编辑（2026-09-13，用户要求）：editingNoteId 状态 + beginNoteEdit API +
  // dblclick 分支 + 编辑结束回调转发，约 +25 行（替代了 Board 的弹窗逻辑）
  // 便签编辑态选字 + 四向缩放（2026-09-13，用户要求）：编辑态早退分支 +
  // resizeSource 增加位置读写通道 + delegate 传位置 + edge 手柄分流，净 +32 行
  // （核心逻辑已在 cardResizeController.edgeResizeOutcome，此处只是接线）
  'src/canvas/Canvas.tsx': 1192,
}

describe('规则 1：大文件行数只减不增', () => {
  for (const [file, budget] of Object.entries(FILE_SIZE_BUDGET)) {
    it(`${file} 不超过 ${budget} 行`, () => {
      const absolute = path.join(ROOT_DIR, file)
      expect(fs.existsSync(absolute), `${file} 已不存在，阈值表过期，请更新本文件`).toBe(true)
      const current = lineCount(absolute)
      expect(
        current,
        `${file} 已涨到 ${current} 行（阈值 ${budget}）：先把改动拆出去，或显式上调阈值并说明原因。`,
      ).toBeLessThanOrEqual(budget)
    })
  }
})

// ---------------------------------------------------------------------------
// 规则 2：原生弹窗只能从唯一出口调用
// ---------------------------------------------------------------------------

const NATIVE_DIALOG_MODULE = 'src/core/utils/nativeDialogs.ts'
const NATIVE_DIALOG_CALL = /window\.(?:confirm|alert|prompt)\s*\(/

describe('规则 2：window.confirm / alert / prompt 只允许出现在 nativeDialogs.ts', () => {
  it('除唯一出口外，src 下没有任何原生弹窗调用', () => {
    const offenders: string[] = []
    for (const file of SOURCE_FILES) {
      if (rel(file) === NATIVE_DIALOG_MODULE) continue
      for (const { no, text } of codeLines(file)) {
        if (NATIVE_DIALOG_CALL.test(text)) offenders.push(`${rel(file)}:${no}`)
      }
    }
    expect(
      offenders,
      '原生弹窗必须走 core/utils/nativeDialogs.ts（桌面端 dialog 插件带标题与图标、' +
        '浏览器开发态回落原生 confirm/alert）；window.prompt 在 WebView2 里根本不存在，写了就是死代码。',
    ).toEqual([])
  })

  it('唯一出口存在，且两个函数都在', () => {
    const text = read(path.join(ROOT_DIR, NATIVE_DIALOG_MODULE))
    expect(text).toContain('export async function confirmDialog')
    expect(text).toContain('export async function alertDialog')
  })
})

// ---------------------------------------------------------------------------
// 规则 3：配色只走语义 token
// ---------------------------------------------------------------------------

/** Tailwind 内置调色板类名（bg-white / text-black / bg-gray-500 …） */
const PALETTE_CLASS =
  /\b(?:bg|text|border|ring|outline|fill|stroke|from|via|to|divide|decoration|accent|caret)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{1,3})?\b/
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/

/**
 * 规则 3 的豁免：hex / rgb() 只允许出现在「数据本身」与「canvas 2D 绘制」两类位置。
 * 组件里写死颜色会绕过主题变量，深色模式下必然花掉。
 */
const RAW_COLOR_ALLOWLIST: Record<string, string> = {
  'src/core/board/partitions.ts': '分区调色板：8 个 hex 是给用户挑的数据，不是组件样式',
  'src/canvas/MiniMap.tsx': 'canvas 2D 的 fillStyle 只能收具体颜色；hex 是读不到 CSS 变量时的兜底',
  'src/plugins/demoPlugin.ts': '示例插件的默认分区色，属数据默认值',
}

describe('规则 3：不得硬编码配色', () => {
  it('className 里不出现 Tailwind 内置调色板类名', () => {
    const offenders: string[] = []
    for (const file of SOURCE_FILES) {
      for (const { no, text } of codeLines(file)) {
        if (PALETTE_CLASS.test(text)) offenders.push(`${rel(file)}:${no}`)
      }
    }
    expect(
      offenders,
      '请用语义 token：bg-background / text-foreground / bg-muted / border-border / text-destructive …',
    ).toEqual([])
  })

  it('hex 与 rgb()/hsl() 只出现在豁免清单里', () => {
    const offenders: string[] = []
    for (const file of SOURCE_FILES) {
      if (RAW_COLOR_ALLOWLIST[rel(file)]) continue
      for (const { no, text } of codeLines(file)) {
        if (RAW_COLOR.test(text)) offenders.push(`${rel(file)}:${no}`)
      }
    }
    expect(offenders, '颜色要么走语义 token，要么进本文件的 RAW_COLOR_ALLOWLIST 并写明原因').toEqual([])
  })

  it('豁免清单没有过期条目', () => {
    for (const file of Object.keys(RAW_COLOR_ALLOWLIST)) {
      expect(fs.existsSync(path.join(ROOT_DIR, file)), `${file} 已不存在，请从豁免清单移除`).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// 规则 4：core 层只允许依赖 core 与自己（白名单）
// ---------------------------------------------------------------------------

/** 去掉块注释，避免注释里的示例 import 被计入检查 */
const stripBlockComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '')

/** 把 import 说明符解析成仓库内的真实文件；外部包与无法解析的返回 null */
function resolveImport(fromFile: string, specifier: string): string | null {
  let target: string
  if (specifier.startsWith('@/')) target = path.join(SRC_DIR, specifier.slice(2))
  else if (specifier.startsWith('.')) target = path.resolve(path.dirname(fromFile), specifier)
  else return null

  for (const candidate of [
    `${target}.ts`,
    `${target}.tsx`,
    path.join(target, 'index.ts'),
    path.join(target, 'index.tsx'),
    target,
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return null
}

/**
 * 抽出文件里全部 `import/export … from 'x'` 的说明符并带上行号。
 * 用 matchAll 而非逐行正则 —— **跨行 import**
 * （`import {\n  a,\n} from '@/core/x'`）在逐行写法下会被整段漏掉。
 */
function importSpecifiers(file: string): { specifier: string; line: number }[] {
  const text = stripBlockComments(read(file))
  const out: { specifier: string; line: number }[] = []
  for (const matched of text.matchAll(
    /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?[\s\S]*?from\s*'([^']+)'/g,
  )) {
    const index = matched.index ?? 0
    out.push({ specifier: matched[1], line: text.slice(0, index).split('\n').length })
  }
  return out
}

/**
 * 一个 import 说明符在 `core/` 内是否合法（纯函数，可单测）。
 *
 * 白名单三类：
 *   1. `@/core/**` —— core 内部
 *   2. 相对路径，且解析后仍落在 `src/core/` 内
 *   3. 外部包（不以 `@/` 开头、不以 `.` 开头的说明符，如 react / zod / @tauri-apps/*）
 */
function isAllowedCoreSpecifier(fromFile: string, specifier: string): boolean {
  if (specifier.startsWith('@/')) return specifier.startsWith('@/core/')
  if (!specifier.startsWith('.')) return true
  const resolved = resolveImport(fromFile, specifier)
  return resolved !== null && rel(resolved).startsWith('src/core/')
}

/**
 * 为什么从黑名单改成白名单（2026-09-14，对应审查报告 §5.7）：
 * 旧写法 `CORE_FORBIDDEN_IMPORT = /from\s+'@\/(?:canvas|pages|components|plugins|lib)\//`
 * 只禁止 5 个**已知**目录 —— 任何新增的顶层目录都能绕过去：
 * 计划中的 `src/platform/`（桌面平台桥）一旦建立，core 里写
 * `import { toAssetUrl } from '@/platform/asset'` 就不会被拦下，
 * 而核心规约是「core 不依赖任何运行时平台细节」。插件期目录只会更多，这个洞会张开。
 *
 * 白名单的代价是：新增「core 允许依赖的顶层目录」必须**显式改本文件**——
 * 这正是想要的效果，让「这次破例」留下记录。
 */
describe('规则 4：core 只能依赖 core 与自己（白名单）', () => {
  it('src/core 下没有指向 core 之外的 import', () => {
    const offenders: string[] = []
    for (const file of SOURCE_FILES) {
      if (!rel(file).startsWith('src/core/')) continue
      for (const { specifier, line } of importSpecifiers(file)) {
        if (!isAllowedCoreSpecifier(file, specifier)) {
          offenders.push(`${rel(file)}:${line} → ${specifier}`)
        }
      }
    }
    expect(
      offenders,
      'core 是最内层，只允许 import @/core/** 或 core 内的相对路径（外部包不限）。' +
        '需要坐标 / 平台能力就下沉到 core，别反向 import 上层；确实要放开某个顶层目录，请显式修改本文件的规则 4。',
    ).toEqual([])
  })

  it('白名单判定器本身正确（含「旧黑名单拦不住」的定点用例）', () => {
    const coreFile = path.join(SRC_DIR, 'core/board/ingest.ts')

    // 1) core 内部：@/ 与相对路径都放行
    expect(isAllowedCoreSpecifier(coreFile, '@/core/types')).toBe(true)
    expect(isAllowedCoreSpecifier(coreFile, './grid')).toBe(true)
    expect(isAllowedCoreSpecifier(coreFile, '@/core/utils/paths')).toBe(true)

    // 2) 外部包放行
    expect(isAllowedCoreSpecifier(coreFile, 'react')).toBe(true)
    expect(isAllowedCoreSpecifier(coreFile, '@tauri-apps/api/core')).toBe(true)

    // 3) 上层目录：@/ 与非 core 相对路径都拦下
    expect(isAllowedCoreSpecifier(coreFile, '@/canvas/Canvas')).toBe(false)
    expect(isAllowedCoreSpecifier(coreFile, '@/pages/Board')).toBe(false)
    expect(isAllowedCoreSpecifier(path.join(SRC_DIR, 'core/types.ts'), '../canvas/Canvas')).toBe(
      false,
    )

    // 4) 关键回归：旧黑名单只列了 5 个目录，这两个**新增**顶层目录它拦不住
    expect(isAllowedCoreSpecifier(coreFile, '@/platform/asset')).toBe(false)
    expect(isAllowedCoreSpecifier(coreFile, '@/anything-new/whatever')).toBe(false)

    // 5) 无法解析的相对路径也拦下（防拼错路径后静默通过）
    expect(isAllowedCoreSpecifier(coreFile, './nope-not-exist')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 规则 5：模块之间不得循环依赖
// ---------------------------------------------------------------------------

// `resolveImport` / `stripBlockComments` 定义在规则 4 一节（规则 4、5 共用）。

/**
 * 建立模块依赖图。跨行 import 也能匹配（正则跨行非贪婪），
 * 但**跳过 `import type`** —— 纯类型导入不产生运行时边，类型层面的循环无害。
 * 注：动态 `import()` 不产生静态边，本规则不覆盖。
 */
function buildImportGraph(files: string[]): Map<string, string[]> {
  const known = new Set(files)
  const graph = new Map<string, string[]>()
  for (const file of files) {
    const text = stripBlockComments(read(file))
    const deps = new Set<string>()
    for (const matched of text.matchAll(
      /(?:^|\n)\s*(?:import|export)\s+(type\s+)?[\s\S]*?from\s*'([^']+)'/g,
    )) {
      if (matched[1]) continue
      const resolved = resolveImport(file, matched[2])
      if (resolved && known.has(resolved)) deps.add(resolved)
    }
    graph.set(file, [...deps])
  }
  return graph
}

/** 找出依赖图中的全部环（DFS + 递归栈）。纯函数，可用构造图单测 */
function findCycles(graph: Map<string, string[]>): string[][] {
  const cycles: string[][] = []
  const state = new Map<string, 'visiting' | 'done'>()
  const stack: string[] = []

  const visit = (node: string): void => {
    state.set(node, 'visiting')
    stack.push(node)
    for (const dependency of graph.get(node) ?? []) {
      if (state.get(dependency) === 'visiting') {
        cycles.push([...stack.slice(stack.indexOf(dependency)), dependency])
      } else if (!state.has(dependency)) {
        visit(dependency)
      }
    }
    stack.pop()
    state.set(node, 'done')
  }

  for (const node of graph.keys()) if (!state.has(node)) visit(node)
  return cycles
}

describe('规则 5：模块之间不得循环依赖', () => {
  const graph = buildImportGraph(SOURCE_FILES)

  it('依赖图确实建起来了（防止解析器静默失效而永远报告「0 个环」）', () => {
    const edgeCount = [...graph.values()].reduce((sum, deps) => sum + deps.length, 0)
    expect(edgeCount, '解析出的 import 边数过少，说明 resolveImport 可能坏了').toBeGreaterThan(150)
    // 抽两条已知边做定点校验
    const ingestDeps = (graph.get(path.join(SRC_DIR, 'core/board/ingest.ts')) ?? []).map(rel)
    expect(ingestDeps).toContain('src/core/utils/paths.ts')
    const spaceListDeps = (graph.get(path.join(SRC_DIR, 'pages/SpaceList.tsx')) ?? []).map(rel)
    expect(spaceListDeps).toContain('src/core/utils/nativeDialogs.ts')
  })

  it('环检测器本身正确（构造图）', () => {
    expect(findCycles(new Map([['a', ['b']], ['b', ['a']]]))).toHaveLength(1)
    expect(findCycles(new Map([['a', ['b']], ['b', ['c']], ['c', []]]))).toHaveLength(0)
    expect(findCycles(new Map([['a', ['a']]]))).toHaveLength(1)
  })

  it('src 下的真实依赖图无环', () => {
    const cycles = findCycles(graph).map((cycle) => cycle.map(rel).join(' -> '))
    expect(cycles, '出现循环依赖：请把公共部分下沉，别让两个模块互相 import').toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 规则 6：新增源文件必须带同名测试
// ---------------------------------------------------------------------------

/**
 * 存量豁免清单（文件 → 原因），**只减不增**：
 *   · 新增文件要么补同名测试，要么在这里登记并写明原因 ——
 *     让「这个文件没测试」变成一个被记录过的决定，而不是悄悄混进来。
 *   · 退出路径只有两条：补测试，或删文件后删除本条目。
 */
const UNTESTED_ALLOWLIST: Record<string, string> = {
  // —— 渲染层：需要 DOM 环境，而本项目不引入 jsdom（用户裁决）。
  //    观感与交互由无头浏览器 / 真机验证，不做单元测试。
  'src/App.tsx': '渲染层入口',
  'src/main.tsx': '渲染层入口',
  'src/canvas/Canvas.tsx': '渲染层',
  'src/canvas/Card.tsx': '渲染层',
  'src/canvas/Connection.tsx': '渲染层',
  'src/canvas/FpsMeter.tsx': '渲染层',
  'src/canvas/MiniMap.tsx': '渲染层',
  'src/canvas/Partition.tsx': '渲染层',
  'src/canvas/Selection.tsx': '渲染层',
  'src/canvas/SnapGuide.tsx': '渲染层',
  'src/canvas/Viewport.tsx': '渲染层',
  'src/components/ui/button.tsx': '渲染层（shadcn 生成物）',
  'src/components/ui/context-menu.tsx': '渲染层（shadcn 生成物）',
  'src/components/ui/card-search.tsx': '渲染层（搜索逻辑在 core/board/search.ts 已测）',
  'src/components/ui/floating-modal.tsx': '渲染层（几何计算抽到 floatingModalGeometry.ts 已测）',
  'src/components/ui/icons.tsx': '渲染层（纯 SVG 字形）',
  'src/components/ui/modal.tsx': '渲染层',
  'src/components/ui/prompt-dialog.tsx': '渲染层',
  'src/components/ui/settings-panel.tsx': '渲染层',
  'src/components/ui/settings-shortcuts.tsx': '渲染层（键位匹配/冲突检测在 core/shortcuts/keys.ts 已测）',
  'src/components/ui/settings-update.tsx': '渲染层（版本状态在 core/store/updaterStore.ts 已测）',
  'src/components/ui/update-dialog.tsx': '渲染层',
  'src/pages/Board.tsx': '渲染层',
  'src/pages/DesktopRequired.tsx': '渲染层',
  'src/pages/SpaceList.tsx': '渲染层',
  'src/lib/utils.ts': 'shadcn 的 cn() 包装，无自有逻辑',
  'src/plugins/index.ts': '插件目录占位（第一版无实现）',

  // —— 待补测试的存量模块：不属渲染层，理论上可测，只是还没写。
  //    目标是逐步清零，新增文件不再走这条口子。
  'src/canvas/viewportSnapshot.ts': '待补测试（存量）',
  'src/core/board/ingest.ts': '待补测试（存量）',
  'src/core/commands/impl/connections.ts': '待补测试（存量）',
  'src/core/commands/impl/movePartitions.ts': '待补测试（存量）',
  'src/core/commands/impl/resizeCards.ts': '待补测试（存量）',
  'src/core/commands/impl/setCardMeta.ts': '待补测试（存量）',
  'src/core/commands/impl/setCardNote.ts': '待补测试（存量）',
  'src/core/commands/impl/setCardsZIndex.ts': '待补测试（存量）',
  'src/core/commands/impl/setPartitionColor.ts': '待补测试（存量）',
  'src/core/commands/types.ts': '待补测试（存量，纯类型）',
  'src/core/hooks/useTheme.ts': '待补测试（存量）',
  'src/core/hooks/useCardSearch.ts': 'React 胶水（纯逻辑在 core/board/search.ts 已测）',
  'src/core/registry/actionRegistry.ts': '待补测试（存量）',
  'src/core/storage/StorageProvider.ts': '待补测试（存量，接口声明为主）',
  'src/core/utils/media.ts': '待补测试（存量）',
}

/** 同名测试的判定：`xxx.ts` / `xxx.tsx` ↔ `xxx.test.ts` / `xxx.test.tsx` */
const hasSiblingTest = (file: string): boolean => {
  const base = file.replace(/\.(ts|tsx)$/, '')
  return TEST_FILES.some((test) => test === `${base}.test.ts` || test === `${base}.test.tsx`)
}

describe('规则 6：新增源文件必须带同名测试', () => {
  it('每个源文件要么有同名测试，要么在豁免清单里', () => {
    const offenders = SOURCE_FILES.filter(
      (file) => !hasSiblingTest(file) && !UNTESTED_ALLOWLIST[rel(file)],
    ).map(rel)
    expect(
      offenders,
      '新增模块请补同名测试（*.test.ts 与被测模块同目录）；确实不测的，写进 UNTESTED_ALLOWLIST 并说明原因。',
    ).toEqual([])
  })

  it('豁免清单没有过期条目（文件仍在且仍无测试）', () => {
    const stale: string[] = []
    for (const file of Object.keys(UNTESTED_ALLOWLIST)) {
      const absolute = path.join(ROOT_DIR, file)
      if (!fs.existsSync(absolute)) stale.push(`${file}（文件已不存在）`)
      else if (hasSiblingTest(absolute)) stale.push(`${file}（已有同名测试）`)
    }
    expect(stale, '这些条目已经没用了，请从 UNTESTED_ALLOWLIST 删除').toEqual([])
  })
})
