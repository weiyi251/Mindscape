// ============================================================================
// 模块说明（中文）
// 色卡插件的输入界面（用户可见的「新建色卡」面板）。
//
// 它由插件自己提供、由宿主挂载：插件在 activate 里把 `() => <ColorCardDialog/>`
// 交给 `api.ui.openDialog`，宿主（components/ui/plugin-dialog-host.tsx）负责
// 套模态框、Esc 关闭、点遮罩关闭。这样插件的界面代码 100% 待在自己的文件夹里，
// 宿主完全不认识「色卡」这个概念 —— 满足「插件相关代码独立拆分」的要求。
//
// 本组件是渲染层（不引入 jsdom，故不做单测，登记在守卫规则 6 的豁免清单里）；
// 它里面的每一处判断都只调用 options.ts / save.ts 的纯函数或编排函数，
// 真正的边界（色值合法性、尺寸夹紧、文件名、写盘失败、跳过建卡）都在那边被钉死了。
//
// 颜色预览用内联 style 而不是 Tailwind 类：颜色来自用户选择的**数据**，
// 无法预先写成类名（守卫规则 3 也因此不会命中 —— 这里没有任何 hex 字面量）。
// ============================================================================

import { useCallback, useState } from 'react'

import type { PluginHostApi } from '@/core/plugin/types'
import {
  COLOR_CARD_COLOR_PRESETS,
  COLOR_CARD_LIMITS,
  COLOR_CARD_LONG_EDGE_PRESETS,
  COLOR_CARD_RATIO_PRESETS,
  COLOR_CARD_SIZE_PRESETS,
  colorPresetLabel,
  colorCardFileName,
  describeSize,
  longEdgeOf,
  matchRatioPreset,
  normalizeHex,
  normalizeOptions,
  optionsFromConfig,
  optionsToConfig,
  ratioPresetLabel,
  sizeForLongEdge,
  sizeForRatio,
  sizePresetLabel,
  validateColorCardOptions,
} from './options'
import type { ColorCardOptions } from './options'
import { isPathWithin, saveColorCard } from './save'
import type { SaveColorCardResult } from './save'
import { COLOR_CARD_TEXT } from './text'

/** 文本输入框统一样式（语义 token，深浅色都跟随主题） */
const FIELD_CLASS =
  'w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary'

/** 小按钮统一样式 */
const SMALL_BUTTON =
  'rounded border border-border px-2 py-0.5 text-[11px] text-foreground transition-colors hover:bg-muted disabled:opacity-50'

/** 预设按钮（比例 / 长边两组共用）：选中态高亮，让用户一眼看出当前是哪一组值 */
function presetButtonClass(active: boolean): string {
  return [SMALL_BUTTON, active ? 'border-primary bg-primary/10 text-primary' : '']
    .filter(Boolean)
    .join(' ')
}

/** 主按钮 */
const PRIMARY_BUTTON =
  'rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50'

function SectionTitle({ children }: { children: string }) {
  return <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{children}</h3>
}

function FieldLabel({ children }: { children: string }) {
  return <span className="block text-[11px] text-muted-foreground">{children}</span>
}

export interface ColorCardDialogProps {
  /** 宿主注入的插件 API（写文件、建卡、读配置、关弹窗） */
  api: PluginHostApi
  /** 触发菜单时的空间文件夹绝对路径；未打开空间为 null */
  spacePath: string | null
}

export function ColorCardDialog({ api, spacePath }: ColorCardDialogProps) {
  // 文件名预览用的时间戳。保存成功后重置一次，让「再生成一张」的预览跟上。
  const [fileStamp, setFileStamp] = useState(() => new Date())
  const [options, setOptions] = useState<ColorCardOptions>(() =>
    optionsFromConfig(api.config.getAll(), spacePath ?? ''),
  )
  const [hexDraft, setHexDraft] = useState(() => options.color)
  const [addToCanvas, setAddToCanvas] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SaveColorCardResult | null>(null)

  const patch = useCallback((changes: Partial<ColorCardOptions>) => {
    setOptions((current) => ({ ...current, ...changes }))
    setResult(null)
  }, [])

  /** 色板 / 取色器选中颜色：同步下拉杆里的草稿色值 */
  const pickColor = useCallback(
    (color: string) => {
      setHexDraft(color)
      patch({ color })
    },
    [patch],
  )

  /** 手输色值：合法就即时生效，非法只保留草稿（保存时再报错） */
  const handleHexInput = useCallback(
    (value: string) => {
      setHexDraft(value)
      const normalized = normalizeHex(value)
      if (normalized !== null) patch({ color: normalized })
    },
    [patch],
  )

  const handlePickDirectory = useCallback(async () => {
    setError(null)
    const picked = await api.fs.pickDirectory(COLOR_CARD_TEXT.pickDirTitle)
    if (picked) patch({ outputDir: picked })
  }, [api, patch])

  const handleSave = useCallback(async () => {
    setError(null)

    // 色值先按草稿（用户真正看到的那串字符）校验，再把错误就地显示出来
    if (normalizeHex(hexDraft) === null) {
      setError(COLOR_CARD_TEXT.invalidColor)
      return
    }

    const normalized = normalizeOptions(options)

    const problem = validateColorCardOptions(normalized)
    if (problem !== null) {
      setError(problem)
      return
    }

    setBusy(true)
    try {
      const outcome = await saveColorCard(
        { options: normalized, spacePath, addToCanvas },
        {
          writeBytes: api.fs.writeBytes,
          createCardFromFile: (input) => api.board.createCardFromFile(input),
          now: () => new Date(),
        },
      )
      setResult(outcome)
      setOptions(normalized)
      setHexDraft(normalized.color)
      setFileStamp(new Date())
      // 记住这次参数，下次打开对话框直接沿用（插件配置存在 plugins.json，卸载也不删）
      void api.config.set(optionsToConfig(normalized))
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause)
      setError(COLOR_CARD_TEXT.saveFailed(reason))
    } finally {
      setBusy(false)
    }
  }, [addToCanvas, api, hexDraft, options, spacePath])

  const insideSpace = isPathWithin(options.outputDir, spacePath ?? '')

  return (
    <div className="space-y-4">
      {/* ---------------- 颜色 ---------------- */}
      <div className="space-y-2">
        <SectionTitle>{COLOR_CARD_TEXT.colorSection}</SectionTitle>

        <div className="flex items-center gap-3">
          <div
            className="h-10 w-16 shrink-0 rounded border border-border"
            style={{ backgroundColor: options.color }}
            title={options.color}
            aria-label={COLOR_CARD_TEXT.colorPreviewLabel}
          />
          <div className="min-w-0 flex-1 space-y-1">
            <FieldLabel>{COLOR_CARD_TEXT.colorHexLabel}</FieldLabel>
            <input
              type="text"
              className={FIELD_CLASS}
              value={hexDraft}
              placeholder={COLOR_CARD_TEXT.colorHexPlaceholder}
              onChange={(event) => handleHexInput(event.target.value)}
              aria-label={COLOR_CARD_TEXT.colorHexLabel}
            />
          </div>
          <input
            type="color"
            className="h-8 w-10 shrink-0 cursor-pointer rounded border border-border bg-transparent"
            value={options.color}
            onChange={(event) => pickColor(event.target.value)}
            title={COLOR_CARD_TEXT.colorPickerLabel}
            aria-label={COLOR_CARD_TEXT.colorPickerLabel}
          />
        </div>

        <div className="space-y-1">
          <FieldLabel>{COLOR_CARD_TEXT.colorPresetsLabel}</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {COLOR_CARD_COLOR_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={[
                  'h-6 w-6 rounded border transition-transform hover:scale-110',
                  preset.color === options.color ? 'border-primary' : 'border-border',
                ].join(' ')}
                style={{ backgroundColor: preset.color }}
                onClick={() => pickColor(preset.color)}
                title={`${colorPresetLabel(preset.id)}（${preset.color}）`}
                aria-label={colorPresetLabel(preset.id)}
              />
            ))}
          </div>
        </div>

        {/* 这里曾有一个「在色卡图片上标注色值」开关。2026-09-14 用户要求
            「确保色块内部不再展示任何色号文本或标签」，故开关与绘制链路一并删除
            （色卡现在严格等于一块纯色），只留一句说明告诉用户色号去哪看 */}
        <p className="text-[11px] leading-snug text-muted-foreground">
          {COLOR_CARD_TEXT.hoverHexHint}
        </p>
      </div>

      {/* ---------------- 尺寸 ---------------- */}
      {/* 两组预设（2026-09-14 用户要求新增）：比例决定形状、长边决定像素。
          两组可任意顺序点 —— 点比例时沿用当前长边，点长边时沿用当前比例，
          因此「先 16:9 再 1920」与「先 1920 再 16:9」得到同一套尺寸（1920×1080）。 */}
      <div className="space-y-2">
        <SectionTitle>{COLOR_CARD_TEXT.sizeSection}</SectionTitle>

        <div className="space-y-1">
          <FieldLabel>{COLOR_CARD_TEXT.ratioPresetsLabel}</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {COLOR_CARD_RATIO_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={presetButtonClass(
                  matchRatioPreset(options.width, options.height) === preset.id,
                )}
                onClick={() =>
                  patch(sizeForRatio(preset.ratio, longEdgeOf(options.width, options.height)))
                }
                title={`${ratioPresetLabel(preset.id)}：保持长边 ${longEdgeOf(options.width, options.height)} 像素，另一边按比例折算`}
              >
                {ratioPresetLabel(preset.id)}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <FieldLabel>{COLOR_CARD_TEXT.longEdgePresetsLabel}</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {COLOR_CARD_LONG_EDGE_PRESETS.map((pixels) => (
              <button
                key={pixels}
                type="button"
                className={presetButtonClass(longEdgeOf(options.width, options.height) === pixels)}
                onClick={() => patch(sizeForLongEdge(options.width, options.height, pixels))}
                title={COLOR_CARD_TEXT.longEdgeTitle(pixels)}
              >
                {pixels}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="w-24 space-y-1">
            <FieldLabel>{`${COLOR_CARD_TEXT.widthLabel}（${COLOR_CARD_TEXT.sizeUnit}）`}</FieldLabel>
            <input
              type="number"
              className={FIELD_CLASS}
              value={options.width}
              min={COLOR_CARD_LIMITS.minSize}
              max={COLOR_CARD_LIMITS.maxSize}
              onChange={(event) => patch({ width: Number(event.target.value) })}
              aria-label={COLOR_CARD_TEXT.widthLabel}
            />
          </div>
          <div className="w-24 space-y-1">
            <FieldLabel>{`${COLOR_CARD_TEXT.heightLabel}（${COLOR_CARD_TEXT.sizeUnit}）`}</FieldLabel>
            <input
              type="number"
              className={FIELD_CLASS}
              value={options.height}
              min={COLOR_CARD_LIMITS.minSize}
              max={COLOR_CARD_LIMITS.maxSize}
              onChange={(event) => patch({ height: Number(event.target.value) })}
              aria-label={COLOR_CARD_TEXT.heightLabel}
            />
          </div>
        </div>

        <div className="space-y-1">
          <FieldLabel>{COLOR_CARD_TEXT.sizePresetsLabel}</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {COLOR_CARD_SIZE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={SMALL_BUTTON}
                onClick={() => patch({ width: preset.width, height: preset.height })}
                title={`${sizePresetLabel(preset.id)}（${describeSize(preset.width, preset.height)}）`}
              >
                {sizePresetLabel(preset.id)}
              </button>
            ))}
          </div>
        </div>

        <p className="text-[11px] leading-snug text-muted-foreground">
          {COLOR_CARD_TEXT.sizeHint(COLOR_CARD_LIMITS.minSize, COLOR_CARD_LIMITS.maxSize)}
        </p>
      </div>

      {/* ---------------- 输出 ---------------- */}
      <div className="space-y-2">
        <SectionTitle>{COLOR_CARD_TEXT.outputSection}</SectionTitle>

        <div className="space-y-1">
          <FieldLabel>{COLOR_CARD_TEXT.outputDirLabel}</FieldLabel>
          <div className="flex items-center gap-2">
            <input
              type="text"
              className={FIELD_CLASS}
              value={options.outputDir}
              placeholder={COLOR_CARD_TEXT.outputDirEmpty}
              onChange={(event) => patch({ outputDir: event.target.value })}
              aria-label={COLOR_CARD_TEXT.outputDirLabel}
            />
            <button
              type="button"
              className={`${SMALL_BUTTON} shrink-0`}
              onClick={() => void handlePickDirectory()}
            >
              {COLOR_CARD_TEXT.pickDirLabel}
            </button>
          </div>
        </div>

        <div className="space-y-1">
          <FieldLabel>{COLOR_CARD_TEXT.namePrefixLabel}</FieldLabel>
          <input
            type="text"
            className={FIELD_CLASS}
            value={options.namePrefix}
            onChange={(event) => patch({ namePrefix: event.target.value })}
            aria-label={COLOR_CARD_TEXT.namePrefixLabel}
          />
          <p className="break-all text-[11px] leading-snug text-muted-foreground">
            {COLOR_CARD_TEXT.fileNamePreview(
              colorCardFileName(options.namePrefix, options.color, fileStamp),
            )}
          </p>
        </div>

        <label className="flex items-center gap-2 text-xs text-foreground">
          <input
            type="checkbox"
            className="accent-primary"
            checked={addToCanvas}
            disabled={!insideSpace}
            onChange={(event) => setAddToCanvas(event.target.checked)}
          />
          {COLOR_CARD_TEXT.addToCanvasLabel}
        </label>
        <p className="text-[11px] leading-snug text-muted-foreground">
          {COLOR_CARD_TEXT.addToCanvasHint}
        </p>
      </div>

      {/* ---------------- 提示 ---------------- */}
      {error ? (
        <p className="rounded border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-[11px] leading-snug text-destructive">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="space-y-1 rounded border border-border bg-muted/40 px-2 py-1.5">
          <p className="break-all text-[11px] leading-snug text-foreground">
            {COLOR_CARD_TEXT.savedTo(result.absolutePath)}
          </p>
          {result.addedToCanvas ? (
            <p className="text-[11px] leading-snug text-muted-foreground">
              {COLOR_CARD_TEXT.addedToCanvas}
            </p>
          ) : result.canvasSkipReason ? (
            <p className="text-[11px] leading-snug text-muted-foreground">
              {result.canvasSkipReason}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* ---------------- 操作 ---------------- */}
      {/* 保存成功后不自动关窗：用户可以连着调几个色值再关（文件名带时间戳，不会互相覆盖） */}
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          className={SMALL_BUTTON}
          onClick={api.ui.closeDialog}
          disabled={busy}
        >
          {COLOR_CARD_TEXT.close}
        </button>
        <button
          type="button"
          className={PRIMARY_BUTTON}
          onClick={() => void handleSave()}
          disabled={busy}
        >
          {busy ? COLOR_CARD_TEXT.saving : COLOR_CARD_TEXT.save}
        </button>
      </div>
    </div>
  )
}
