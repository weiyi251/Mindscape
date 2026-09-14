// ============================================================================
// 模块说明（中文）
// 色卡 PNG 编码层（png.ts）的单元测试。
//
// 本项目不引入 jsdom，所以这里注入一块**假画布**：它记录收到的绘制指令与当时的
// fillStyle，从而把「按给定尺寸建画布 / 底色铺满 / 只画一块纯色 / 编码成 PNG」
// 这些真正会画错的地方在 node 环境钉死，而不必渲染真实像素。
//
// ⚠️ 2026-09-14 用户第二次收紧：色块内部不得出现任何色号文本或标签。
//    因此下面有一组**反向用例** —— 假上下文里故意多提供一个 fillText 探针，
//    断言它从未被调用。谁要是再把「把色号画进图」的代码加回来，这里立刻变红。
// ============================================================================

import { describe, expect, it, vi } from 'vitest'

import { COLOR_CARD_TEXT } from './text'
import { renderColorCardPng } from './png'
import type { ColorCardCanvas, ColorCardContext2D } from './png'

/** 记录绘制指令的假画布 */
function makeFakeCanvas() {
  const ops: string[] = []
  const sizes: { width: number; height: number }[] = []
  /** 探针：色卡不该调用它，调用即说明"色号被画进图片"的代码又回来了 */
  const fillText = vi.fn()

  const context = {
    fillStyle: 'unset',
    fillRect(x: number, y: number, width: number, height: number) {
      ops.push(`fillRect(${x},${y},${width},${height}) fill=${String(context.fillStyle)}`)
    },
    fillText,
  } as unknown as ColorCardContext2D

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

  return { createCanvas, ops, sizes, fillText, context }
}

describe('renderColorCardPng', () => {
  it('按给出的尺寸建画布、铺满底色、编码成 PNG', async () => {
    const fake = makeFakeCanvas()

    const bytes = await renderColorCardPng(
      { color: '#5A7D6A', width: 600, height: 400 },
      { createCanvas: fake.createCanvas },
    )

    expect(fake.sizes).toEqual([{ width: 600, height: 400 }])
    expect(fake.ops).toContain('fillRect(0,0,600,400) fill=#5A7D6A')
    expect(fake.ops).toContain('toBlob(image/png)')
    expect(bytes).toEqual(new Uint8Array([1, 2, 3, 4]))
  })

  it('色块内部不画任何文字：只铺一次底色，fillText 从未被调用', async () => {
    const fake = makeFakeCanvas()

    await renderColorCardPng(
      { color: '#5A7D6A', width: 400, height: 400 },
      { createCanvas: fake.createCanvas },
    )

    expect(fake.ops).toEqual(['fillRect(0,0,400,400) fill=#5A7D6A', 'toBlob(image/png)'])
    expect(fake.fillText).not.toHaveBeenCalled()
  })

  it('浅色底与深色底一视同仁（不会被"可读性"逻辑补上一个对比色文字）', async () => {
    for (const color of ['#EDE7DA', '#000000']) {
      const fake = makeFakeCanvas()
      await renderColorCardPng({ color, width: 200, height: 200 }, { createCanvas: fake.createCanvas })

      expect(fake.ops).toContain(`fillRect(0,0,200,200) fill=${color}`)
      expect(fake.fillText).not.toHaveBeenCalled()
    }
  })

  it('尺寸原样用（不夹紧）—— 夹紧是 normalizeOptions 的职责，本层不重复判断', async () => {
    const fake = makeFakeCanvas()
    await renderColorCardPng({ color: '#000000', width: 32, height: 512 }, { createCanvas: fake.createCanvas })
    expect(fake.sizes).toEqual([{ width: 32, height: 512 }])
  })

  it('色值未归一化时也按大写输出（归一化在写入前完成）', async () => {
    const fake = makeFakeCanvas()
    await renderColorCardPng(
      { color: '5a7d6a', width: 100, height: 100 },
      { createCanvas: fake.createCanvas },
    )
    expect(fake.ops).toContain('fillRect(0,0,100,100) fill=#5A7D6A')
  })

  it('色值非法时原样交给画布（不抛错、不静默换色；校验发生在 save 层）', async () => {
    const fake = makeFakeCanvas()
    await renderColorCardPng(
      { color: 'oops', width: 10, height: 10 },
      { createCanvas: fake.createCanvas },
    )
    expect(fake.ops).toContain('fillRect(0,0,10,10) fill=oops')
  })

  it('拿不到 2D 上下文 → 抛中文错误', async () => {
    const createCanvas = () =>
      ({
        getContext: () => null,
        toBlob: () => {},
      }) as unknown as ColorCardCanvas

    await expect(
      renderColorCardPng({ color: '#000000', width: 10, height: 10 }, { createCanvas }),
    ).rejects.toThrow(COLOR_CARD_TEXT.renderFailed)
  })

  it('编码返回 null → 抛中文错误', async () => {
    const createCanvas = (): ColorCardCanvas => ({
      getContext: () => ({ fillStyle: '', fillRect: vi.fn() }) satisfies ColorCardContext2D,
      toBlob: (callback) => callback(null),
    })

    await expect(
      renderColorCardPng({ color: '#000000', width: 10, height: 10 }, { createCanvas }),
    ).rejects.toThrow(COLOR_CARD_TEXT.encodeFailed)
  })
})
