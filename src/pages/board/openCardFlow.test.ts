// ============================================================================
// 模块说明（中文）
// openCardFlow.ts 的单元测试：三种卡片类型的路径口径、打开成功的静默、
// 以及「降级到文件管理器定位」的平台能力分支（移动端不得调用 reveal）
// 和 M4 的移动端总线（openWithSystemApp=false 时整条通道不该被触发）。
// 依赖全部用假件注入，node 环境可测。
// ============================================================================

import { afterEach, describe, expect, it, vi } from 'vitest'

import { OPEN_CARD_TEXT, openCardExternally } from './openCardFlow'
import type { OpenCardDeps } from './openCardFlow'
import { zCardSchema } from '@/core/types'
import type { Card } from '@/core/types'

/** 安卓 WebView 的 UA（与 core/system/platformCapabilities.test.ts 同一份） */
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; M2012K11AC Build/UKQ1) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36'

function makeCard(type: Card['type'], filePath: string): Card {
  return zCardSchema.parse({
    id: 'c1',
    type,
    filePath,
    originalPath: filePath,
    x: 0,
    y: 0,
    w: 220,
    h: 220,
  })
}

function makeDeps(overrides: Partial<OpenCardDeps> = {}) {
  const errors: string[] = []
  const deps: OpenCardDeps = {
    spaceFolder: 'D:\\space',
    originalPathOf: () => 'D:\\elsewhere\\ref-01.jpg',
    openWithDefault: vi.fn(async () => {}),
    revealInExplorer: vi.fn(async () => {}),
    canRevealInExplorer: true,
    onError: (message: string) => {
      errors.push(message)
    },
    ...overrides,
  }
  return { deps, errors }
}

describe('openCardExternally 路径口径', () => {
  it('未打开空间：静默返回，不碰任何 IO', async () => {
    const { deps, errors } = makeDeps({ spaceFolder: null })
    const openWithDefault = deps.openWithDefault as ReturnType<typeof vi.fn>

    await openCardExternally(makeCard('file', 'a.pdf'), deps)

    expect(openWithDefault).not.toHaveBeenCalled()
    expect(errors).toEqual([])
  })

  it('image 卡用资源表里的原图绝对路径（不是空间内的相对路径）', async () => {
    const { deps } = makeDeps()
    const openWithDefault = deps.openWithDefault as ReturnType<typeof vi.fn>

    await openCardExternally(makeCard('image', '参考资料/ref-01.jpg'), deps)

    expect(openWithDefault).toHaveBeenCalledWith('D:\\elsewhere\\ref-01.jpg')
  })

  it('file 卡用「空间文件夹 + 相对路径」', async () => {
    const { deps } = makeDeps()
    const openWithDefault = deps.openWithDefault as ReturnType<typeof vi.fn>

    await openCardExternally(makeCard('file', 'a.pdf'), deps)

    expect(openWithDefault).toHaveBeenCalledWith('D:\\space\\a.pdf')
  })

  it('便签没有文件：只提示，不尝试打开', async () => {
    const { deps, errors } = makeDeps()
    const openWithDefault = deps.openWithDefault as ReturnType<typeof vi.fn>

    await openCardExternally(makeCard('note', ''), deps)

    expect(openWithDefault).not.toHaveBeenCalled()
    expect(errors).toEqual([OPEN_CARD_TEXT.noteHasNoFile])
  })

  it('image 卡原图路径未登记（空串）时同样按「无文件」提示', async () => {
    const { deps, errors } = makeDeps({ originalPathOf: () => '' })

    await openCardExternally(makeCard('image', 'gone.jpg'), deps)

    expect(errors).toEqual([OPEN_CARD_TEXT.noteHasNoFile])
  })

  it('打开成功时完全静默', async () => {
    const { deps, errors } = makeDeps()
    const revealInExplorer = deps.revealInExplorer as ReturnType<typeof vi.fn>

    await openCardExternally(makeCard('file', 'a.pdf'), deps)

    expect(revealInExplorer).not.toHaveBeenCalled()
    expect(errors).toEqual([])
  })
})

describe('打开失败后的降级（平台能力 revealInExplorer）', () => {
  it('桌面：降级到「在资源管理器中定位」并提示定位成功', async () => {
    const { deps, errors } = makeDeps({
      openWithDefault: vi.fn(async () => {
        throw new Error('打开失败：没有关联程序')
      }),
    })
    const revealInExplorer = deps.revealInExplorer as ReturnType<typeof vi.fn>

    await openCardExternally(makeCard('file', 'a.pdf'), deps)

    expect(revealInExplorer).toHaveBeenCalledWith('D:\\space\\a.pdf')
    expect(errors).toEqual([OPEN_CARD_TEXT.revealedInExplorer])
  })

  it('移动端：不调用 reveal（Android 没有文件管理器定位），如实报出打开失败的原因', async () => {
    const { deps, errors } = makeDeps({
      canRevealInExplorer: false,
      openWithDefault: vi.fn(async () => {
        // Rust 侧抛的是裸中文字符串，不是 Error
        throw '打开失败：没有关联程序'
      }),
    })
    const revealInExplorer = deps.revealInExplorer as ReturnType<typeof vi.fn>

    await openCardExternally(makeCard('file', 'a.pdf'), deps)

    expect(revealInExplorer).not.toHaveBeenCalled()
    expect(errors).toEqual(['打开失败：没有关联程序'])
  })

  it('桌面：连定位也失败时报定位的错误（不吞掉、不谎报已定位）', async () => {
    const { deps, errors } = makeDeps({
      openWithDefault: vi.fn(async () => {
        throw new Error('打开失败：没有关联程序')
      }),
      revealInExplorer: vi.fn(async () => {
        throw new Error('定位失败：路径不存在')
      }),
    })

    await openCardExternally(makeCard('file', 'a.pdf'), deps)

    expect(errors).toEqual(['定位失败：路径不存在'])
  })
})

describe('移动端（M4）：「交给系统应用打开」整条通道断开', () => {
  // 上面所有用例都跑在「拿不到 UA = 桌面」的默认取值下，等于把桌面分支全过了一遍；
  // 这里只补移动端那条 —— 安卓上既没有 xdg-open，私有目录的文件外部应用也读不到。
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('双击进来的也一样拦下：只提示，不去 invoke 注定失败的命令', async () => {
    vi.stubGlobal('navigator', { userAgent: ANDROID_UA })
    const { deps, errors } = makeDeps()
    const openWithDefault = deps.openWithDefault as ReturnType<typeof vi.fn>
    const revealInExplorer = deps.revealInExplorer as ReturnType<typeof vi.fn>

    await openCardExternally(makeCard('image', '参考资料/ref-01.jpg'), deps)

    expect(openWithDefault).not.toHaveBeenCalled()
    expect(revealInExplorer).not.toHaveBeenCalled()
    expect(errors).toEqual([OPEN_CARD_TEXT.noSystemViewer])
  })
})
