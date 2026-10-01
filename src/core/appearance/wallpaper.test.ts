// ============================================================================
// 模块说明（中文）
// wallpaper.ts 的单元测试（node 环境）。
// Tauri fs 插件与存储 provider 全部替身化（经可变对象间接传值，见
// settings-panel.test.ts 的同一手法），只考察流程：校验、先删后写、错误吞吐。
// ============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { APPEARANCE_DIR_NAME, wallpaperFileNameFor } from './wallpaper'

// ---- 可变替身容器（vi.mock 工厂够不着本文件的 let，经对象间接传值）----

const providerMock = {
  createDir: vi.fn(async () => undefined),
  deleteFile: vi.fn(async () => undefined),
  writeFileBytes: vi.fn(async () => 'C:\\fake\\written'),
}

const fsMock = {
  readFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
}

vi.mock('@/core/storage/LocalFolderProvider', () => ({
  // getter 间接引用：vi.mock 工厂会被提升到 const 声明之前，直接写 providerMock
  // 会在初始化前求值（TDZ）；属性访问发生在运行时，彼时替身已就绪
  get localStorageProvider() {
    return providerMock
  },
}))
vi.mock('@/core/storage/spacesFile', () => ({
  get getSpacesDir() {
    return vi.fn(async () => 'C:\\fake\\Mindscape')
  },
}))
vi.mock('@tauri-apps/plugin-fs', () => ({
  get readFile() {
    return (...args: unknown[]) => fsMock.readFile(...(args as []))
  },
}))

// 被测模块在 mock 声明之后动态引入，保证替身生效
const { loadWallpaperUrl, removeWallpaperFile, saveWallpaper } = await import('./wallpaper')

const PNG_BYTES = new Uint8Array([137, 80, 78, 71])

beforeEach(() => {
  providerMock.createDir.mockClear()
  providerMock.deleteFile.mockClear()
  providerMock.writeFileBytes.mockClear()
  fsMock.readFile.mockClear()
})

describe('wallpaperFileNameFor 落盘名推导', () => {
  it('保留原扩展名（webp 仍是 webp，不重编码）', () => {
    expect(wallpaperFileNameFor('海边日落.webp')).toBe('wallpaper.webp')
    expect(wallpaperFileNameFor('photo.PNG')).toBe('wallpaper.png')
  })

  it('非图片扩展名抛中文错误（与卡片同一份图片类型口径）', () => {
    expect(() => wallpaperFileNameFor('壁纸.pdf')).toThrow('背景图只支持')
  })
})

describe('saveWallpaper 保存流程', () => {
  it('建目录 → 删旧图 → 写新图，返回落盘文件名', async () => {
    const name = await saveWallpaper('wallpaper.jpg', 'new.png', PNG_BYTES)
    expect(providerMock.createDir).toHaveBeenCalledWith(`C:\\fake\\Mindscape\\${APPEARANCE_DIR_NAME}`)
    expect(providerMock.deleteFile).toHaveBeenCalledWith(`C:\\fake\\Mindscape\\${APPEARANCE_DIR_NAME}\\wallpaper.jpg`)
    expect(providerMock.writeFileBytes).toHaveBeenCalledWith(
      `C:\\fake\\Mindscape\\${APPEARANCE_DIR_NAME}`,
      'wallpaper.png',
      PNG_BYTES,
    )
    expect(name).toBe('wallpaper.png')
  })

  it('首次设置（无旧图）不触发删除', async () => {
    await saveWallpaper(null, 'x.jpg', PNG_BYTES)
    expect(providerMock.deleteFile).not.toHaveBeenCalled()
  })

  it('重选同名图也先删（防 writeFileBytes 重名加 _1 后缀）', async () => {
    await saveWallpaper('wallpaper.png', '另一张.png', PNG_BYTES)
    expect(providerMock.deleteFile).toHaveBeenCalledWith(
      expect.stringContaining('wallpaper.png'),
    )
  })

  it('空文件与超 20MB 拒收（中文报错，不碰磁盘）', async () => {
    await expect(saveWallpaper(null, 'a.png', new Uint8Array())).rejects.toThrow('空')
    await expect(saveWallpaper(null, 'a.png', new Uint8Array(20 * 1024 * 1024 + 1))).rejects.toThrow(
      '20MB',
    )
    expect(providerMock.writeFileBytes).not.toHaveBeenCalled()
  })
})

describe('removeWallpaperFile 清理', () => {
  it('null 直接返回；删除失败静默吞掉（残留文件无害）', async () => {
    await removeWallpaperFile(null)
    expect(providerMock.deleteFile).not.toHaveBeenCalled()

    providerMock.deleteFile.mockRejectedValueOnce(new Error('文件被占用'))
    await expect(removeWallpaperFile('wallpaper.png')).resolves.toBeUndefined()
  })
})

describe('loadWallpaperUrl 读取', () => {
  it('读字节 → Blob → objectURL', async () => {
    const createObjectURL = vi.fn(() => 'blob:fake-url')
    vi.spyOn(URL, 'createObjectURL').mockImplementation(createObjectURL)
    const url = await loadWallpaperUrl('wallpaper.png')
    expect(fsMock.readFile).toHaveBeenCalledWith(
      `C:\\fake\\Mindscape\\${APPEARANCE_DIR_NAME}\\wallpaper.png`,
    )
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(url).toBe('blob:fake-url')
    vi.restoreAllMocks()
  })

  it('文件不存在 / 读不了 → null（上层回落无图状态）', async () => {
    fsMock.readFile.mockRejectedValueOnce(new Error('不存在'))
    expect(await loadWallpaperUrl('wallpaper.png')).toBeNull()
  })
})
