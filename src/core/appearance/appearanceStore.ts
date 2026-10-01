// ============================================================================
// 模块说明（中文）
// 外观状态中心（Zustand）。消费方两处：
//   · 设置 → 外观页：滑杆 / 取色器 / 档位按钮 → setGlass（合并 + 持久化 + 即时生效）；
//   · AppearanceBackground 背景图层：订阅 bgUrl 渲染壁纸与遮罩。
//
// 【为什么是 store 而不是 theme.ts 式纯函数 + 手动调用】
//   外观参数在设置页被连续拖动，背景图层与（未来的）多处 UI 都要跟着变，
//   手动逐处通知必然漏；Zustand 订阅是项目既有模式（boardStore 等）。
//
// 【生效链路】setGlass = 归一化（glassTypes）→ saveGlassAppearance（localStorage）
//   → applyGlassToCss（CSS 变量即时写根元素，全界面同帧预览）→ set state。
//   CSS 变量是低频写入，不触碰 17.3「高频不进 state」红线。
//
// 【背景图 URL 生命周期】refreshWallpaper 按偏好文件名读盘换 objectURL；
//   旧 URL 与竞态结果都 revoke，防止内存里堆壁纸。文件本体操作全在
//   wallpaper.ts（本 store 只管「文件名 → URL」的映射）。
// ============================================================================

import { create } from 'zustand'

import { GLASS_DEFAULTS, normalizeGlassAppearance } from './glassTypes'
import type { GlassAppearance } from './glassTypes'
import { applyGlassToCss, loadGlassAppearance, saveGlassAppearance } from './glassAppearance'
import { loadWallpaperUrl, removeWallpaperFile } from './wallpaper'

export interface AppearanceState {
  /** 当前玻璃配置（已归一化，始终合法） */
  glass: GlassAppearance
  /** 背景图的 objectURL；null = 无背景（body 底色兜底） */
  bgUrl: string | null
  /** 合并部分配置：持久化 + CSS 变量即时生效；背景文件名变化自动刷新 bgUrl */
  setGlass(partial: Partial<GlassAppearance>): void
  /** 恢复默认：清掉壁纸文件与偏好，全部回到 GLASS_DEFAULTS */
  resetGlass(): Promise<void>
  /** 按 glass.bgFileName 重新加载背景（换图 / 清除 / 启动时都会走到） */
  refreshWallpaper(): Promise<void>
}

export const useAppearanceStore = create<AppearanceState>((set, get) => ({
  glass: loadGlassAppearance(),
  bgUrl: null,

  setGlass(partial) {
    const prev = get().glass
    const next = normalizeGlassAppearance({ ...prev, ...partial })
    saveGlassAppearance(next)
    applyGlassToCss(next)
    set({ glass: next })
    // 背景文件名变了（选图 / 换图 / 清除）→ 重新读盘换 URL；其余参数只动 CSS 变量
    if (next.bgFileName !== prev.bgFileName) void get().refreshWallpaper()
  },

  async resetGlass() {
    await removeWallpaperFile(get().glass.bgFileName)
    const next = normalizeGlassAppearance({ ...GLASS_DEFAULTS })
    saveGlassAppearance(next)
    applyGlassToCss(next)
    set({ glass: next })
    void get().refreshWallpaper()
  },

  async refreshWallpaper() {
    const fileName = get().glass.bgFileName
    const url = fileName === null ? null : await loadWallpaperUrl(fileName)
    // 竞态防护：读盘期间文件名又变了 → 丢弃本次结果并回收，防止旧图晚到覆盖新图
    if (get().glass.bgFileName !== fileName) {
      if (url !== null) URL.revokeObjectURL(url)
      return
    }
    const prevUrl = get().bgUrl
    if (prevUrl !== null) URL.revokeObjectURL(prevUrl)
    set({ bgUrl: url })
  },
}))
