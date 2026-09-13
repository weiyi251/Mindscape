// ============================================================================
// 模块说明（中文）
// 色卡 PNG 编码层（png.ts）的单元测试。
//
// 本项目不引入 jsdom，所以这里注入一块**假画布**：它记录收到的绘制指令与
// 当时的 fillStyle / font，从而把「底色铺满 / 标注文字 / 尺寸正确 / 文字色可读」
// 这些真正会画错的地方在 node 环境钉死，而不必渲染真实像素。
// ============================================================================

import { describe, expect, it, vi } from 'vitest'

import { COLOR_CARD_TEXT } from './text'
import {
  parseHexColor,
  readableTextColor,
  relativeLuminance,
  renderColorCardPng,
} from './png'
import type { ColorCardCanvas, ColorCardContext2D } from './png'

/** 记录绘制指令的假画布 */
function makeFakeCanvas() {
  const ops: string[] = []
  const sizes: { width: number; height: number }[] = []

  const context: ColorCardContext2D = {
    fillStyle: 'unset',
    font: '',
    textAlign: '',
    textBaseline: '',
    fillRect(x, y, width, height) {
      ops.push(`fillRect(${x},${y},${width},${height}) fill=${String(context.fillStyle)}`)
    },
    fillText(text, x, y) {
      ops.push(
        `fillText(${text},${x},${y}) fill=${String(context.fillStyle)} font=${context.font}`,
      )
    },
  }

  const createCanvas = (width: number, height: number): ColorCardCanvas => {
    sizes.push({ width, height })
    return {
      getContext: (type) => (type === '2d' ? context : null),
      toBlob: (callback, type) => {
        ops.push(`toBlob(${String(type)})`)
        callback({
          arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
        } as unknown as Blob)
      },
    }
  }

  return { createCanvas, ops, sizes, context }
}

describe('parseHexColor / relativeLuminance / readableTextColor', () => {
  it('解析三位与六位色值；非法输入返回 null', () => {
    expect(parseHexColor('#5A7D6A')).toEqual({ r: 90, g: 125, b: 106 })
    expect(parseHexColor('#fff')).toEqual({ r: 255, g: 255, b: 255 })
    expect(parseHexColor('bad!')).toBeNull()
  })

  it('相对亮度：纯白 1、纯黑 0，非法输入按 0 处理', () => {
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5)
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5)
    expect(relativeLuminance('bad!')).toBe(0)
  })

  it('标注文字色：浅底用黑字、深底用白字', () => {
    expect(readableTextColor('#FFFFFF')).toBe('black')
    expect(readableTextColor('#EDE7DA')).toBe('black')
    expect(readableTextColor('#000000')).toBe('white')
    expect(readableTextColor('#3F4145')).toBe('white')
  })
})

describe('renderColorCardPng', () => {
  it('按给出的尺寸建画布、铺满底色、标注色值、编码成 PNG', async () => {
    const fake = makeFakeCanvas()

    const bytes = await renderColorCardPng(
      { color: '#5A7D6A', width: 600, height: 400, showHex: true },
      { createCanvas: fake.createCanvas },
    )

    expect(fake.sizes).toEqual([{ width: 600, height: 400 }])
    expect(fake.ops).toContain('fillRect(0,0,600,400) fill=#5A7D6A')
    // 标注文字用大写色值，字色是「在苔绿上看得清」的白
    expect(fake.ops.some((op) => op.startsWith('fillText(#5A7D6A,300,200) fill=white'))).toBe(true)
    expect(fake.ops).toContain('toBlob(image/png)')
    expect(bytes).toEqual(new Uint8Array([1, 2, 3, 4]))
  })

  it('关掉标注时只铺底色，不画文字', async () => {
    const fake = makeFakeCanvas()

    await renderColorCardPng(
      { color: '#EDE7DA', width: 200, height: 200, showHex: false },
      { createCanvas: fake.createCanvas },
    )

    expect(fake.ops).toContain('fillRect(0,0,200,200) fill=#EDE7DA')
    expect(fake.ops.some((op) => op.startsWith('fillText'))).toBe(false)
  })

  it('字号跟随短边、保留 12px 下限', async () => {
    const tiny = makeFakeCanvas()
    await renderColorCardPng(
      { color: '#000000', width: 32, height: 32, showHex: true },
      { createCanvas: tiny.createCanvas },
    )
    expect(tiny.ops.some((op) => op.includes('font=600 12px sans-serif'))).toBe(true)

    const large = makeFakeCanvas()
    await renderColorCardPng(
      { color: '#000000', width: 600, height: 600, showHex: true },
      { createCanvas: large.createCanvas },
    )
    expect(large.ops.some((op) => op.includes('font=600 100px sans-serif'))).toBe(true)
  })

  it('色值未归一化时也按大写输出（归一化在写入前完成）', async () => {
    const fake = makeFakeCanvas()
    await renderColorCardPng(
      { color: '5a7d6a', width: 100, height: 100, showHex: true },
      { createCanvas: fake.createCanvas },
    )
    expect(fake.ops).toContain('fillRect(0,0,100,100) fill=#5A7D6A')
    expect(fake.ops.some((op) => op.startsWith('fillText(#5A7D6A,'))).toBe(true)
  })

  it('拿不到 2D 上下文 → 抛中文错误', async () => {
    const createCanvas = () => ({
      getContext: () => null,
      toBlob: () => {},
    }) as unknown as ColorCardCanvas

    await expect(
      renderColorCardPng({ color: '#000000', width: 10, height: 10, showHex: false }, { createCanvas }),
    ).rejects.toThrow(COLOR_CARD_TEXT.renderFailed)
  })

  it('编码返回 null → 抛中文错误', async () => {
    const createCanvas = (): ColorCardCanvas => ({
      getContext: () =>
        ({
          fillStyle: '',
          font: '',
          textAlign: '',
          textBaseline: '',
          fillRect: vi.fn(),
          fillText: vi.fn(),
        }) satisfies ColorCardContext2D,
      toBlob: (callback) => callback(null),
    })

    await expect(
      renderColorCardPng({ color: '#000000', width: 10, height: 10, showHex: false }, { createCanvas }),
    ).rejects.toThrow(COLOR_CARD_TEXT.encodeFailed)
  })
})
