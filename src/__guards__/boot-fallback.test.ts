// ============================================================================
// 模块说明（中文）
// 启动兜底页守卫 —— 锁住 `index.html` 里那段**内联**诊断脚本的两条性质。
// 对应移动端 M5 真机第一轮（2026-09-21）：联想模拟器（Android 9 / WebView = Chrome 68）
// 装得上、打不开，页面只给出 `Uncaught SyntaxError: Unexpected token ?`，
// 完全看不出「是内核太老」—— 排查靠的是把模拟器连上 adb 查 dumpsys 才定下来。
//
// 于是这段兜底脚本承担两个职责，都必须防回归：
//   1. 它自己得能在**任何**内核上跑起来（否则连报错都印不出来）→ 语法必须停在 ES5；
//   2. 它得把判定内核版本所需的证据（UA）和结论（低于门槛就明说）印在页面上。
//
// 环境：node（不引 jsdom）。做法是把内联脚本当文本读出来做静态检查。
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT_DIR = fileURLToPath(new URL('../..', import.meta.url))
const INDEX_HTML = path.join(ROOT_DIR, 'index.html')

/** 取 `index.html` 里所有**内联** script（带 src 的模块脚本不算，它本来就该是产物的语法档位） */
function inlineScripts(): string {
  const html = fs.readFileSync(INDEX_HTML, 'utf8')
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n')
}

/**
 * 注释里出现 `??` / 反引号是正常的（现有注释就在写 `message`），语法检查只看代码。
 * 串里的 `//` 会被这条正则误删，故新增字符串时别写 URL —— 内联脚本里本来也不该有。
 */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/**
 * `??`（空值合并）由 Chrome 76 引入，而产物里它有 160 处（React DOM 自己的代码），
 * 所以 76 是「JS 能不能解析」的硬底线。兜底页报的门槛不得低于它 ——
 * 再低就等于「内核已经跑不起来了，页面却说没问题」。
 */
const NULLISH_COALESCING_CHROME = 76

describe('启动兜底页（index.html 内联脚本）', () => {
  it('内联诊断脚本存在且非空', () => {
    expect(inlineScripts().length).toBeGreaterThan(200)
  })

  it('语法停在 ES5：不许出现老内核解析不了的写法', () => {
    const src = codeOnly(inlineScripts())
    for (const [name, re] of [
      ['?? / ??.=', /\?\?/],
      ['?.  可选链', /\?\./],
      ['=>  箭头函数', /=>/],
      ['`   模板字符串', /`/],
      ['#x  私有字段', /class[\s\S]{0,80}#[A-Za-z]/],
    ] as const) {
      const hit = src.match(re)
      expect(hit, `兜底页里出现了 ${name}，老 WebView 上连报错都印不出来`).toBeNull()
    }
  })

  it('把 UA 印出来 —— 「打不开」的反馈没有内核版本就无法定位', () => {
    expect(inlineScripts()).toContain('navigator.userAgent')
  })

  it('内核低于门槛时直接说明，而不是留一句 SyntaxError', () => {
    const src = inlineScripts()
    const declared = src.match(/MIN_CHROME\s*=\s*(\d+)/)
    expect(declared, '门槛常量被删了').not.toBeNull()
    expect(Number(declared?.[1])).toBeGreaterThanOrEqual(NULLISH_COALESCING_CHROME)
    expect(src).toContain('内核过旧')
  })
})
