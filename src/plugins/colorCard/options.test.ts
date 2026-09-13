// ============================================================================
// 模块说明（中文）
// 色卡参数模型（options.ts）的单元测试。
//
// 重点覆盖四类真正会被用错的地方：
//   · 色值归一化（带不带 # / 三位简写 / 大小写 / 非法输入）
//   · 尺寸夹紧（越界、非整数、NaN）
//   · 文件名生成（前缀净化、时间戳、非法字符）
//   · 插件配置 ↔ 参数的双向映射（坏配置不能抛错）
// ============================================================================

import { describe, expect, it } from 'vitest'

import {
  COLOR_CARD_COLOR_PRESETS,
  COLOR_CARD_LIMITS,
  COLOR_CARD_LONG_EDGE_PRESETS,
  COLOR_CARD_RATIO_PRESETS,
  COLOR_CARD_SIZE_PRESETS,
  DEFAULT_COLOR_CARD_OPTIONS,
  clampSize,
  colorCardFileName,
  colorPresetLabel,
  describeSize,
  isValidSize,
  longEdgeOf,
  matchRatioPreset,
  normalizeHex,
  normalizeOptions,
  optionsFromConfig,
  optionsToConfig,
  ratioPresetLabel,
  sanitizeNamePrefix,
  sizeForLongEdge,
  sizeForRatio,
  sizePresetLabel,
  validateColorCardOptions,
} from './options'
import { COLOR_PRESET_LABELS, RATIO_PRESET_LABELS, SIZE_PRESET_LABELS } from './text'

describe('normalizeHex', () => {
  it('接受带 # / 不带 # / 大小写混合的六位色值', () => {
    expect(normalizeHex('#5a7d6a')).toBe('#5A7D6A')
    expect(normalizeHex('5A7D6A')).toBe('#5A7D6A')
    expect(normalizeHex('  #5a7d6a  ')).toBe('#5A7D6A')
  })

  it('三位简写展开成六位', () => {
    expect(normalizeHex('#abc')).toBe('#AABBCC')
    expect(normalizeHex('f0a')).toBe('#FF00AA')
  })

  it('非法输入返回 null（位数不对 / 非十六进制字符 / 空串）', () => {
    expect(normalizeHex('zzzzzz')).toBeNull()
    expect(normalizeHex('#12345')).toBeNull()
    expect(normalizeHex('#1234567')).toBeNull()
    expect(normalizeHex('')).toBeNull()
    expect(normalizeHex('#12 34 56')).toBeNull()
  })
})

describe('尺寸约束', () => {
  it('区间内的整数合法；越界、非整数、NaN 都不合法', () => {
    expect(isValidSize(COLOR_CARD_LIMITS.minSize)).toBe(true)
    expect(isValidSize(COLOR_CARD_LIMITS.maxSize)).toBe(true)
    expect(isValidSize(COLOR_CARD_LIMITS.minSize - 1)).toBe(false)
    expect(isValidSize(COLOR_CARD_LIMITS.maxSize + 1)).toBe(false)
    expect(isValidSize(120.5)).toBe(false)
    expect(isValidSize(Number.NaN)).toBe(false)
  })

  it('clampSize 把越界值夹到区间、把非数字换成回落值', () => {
    expect(clampSize(5)).toBe(COLOR_CARD_LIMITS.minSize)
    expect(clampSize(99999)).toBe(COLOR_CARD_LIMITS.maxSize)
    expect(clampSize(120.4)).toBe(120)
    expect(clampSize(Number.NaN)).toBe(DEFAULT_COLOR_CARD_OPTIONS.width)
    expect(clampSize(Number.NaN, 200)).toBe(200)
  })

  it('describeSize 产出「宽 × 高」', () => {
    expect(describeSize(600, 400)).toBe('600 × 400')
  })

  it('默认不把色值画进图片（色号改由画布悬停显示，2026-09-14 用户裁决）', () => {
    expect(DEFAULT_COLOR_CARD_OPTIONS.showHex).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 比例 × 长边（2026-09-14 用户要求新增的两组预设）
// ---------------------------------------------------------------------------

describe('比例 × 长边', () => {
  it('longEdgeOf 取较大边；非有限值返回 0', () => {
    expect(longEdgeOf(1920, 1080)).toBe(1920)
    expect(longEdgeOf(1080, 1920)).toBe(1920)
    expect(longEdgeOf(400.4, 400.6)).toBe(401)
    expect(longEdgeOf(Number.NaN, 100)).toBe(0)
  })

  it('sizeForRatio：长边恒等于给定像素，另一边按比例折算', () => {
    expect(sizeForRatio(1, 1920)).toEqual({ width: 1920, height: 1920 })
    expect(sizeForRatio(16 / 9, 1920)).toEqual({ width: 1920, height: 1080 })
    expect(sizeForRatio(9 / 16, 1920)).toEqual({ width: 1080, height: 1920 })
  })

  it('sizeForRatio：长边越界被夹紧，比例非法退化成正方形', () => {
    expect(sizeForRatio(16 / 9, 99999)).toEqual({
      width: COLOR_CARD_LIMITS.maxSize,
      height: 2304,
    })
    expect(sizeForRatio(0, 800)).toEqual({ width: 800, height: 800 })
    expect(sizeForRatio(Number.NaN, 800)).toEqual({ width: 800, height: 800 })
  })

  it('sizeForRatio：极端比例下短边仍落在合法区间（不会算出 0 像素）', () => {
    expect(sizeForRatio(1000, 1920).height).toBe(COLOR_CARD_LIMITS.minSize)
  })

  it('sizeForLongEdge：保持比例缩放长边', () => {
    expect(sizeForLongEdge(400, 400, 1024)).toEqual({ width: 1024, height: 1024 })
    expect(sizeForLongEdge(1200, 300, 600)).toEqual({ width: 600, height: 150 })
  })

  it('两组预设可任意顺序点：结果一致', () => {
    const viaRatio = sizeForRatio(16 / 9, 1920)
    const viaLongEdge = sizeForLongEdge(viaRatio.width, viaRatio.height, 1920)
    expect(viaLongEdge).toEqual(viaRatio)
  })

  it('sizeForLongEdge：当前尺寸退化时给正方形，不除零', () => {
    expect(sizeForLongEdge(0, 0, 512)).toEqual({ width: 512, height: 512 })
  })

  it('matchRatioPreset：认得出常用比例（容忍像素取整误差）', () => {
    expect(matchRatioPreset(1920, 1080)).toBe('ratio-16-9')
    expect(matchRatioPreset(2560, 1440)).toBe('ratio-16-9')
    expect(matchRatioPreset(1080, 1920)).toBe('ratio-9-16')
    expect(matchRatioPreset(512, 512)).toBe('ratio-1-1')
  })

  it('matchRatioPreset：自由比例返回 null（不打选中态）', () => {
    expect(matchRatioPreset(600, 400)).toBeNull()
    expect(matchRatioPreset(1200, 300)).toBeNull()
    expect(matchRatioPreset(0, 400)).toBeNull()
  })
})

describe('文件名', () => {
  it('净化前缀：去掉文件系统非法字符与多余空白，并截断', () => {
    expect(sanitizeNamePrefix('色卡/2026:初稿*')).toBe('色卡2026初稿')
    expect(sanitizeNamePrefix('  a   b  ')).toBe('a b')
    expect(sanitizeNamePrefix('x'.repeat(50))).toHaveLength(24)
    expect(sanitizeNamePrefix('   ')).toBe('')
  })

  it('生成 `前缀-色值-日期-时间.png`，色值大写且不带 #', () => {
    const name = colorCardFileName('色卡', '#5a7d6a', new Date(2026, 8, 14, 0, 12))
    expect(name).toBe('色卡-5A7D6A-20260914-0012.png')
  })

  it('前缀为空或只有非法字符时回落到默认前缀', () => {
    expect(colorCardFileName('///', '#5A7D6A', new Date(2026, 8, 14, 0, 12))).toBe(
      `${DEFAULT_COLOR_CARD_OPTIONS.namePrefix}-5A7D6A-20260914-0012.png`,
    )
  })

  it('色值非法时回落到默认色（不产出含非法字符的文件名）', () => {
    const name = colorCardFileName('色卡', 'oops', new Date(2026, 8, 14, 0, 12))
    expect(name).toBe(
      `色卡-${DEFAULT_COLOR_CARD_OPTIONS.color.slice(1)}-20260914-0012.png`,
    )
  })
})

describe('normalizeOptions', () => {
  it('空入参 → 全套默认值', () => {
    expect(normalizeOptions({})).toEqual(DEFAULT_COLOR_CARD_OPTIONS)
  })

  it('色值非法 → 回落默认色；尺寸越界 → 夹紧；前缀非法 → 净化', () => {
    const options = normalizeOptions({
      color: 'nope',
      width: 99999,
      height: 1,
      namePrefix: 'a/b:c',
      outputDir: '  E:\\space  ',
    })

    expect(options.color).toBe(DEFAULT_COLOR_CARD_OPTIONS.color)
    expect(options.width).toBe(COLOR_CARD_LIMITS.maxSize)
    expect(options.height).toBe(COLOR_CARD_LIMITS.minSize)
    expect(options.namePrefix).toBe('abc')
    expect(options.outputDir).toBe('E:\\space')
  })

  it('保留合法的自定义值', () => {
    const options = normalizeOptions({ color: '#abc', width: 600, height: 400, showHex: false })
    expect(options).toMatchObject({ color: '#AABBCC', width: 600, height: 400, showHex: false })
  })
})

describe('validateColorCardOptions', () => {
  it('合法参数返回 null', () => {
    expect(validateColorCardOptions({ ...DEFAULT_COLOR_CARD_OPTIONS, outputDir: 'E:\\out' })).toBeNull()
  })

  it('没选输出文件夹 → 中文错误', () => {
    const problem = validateColorCardOptions(DEFAULT_COLOR_CARD_OPTIONS)
    expect(problem).toContain('输出文件夹')
  })

  it('色值非法 → 中文错误（防御调用方绕过 normalizeOptions 直接传值）', () => {
    const problem = validateColorCardOptions({
      ...DEFAULT_COLOR_CARD_OPTIONS,
      color: 'x',
      outputDir: 'E:\\out',
    })
    expect(problem).toContain('色值')
  })
})

describe('插件配置 ↔ 参数', () => {
  it('往返一致：optionsFromConfig(optionsToConfig(o)) 等于归一化后的 o', () => {
    const options = normalizeOptions({
      color: '#4C5B8A',
      width: 800,
      height: 300,
      showHex: false,
      namePrefix: '参考',
      outputDir: 'E:\\色卡',
    })

    expect(optionsFromConfig(optionsToConfig(options))).toEqual(options)
  })

  it('配置里的坏值一律回落到默认，不抛错（配置文件用户能手改）', () => {
    const options = optionsFromConfig({
      color: 42,
      width: 'big',
      height: null,
      showHex: 'yes',
      namePrefix: 7,
      outputDir: 0,
    })

    expect(options).toEqual(DEFAULT_COLOR_CARD_OPTIONS)
  })

  it('配置没记过输出目录时用调用方给的兜底值（通常是当前空间）', () => {
    expect(optionsFromConfig({}, 'E:\\空间').outputDir).toBe('E:\\空间')
    // 但配置里记过就用记过的，兜底值不覆盖用户的选择
    expect(optionsFromConfig({ outputDir: 'E:\\色卡' }, 'E:\\空间').outputDir).toBe('E:\\色卡')
  })

  it('输出目录只写了空格 → 视为未设置，用兜底值', () => {
    expect(optionsFromConfig({ outputDir: '   ' }, 'E:\\空间').outputDir).toBe('E:\\空间')
  })
})

describe('预设与标签一一对应', () => {
  it('每个色板预设都有中文标签、且色值合法', () => {
    for (const preset of COLOR_CARD_COLOR_PRESETS) {
      expect(COLOR_PRESET_LABELS[preset.id], `色板 ${preset.id} 缺中文标签`).toBeTruthy()
      expect(colorPresetLabel(preset.id)).toBe(COLOR_PRESET_LABELS[preset.id])
      expect(normalizeHex(preset.color)).toBe(preset.color)
    }
  })

  it('每个尺寸预设都有中文标签、且尺寸合法', () => {
    for (const preset of COLOR_CARD_SIZE_PRESETS) {
      expect(SIZE_PRESET_LABELS[preset.id], `尺寸预设 ${preset.id} 缺中文标签`).toBeTruthy()
      expect(sizePresetLabel(preset.id)).toBe(SIZE_PRESET_LABELS[preset.id])
      expect(isValidSize(preset.width)).toBe(true)
      expect(isValidSize(preset.height)).toBe(true)
    }
  })

  it('每个比例预设都有中文标签、且比值为正', () => {
    for (const preset of COLOR_CARD_RATIO_PRESETS) {
      expect(RATIO_PRESET_LABELS[preset.id], `比例预设 ${preset.id} 缺中文标签`).toBeTruthy()
      expect(ratioPresetLabel(preset.id)).toBe(RATIO_PRESET_LABELS[preset.id])
      expect(preset.ratio).toBeGreaterThan(0)
    }
  })

  it('常用比例就是 1:1 / 16:9 / 9:16（用户点名的三项）', () => {
    expect(COLOR_CARD_RATIO_PRESETS.map((preset) => RATIO_PRESET_LABELS[preset.id])).toEqual([
      '1:1',
      '16:9',
      '9:16',
    ])
  })

  it('长边像素预设都在合法区间内，且含 1920', () => {
    expect(COLOR_CARD_LONG_EDGE_PRESETS.length).toBeGreaterThan(0)
    for (const pixels of COLOR_CARD_LONG_EDGE_PRESETS) expect(isValidSize(pixels)).toBe(true)
    expect(COLOR_CARD_LONG_EDGE_PRESETS).toContain(1920)
  })

  it('每个「比例 × 长边」组合都能算出合法尺寸', () => {
    for (const preset of COLOR_CARD_RATIO_PRESETS) {
      for (const pixels of COLOR_CARD_LONG_EDGE_PRESETS) {
        const size = sizeForRatio(preset.ratio, pixels)
        expect(isValidSize(size.width)).toBe(true)
        expect(isValidSize(size.height)).toBe(true)
        expect(longEdgeOf(size.width, size.height)).toBe(pixels)
      }
    }
  })

  it('预设 id 不重复', () => {
    const colorIds = COLOR_CARD_COLOR_PRESETS.map((preset) => preset.id)
    const sizeIds = COLOR_CARD_SIZE_PRESETS.map((preset) => preset.id)
    const ratioIds = COLOR_CARD_RATIO_PRESETS.map((preset) => preset.id)
    expect(new Set(colorIds).size).toBe(colorIds.length)
    expect(new Set(sizeIds).size).toBe(sizeIds.length)
    expect(new Set(ratioIds).size).toBe(ratioIds.length)
  })

  it('未知 id 原样返回（不会变成 undefined 显示成空白按钮）', () => {
    expect(colorPresetLabel('unknown')).toBe('unknown')
    expect(sizePresetLabel('unknown')).toBe('unknown')
    expect(ratioPresetLabel('unknown')).toBe('unknown')
  })
})
