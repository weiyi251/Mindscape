// ============================================================================
// 模块说明（中文）
// 设置 →「外观」页：毛玻璃与背景图的全部自定义项（2026-10-01 用户需求）。
//
// 布局沿用设置页既有口径：分区标题 + 控件行，窄屏 44px 点按区（档位按钮
// min-h-[44px]），文案全部来自 settingsText 的 APPEARANCE_TEXT。
// 每一次改动都走 appearanceStore.setGlass：持久化 + CSS 变量即时生效，
// 面板本身就是玻璃 —— 拖滑杆的同时可以透过本页看到效果，天然实时预览。
//
// 控件与参数对应（范围/默认值定义在 core/appearance/glassTypes.ts）：
//   透明度   → alpha（0.05~0.95，默认 75%）
//   模糊强度 → blurPx（0~40px，默认 14；只作用于弹窗/菜单，见 blurHint）
//   色彩鲜艳 → saturate（1~2，默认 1.15）
//   浅/深底色 → tintLight / tintDark（原生取色器，深浅各存一份）
//   边框高光 → borderAlpha（0~1，0 即无边框）
//   阴影     → shadow（无/轻/中/重 档位按钮）
//   背景图片 → bgFileName（文件本体落 %APPDATA%\Mindscape\appearance\，
//              偏好只记文件名）+ 背景压暗 → bgDim（0~0.6，默认 30%）
// ============================================================================

import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'

import { Button } from '@/components/ui/button'
import { APPEARANCE_TEXT } from './settingsText'
import { useAppearanceStore } from '@/core/appearance/appearanceStore'
import { GLASS_LIMITS, SHADOW_LEVELS } from '@/core/appearance/glassTypes'
import type { GlassShadowLevel } from '@/core/appearance/glassTypes'
import { MAX_WALLPAPER_BYTES, removeWallpaperFile, saveWallpaper } from '@/core/appearance/wallpaper'
import { isImageFile } from '@/core/board/imageTypes'
import { cn } from '@/lib/utils'

/** 阴影档位按钮的文案（顺序与 glassTypes 的 SHADOW_LEVELS 对齐） */
const SHADOW_LABEL: Record<GlassShadowLevel, string> = {
  none: APPEARANCE_TEXT.shadowNone,
  soft: APPEARANCE_TEXT.shadowSoft,
  medium: APPEARANCE_TEXT.shadowMedium,
  strong: APPEARANCE_TEXT.shadowStrong,
}

/** 百分数显示：0.75 → 75% */
function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

/**
 * 滑杆行（普通函数而非组件：无 hooks，不触发 react-refresh 约束；
 * 每行 = 标签 + 当前值 + 滑杆 + 可选说明）。
 */
function sliderRow(options: {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  onChange: (next: number) => void
  hint?: string
  disabled?: boolean
}) {
  return (
    <div className={cn('space-y-1', options.disabled && 'opacity-50')}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-foreground/80">{options.label}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{options.display}</span>
      </div>
      <input
        type="range"
        min={options.min}
        max={options.max}
        step={options.step}
        value={options.value}
        disabled={options.disabled === true}
        onChange={(event) => options.onChange(Number(event.target.value))}
        className="w-full accent-primary"
        aria-label={options.label}
      />
      {options.hint ? <p className="text-xs leading-5 text-muted-foreground">{options.hint}</p> : null}
    </div>
  )
}

function sectionTitle(text: string) {
  return <h3 className="text-sm font-medium text-foreground">{text}</h3>
}

/** 取色器行（原生 color input，零依赖；值即 #rrggbb 小写，与偏好存储形态一致） */
function colorRow(label: string, value: string, onChange: (next: string) => void) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-foreground/80">{label}</span>
      <input
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-14 cursor-pointer rounded border border-input bg-transparent p-0.5"
        aria-label={label}
      />
    </div>
  )
}

export function SettingsAppearancePage() {
  const glass = useAppearanceStore((state) => state.glass)
  const setGlass = useAppearanceStore((state) => state.setGlass)
  const resetGlass = useAppearanceStore((state) => state.resetGlass)
  /** 选图校验失败的行内提示（成功即清除） */
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handlePicked = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // 重置 value：连选同一份文件时 change 才会再次触发（M4 同款处理）
    event.target.value = ''
    if (!file) return
    if (!isImageFile(file.name)) {
      setError(APPEARANCE_TEXT.errNotImage)
      return
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (bytes.byteLength > MAX_WALLPAPER_BYTES) {
      setError(APPEARANCE_TEXT.errTooLarge)
      return
    }
    try {
      const name = await saveWallpaper(glass.bgFileName, file.name, bytes)
      setError(null)
      setGlass({ bgFileName: name })
    } catch {
      setError(APPEARANCE_TEXT.errSave)
    }
  }

  const handleRemove = async () => {
    await removeWallpaperFile(glass.bgFileName)
    setGlass({ bgFileName: null })
  }

  return (
    <div className="space-y-6 pb-4">
      {/* ---- 毛玻璃 ---- */}
      <section className="space-y-3">
        {sectionTitle(APPEARANCE_TEXT.glassTitle)}
        {sliderRow({
          label: APPEARANCE_TEXT.alphaLabel,
          value: glass.alpha,
          min: GLASS_LIMITS.alpha.min,
          max: GLASS_LIMITS.alpha.max,
          step: 0.01,
          display: percent(glass.alpha),
          onChange: (alpha) => setGlass({ alpha }),
        })}
        {sliderRow({
          label: APPEARANCE_TEXT.blurLabel,
          value: glass.blurPx,
          min: GLASS_LIMITS.blurPx.min,
          max: GLASS_LIMITS.blurPx.max,
          step: 1,
          display: `${glass.blurPx} px`,
          onChange: (blurPx) => setGlass({ blurPx }),
          hint: APPEARANCE_TEXT.blurHint,
        })}
        {sliderRow({
          label: APPEARANCE_TEXT.saturateLabel,
          value: glass.saturate,
          min: GLASS_LIMITS.saturate.min,
          max: GLASS_LIMITS.saturate.max,
          step: 0.05,
          display: `×${glass.saturate.toFixed(2)}`,
          onChange: (saturate) => setGlass({ saturate }),
        })}
      </section>

      {/* ---- 玻璃颜色（深浅各一份，切主题时自动各用各的）---- */}
      <section className="space-y-3">
        {sectionTitle(APPEARANCE_TEXT.colorTitle)}
        {colorRow(APPEARANCE_TEXT.tintLightLabel, glass.tintLight, (tintLight) => setGlass({ tintLight }))}
        {colorRow(APPEARANCE_TEXT.tintDarkLabel, glass.tintDark, (tintDark) => setGlass({ tintDark }))}
      </section>

      {/* ---- 边框与阴影 ---- */}
      <section className="space-y-3">
        {sectionTitle(APPEARANCE_TEXT.frameTitle)}
        {sliderRow({
          label: APPEARANCE_TEXT.borderLabel,
          value: glass.borderAlpha,
          min: GLASS_LIMITS.borderAlpha.min,
          max: GLASS_LIMITS.borderAlpha.max,
          step: 0.05,
          display: percent(glass.borderAlpha),
          onChange: (borderAlpha) => setGlass({ borderAlpha }),
        })}
        <div className="space-y-1">
          <span className="text-foreground/80">{APPEARANCE_TEXT.shadowLabel}</span>
          <div className="flex gap-1" role="group" aria-label={APPEARANCE_TEXT.shadowLabel}>
            {SHADOW_LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                aria-pressed={glass.shadow === level}
                onClick={() => setGlass({ shadow: level })}
                className={cn(
                  'min-h-[44px] flex-1 rounded border px-2 text-xs sm:min-h-0 sm:py-1.5',
                  glass.shadow === level
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border text-foreground/70 hover:bg-foreground/10 hover:text-foreground',
                )}
              >
                {SHADOW_LABEL[level]}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ---- 背景图片 ---- */}
      <section className="space-y-3">
        {sectionTitle(APPEARANCE_TEXT.bgTitle)}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            {glass.bgFileName === null ? APPEARANCE_TEXT.bgPick : APPEARANCE_TEXT.bgChange}
          </Button>
          {glass.bgFileName !== null ? (
            <Button variant="ghost" size="sm" onClick={() => void handleRemove()}>
              {APPEARANCE_TEXT.bgRemove}
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">{APPEARANCE_TEXT.bgEmpty}</span>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={APPEARANCE_TEXT.bgAccept}
          className="hidden"
          onChange={(event) => void handlePicked(event)}
        />
        {error !== null ? <p className="text-xs text-destructive">{error}</p> : null}
        {sliderRow({
          label: APPEARANCE_TEXT.dimLabel,
          value: glass.bgDim,
          min: GLASS_LIMITS.bgDim.min,
          max: GLASS_LIMITS.bgDim.max,
          step: 0.05,
          display: percent(glass.bgDim),
          onChange: (bgDim) => setGlass({ bgDim }),
          hint: APPEARANCE_TEXT.dimHint,
          // 没有壁纸时压暗无从谈起：禁用滑杆而不是隐藏（位置稳定，好按）
          disabled: glass.bgFileName === null,
        })}
      </section>

      {/* ---- 恢复默认（含清除壁纸文件）---- */}
      <div className="border-t border-border pt-4">
        <Button variant="ghost" size="sm" onClick={() => void resetGlass()}>
          {APPEARANCE_TEXT.resetAll}
        </Button>
      </div>
    </div>
  )
}
