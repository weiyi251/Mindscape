// ============================================================================
// 模块说明（中文）
// 色卡落地编排（save.ts）的单元测试。
//
// 依赖全部注入（写字节、建卡、渲染、取时间），因此不需要 Tauri、不需要画布，
// 就能把「成功 / 只写文件 / 各种跳过建卡」这几条路径一次测清 ——
// 这正是把副作用挡在纯函数后面换来的收益。
// ============================================================================

import { describe, expect, it, vi } from 'vitest'

import { HOVER_LABEL_META_KEY } from '@/core/board/cardMeta'
import type { CreateCardInput } from '@/core/plugin/types'
import { normalizeOptions } from './options'
import { COLOR_CARD_META_KEY, isPathWithin, saveColorCard } from './save'
import type { SaveColorCardDeps } from './save'
import { COLOR_CARD_TEXT } from './text'

const SPACE = 'E:\\Mindscape\\空间A'
const FIXED_DATE = new Date(2026, 8, 14, 0, 12)

// 参数模型里已经没有 showHex（"把色值画进图片"整项被删，用户要求色块内部绝不出文字）。
// 即便老 plugins.json 里存着 showHex: true，normalizeOptions 也会把它丢掉 —— 见 options.test.ts。
const OPTIONS = normalizeOptions({
  color: '#5A7D6A',
  width: 400,
  height: 400,
  namePrefix: '色卡',
  outputDir: SPACE,
})

interface Harness {
  deps: SaveColorCardDeps
  written: { destDir: string; fileName: string; bytes: Uint8Array }[]
  cards: CreateCardInput[]
}

function makeHarness(over: Partial<SaveColorCardDeps> = {}): Harness {
  const written: Harness['written'] = []
  const cards: Harness['cards'] = []

  const deps: SaveColorCardDeps = {
    writeBytes: async (destDir, fileName, bytes) => {
      written.push({ destDir, fileName, bytes })
      return `${destDir}\\${fileName}`
    },
    createCardFromFile: async (input) => {
      cards.push(input)
      return true
    },
    render: async () => new Uint8Array([7, 8, 9]),
    now: () => FIXED_DATE,
    ...over,
  }

  return { deps, written, cards }
}

describe('isPathWithin', () => {
  it('自身算在内（色卡默认输出目录就是空间根目录）', () => {
    expect(isPathWithin(SPACE, SPACE)).toBe(true)
  })

  it('子目录算在内；两种分隔符与大小写都不影响判断', () => {
    expect(isPathWithin(`${SPACE}\\子分区`, SPACE)).toBe(true)
    expect(isPathWithin('E:/Mindscape/空间A/子分区', SPACE)).toBe(true)
    expect(isPathWithin('e:\\mindscape\\空间a\\x.png', SPACE)).toBe(true)
  })

  it('父目录、兄弟目录、前缀相似的目录都不算在内', () => {
    expect(isPathWithin('E:\\Mindscape', SPACE)).toBe(false)
    expect(isPathWithin('E:\\Mindscape\\空间AB', SPACE)).toBe(false)
    expect(isPathWithin('D:\\别处\\x.png', SPACE)).toBe(false)
  })

  it('基准目录为空时恒为 false', () => {
    expect(isPathWithin(SPACE, '')).toBe(false)
    expect(isPathWithin(SPACE, '   ')).toBe(false)
  })
})

describe('saveColorCard · 正常路径', () => {
  it('写盘到指定文件夹，并在空间内建卡（不进撤销栈、带插件 meta）', async () => {
    const harness = makeHarness()

    const result = await saveColorCard(
      { options: OPTIONS, spacePath: SPACE, addToCanvas: true },
      harness.deps,
    )

    expect(harness.written).toHaveLength(1)
    expect(harness.written[0].destDir).toBe(SPACE)
    expect(harness.written[0].fileName).toBe('色卡-5A7D6A-20260914-0012.png')
    expect(Array.from(harness.written[0].bytes)).toEqual([7, 8, 9])

    expect(harness.cards).toHaveLength(1)
    expect(harness.cards[0]).toMatchObject({
      relativePath: '色卡-5A7D6A-20260914-0012.png',
      absolutePath: `${SPACE}\\色卡-5A7D6A-20260914-0012.png`,
      type: 'image',
      undoable: false,
    })
    expect(harness.cards[0].meta).toEqual({
      [COLOR_CARD_META_KEY]: { color: '#5A7D6A', width: 400, height: 400 },
      // 色号同时写进通用悬浮标记字段：色卡 PNG 绝不把色值画进图（用户裁决），
      // 色号改由画布在悬停这张卡时显示在图片区域外的左下角（与分辨率徽章左右对称）
      [HOVER_LABEL_META_KEY]: '#5A7D6A',
    })

    expect(result).toEqual({
      absolutePath: `${SPACE}\\色卡-5A7D6A-20260914-0012.png`,
      addedToCanvas: true,
      canvasSkipReason: null,
    })
  })

  it('色号写进通用悬浮标记字段（画布悬停时才显示，默认不画进 PNG）', async () => {
    const harness = makeHarness()

    await saveColorCard(
      { options: OPTIONS, spacePath: SPACE, addToCanvas: true },
      harness.deps,
    )

    expect(harness.cards[0].meta?.[HOVER_LABEL_META_KEY]).toBe('#5A7D6A')
  })

  it('悬浮标记用归一化后的色值（三位简写先展开成六位，再写进 meta）', async () => {
    const harness = makeHarness()

    await saveColorCard(
      { options: { ...OPTIONS, color: '#abc' }, spacePath: SPACE, addToCanvas: true },
      harness.deps,
    )

    expect(harness.cards[0].meta?.[HOVER_LABEL_META_KEY]).toBe('#AABBCC')
  })

  it('渲染入参只有 色值/宽/高 —— 没有任何"是否画色号"的开关（色块内部绝不出文字）', async () => {
    const render = vi.fn(async () => new Uint8Array([1]))
    const harness = makeHarness({ render })

    await saveColorCard(
      { options: OPTIONS, spacePath: SPACE, addToCanvas: false },
      harness.deps,
    )

    expect(render).toHaveBeenCalledWith({ color: '#5A7D6A', width: 400, height: 400 })
  })

  it('不勾「同时在画布上添加卡片」时只写文件', async () => {
    const harness = makeHarness()

    const result = await saveColorCard(
      { options: OPTIONS, spacePath: SPACE, addToCanvas: false },
      harness.deps,
    )

    expect(harness.written).toHaveLength(1)
    expect(harness.cards).toHaveLength(0)
    expect(result.addedToCanvas).toBe(false)
    expect(result.canvasSkipReason).toBeNull()
  })

  it('以写盘返回的实际路径为准（重名时 Rust 会加 _1 后缀）', async () => {
    const harness = makeHarness({
      writeBytes: async (destDir, fileName) => `${destDir}\\${fileName.replace('.png', '_1.png')}`,
    })

    const result = await saveColorCard(
      { options: OPTIONS, spacePath: SPACE, addToCanvas: true },
      harness.deps,
    )

    expect(result.absolutePath.endsWith('_1.png')).toBe(true)
    expect(harness.cards[0].relativePath).toBe('色卡-5A7D6A-20260914-0012_1.png')
  })
})

describe('saveColorCard · 跳过建卡的三种情形（都不算错误，文件照写）', () => {
  it('没有画布桥 → skipNoBridge', async () => {
    const harness = makeHarness({ createCardFromFile: undefined })

    const result = await saveColorCard(
      { options: OPTIONS, spacePath: SPACE, addToCanvas: true },
      harness.deps,
    )

    expect(harness.written).toHaveLength(1)
    expect(result).toMatchObject({ addedToCanvas: false, canvasSkipReason: COLOR_CARD_TEXT.skipNoBridge })
  })

  it('没有打开空间 → skipNoSpace', async () => {
    const harness = makeHarness()

    const result = await saveColorCard(
      { options: OPTIONS, spacePath: null, addToCanvas: true },
      harness.deps,
    )

    expect(result).toMatchObject({ addedToCanvas: false, canvasSkipReason: COLOR_CARD_TEXT.skipNoSpace })
  })

  it('输出文件夹不在空间内 → skipOutsideSpace（用户要的「存到别的文件夹」是合法用法）', async () => {
    const harness = makeHarness()

    const result = await saveColorCard(
      { options: { ...OPTIONS, outputDir: 'D:\\色卡库' }, spacePath: SPACE, addToCanvas: true },
      harness.deps,
    )

    expect(harness.written[0].destDir).toBe('D:\\色卡库')
    expect(result).toMatchObject({
      addedToCanvas: false,
      canvasSkipReason: COLOR_CARD_TEXT.skipOutsideSpace,
    })
  })

  it('画布拒绝了建卡请求 → skipRejected', async () => {
    const harness = makeHarness({ createCardFromFile: async () => false })

    const result = await saveColorCard(
      { options: OPTIONS, spacePath: SPACE, addToCanvas: true },
      harness.deps,
    )

    expect(result).toMatchObject({
      addedToCanvas: false,
      canvasSkipReason: COLOR_CARD_TEXT.skipRejected,
    })
  })
})

describe('saveColorCard · 参数与失败', () => {
  it('色值非法 → 抛中文错误，且一个字节都不写（不会悄悄换成默认色）', async () => {
    const harness = makeHarness()

    await expect(
      saveColorCard(
        { options: { ...OPTIONS, color: 'oops' }, spacePath: SPACE, addToCanvas: true },
        harness.deps,
      ),
    ).rejects.toThrow(COLOR_CARD_TEXT.invalidColor)

    expect(harness.written).toHaveLength(0)
    expect(harness.cards).toHaveLength(0)
  })

  it('没选输出文件夹 → 抛中文错误', async () => {
    const harness = makeHarness()

    await expect(
      saveColorCard(
        { options: { ...OPTIONS, outputDir: '   ' }, spacePath: SPACE, addToCanvas: true },
        harness.deps,
      ),
    ).rejects.toThrow(COLOR_CARD_TEXT.missingOutputDir)
  })

  it('写盘失败 → 原样向外抛（由界面统一包成「生成失败：…」）', async () => {
    const harness = makeHarness({
      writeBytes: async () => {
        throw new Error('磁盘已满')
      },
    })

    await expect(
      saveColorCard({ options: OPTIONS, spacePath: SPACE, addToCanvas: false }, harness.deps),
    ).rejects.toThrow('磁盘已满')
  })

  it('尺寸越界被夹紧后再生成（不报错）', async () => {
    const render = vi.fn(async () => new Uint8Array([1]))
    const harness = makeHarness({ render })

    await saveColorCard(
      {
        options: { ...OPTIONS, width: 99999, height: 1 },
        spacePath: SPACE,
        addToCanvas: false,
      },
      harness.deps,
    )

    expect(render).toHaveBeenCalledWith(expect.objectContaining({ width: 4096, height: 16 }))
  })
})
