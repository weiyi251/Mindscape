// ============================================================================
// 模块说明（中文）
// appearanceStore 的单元测试（node 环境）。
// store 是模块级单例，用 vi.resetModules + 动态 import 隔离用例间状态；
// document / localStorage / 壁纸读盘全部替身化，只考察行为口径。
// ============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GLASS_DEFAULTS } from './glassTypes'

// ---- 替身 ----

const cssWritten: Record<string, string> = {}
const wallpaperMock = {
  // 返回类型如实标注 string | null：loadWallpaperUrl 的真实契约（文件没了 → null）
  loadWallpaperUrl: vi.fn(async (fileName: string): Promise<string | null> =>
    fileName === '' ? null : 'blob:fake',
  ),
  removeWallpaperFile: vi.fn(async () => undefined),
}

vi.mock('./wallpaper', () => ({
  loadWallpaperUrl: (...args: unknown[]) =>
    wallpaperMock.loadWallpaperUrl(...(args as [string])),
  removeWallpaperFile: (...args: unknown[]) => wallpaperMock.removeWallpaperFile(...(args as [])),
}))

/** document 与 localStorage 桩（store 的 setGlass 会写 CSS 变量与偏好） */
function installDom(): Map<string, string> {
  const backing = new Map<string, string>()
  ;(globalThis as { document?: unknown }).document = {
    documentElement: {
      style: {
        setProperty: (name: string, value: string) => {
          cssWritten[name] = value
        },
      },
    },
  }
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => ({
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => void backing.set(key, value),
    }),
  })
  return backing
}

/** 每个用例拿一份全新的 store（模块级单例 → resetModules + 动态 import） */
async function freshStore() {
  vi.resetModules()
  const mod = await import('./appearanceStore')
  return mod.useAppearanceStore
}

beforeEach(() => {
  installDom()
  wallpaperMock.loadWallpaperUrl.mockClear()
  wallpaperMock.removeWallpaperFile.mockClear()
})

describe('appearanceStore', () => {
  it('初始状态 = localStorage 里没有存档时的默认外观', async () => {
    const useStore = await freshStore()
    expect(useStore.getState().glass).toEqual(GLASS_DEFAULTS)
    expect(useStore.getState().bgUrl).toBeNull()
  })

  it('setGlass 合并部分参数：state、CSS 变量、localStorage 三处同步', async () => {
    const backing = installDom()
    const useStore = await freshStore()

    useStore.getState().setGlass({ alpha: 0.4, blurPx: 30 })

    const glass = useStore.getState().glass
    expect(glass.alpha).toBe(0.4)
    expect(glass.blurPx).toBe(30)
    // 未提及的字段保持原值（合并而非替换）
    expect(glass.saturate).toBe(GLASS_DEFAULTS.saturate)
    expect(cssWritten['--glass-alpha']).toBe('0.4')
    expect(cssWritten['--glass-blur']).toBe('30px')
    expect(backing.get('mindscape-appearance')).toContain('"alpha":0.4')
  })

  it('setGlass 只改玻璃参数时不触发背景图重新读盘', async () => {
    const useStore = await freshStore()
    useStore.getState().setGlass({ alpha: 0.5 })
    expect(wallpaperMock.loadWallpaperUrl).not.toHaveBeenCalled()
  })

  it('setGlass 设置背景文件名后自动读盘换 URL', async () => {
    const useStore = await freshStore()

    useStore.getState().setGlass({ bgFileName: 'wallpaper.png' })
    await vi.waitFor(() => expect(useStore.getState().bgUrl).toBe('blob:fake'))
    expect(wallpaperMock.loadWallpaperUrl).toHaveBeenCalledWith('wallpaper.png')
  })

  it('清除背景（bgFileName → null）不读盘，bgUrl 回到 null', async () => {
    const useStore = await freshStore()
    useStore.getState().setGlass({ bgFileName: 'wallpaper.png' })
    await vi.waitFor(() => expect(useStore.getState().bgUrl).toBe('blob:fake'))

    useStore.getState().setGlass({ bgFileName: null })
    await vi.waitFor(() => expect(useStore.getState().bgUrl).toBeNull())
    expect(wallpaperMock.loadWallpaperUrl).toHaveBeenCalledTimes(1)
  })

  it('refreshWallpaper 读盘返回 null（文件没了）时回落无图', async () => {
    const useStore = await freshStore()
    wallpaperMock.loadWallpaperUrl.mockResolvedValueOnce(null)
    useStore.getState().setGlass({ bgFileName: 'wallpaper.png' })
    await vi.waitFor(() => expect(useStore.getState().bgUrl).toBeNull())
  })

  it('恢复默认：删壁纸文件、配置全回默认、背景清空', async () => {
    const useStore = await freshStore()
    useStore.getState().setGlass({ alpha: 0.3, bgFileName: 'wallpaper.png' })
    await vi.waitFor(() => expect(useStore.getState().bgUrl).not.toBeNull())

    await useStore.getState().resetGlass()

    expect(wallpaperMock.removeWallpaperFile).toHaveBeenCalledWith('wallpaper.png')
    expect(useStore.getState().glass).toEqual(GLASS_DEFAULTS)
    await vi.waitFor(() => expect(useStore.getState().bgUrl).toBeNull())
  })

  it('refreshWallpaper 的竞态防护：读盘期间文件名变了就丢弃结果', async () => {
    const useStore = await freshStore()
    // 一次「慢读盘」：期间把文件名换成 null
    let release!: (url: string) => void
    wallpaperMock.loadWallpaperUrl.mockImplementationOnce(
      () => new Promise<string>((resolve) => (release = resolve)),
    )
    useStore.getState().setGlass({ bgFileName: 'wallpaper.png' })
    useStore.getState().setGlass({ bgFileName: null })
    release('blob:late')
    // 慢结果被丢弃：最终无图；晚到的 URL 也已被回收（此处只验状态不被覆盖）
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(wallpaperMock.loadWallpaperUrl).toHaveBeenCalledTimes(1)
    expect(useStore.getState().bgUrl).toBeNull()
  })
})
