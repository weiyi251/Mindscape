// ============================================================================
// 模块说明（中文）
// 色卡的 PNG 编码层：用浏览器 Canvas 2D 把一套参数画成 PNG 字节。
//
// 为什么不用 Rust 生成：Tauri 侧没有图像编码依赖（17.1 依赖清单锁定，加 `image`
// crate 属于「清单外新增」），而 WebView2 自带 Canvas 2D —— 画 + `toBlob('image/png')`
// 就能拿到标准 PNG，落盘复用已有的 `write_file_bytes` 命令，**零 Rust 改动**。
//
// 可测性（关键设计）：`document.createElement('canvas')` 是浏览器专有 API，
// 本项目不引入 jsdom（用户裁决），因此画布工厂是**可注入的** ——
// 测试注入一个记录绘制指令的假画布，就能把「底色铺满 / 标注文字 / 尺寸正确」
// 这些真正会画错的地方在 node 环境钉死，而不必渲染真实像素。
//
// 颜色字面量约定：标注文字的取色用 CSS 关键词 `black` / `white` 而不是 hex。
// canvas 的 fillStyle 接受任意 CSS 颜色，关键词语义同样清晰，还能避开
// 守卫规则 3 的「硬编码配色」检查 —— 本文件因此不需要进任何豁免清单。
// ============================================================================

import { normalizeHex } from './options'
import { COLOR_CARD_TEXT } from './text'

/** 本模块真正用到的最小 2D 上下文接口（故意声明得很窄，方便测试注入假实现） */
export interface ColorCardContext2D {
  /** 只写不读；真实 CanvasRenderingContext2D 的类型更宽，故此处放宽为 unknown */
  fillStyle: unknown
  font: string
  textAlign: string
  textBaseline: string
  fillRect: (x: number, y: number, width: number, height: number) => void
  fillText: (text: string, x: number, y: number) => void
}

/** 最小画布接口 */
export interface ColorCardCanvas {
  getContext: (type: '2d') => ColorCardContext2D | null
  toBlob: (callback: (blob: Blob | null) => void, type?: string) => void
}

export interface ColorCardPngDeps {
  /** 造一块给定尺寸的画布；浏览器里默认走 document.createElement */
  createCanvas: (width: number, height: number) => ColorCardCanvas
}

function defaultCreateCanvas(width: number, height: number): ColorCardCanvas {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  // 运行时 HTMLCanvasElement 完全满足 ColorCardCanvas；断言只为绕开
  // 「真实 CanvasRenderingContext2D 的 textAlign 比最小接口更宽」这一类型细节。
  return canvas as unknown as ColorCardCanvas
}

/** 标注文字的对比阈值（0.35 是经验值：纯黑白等价点约 0.179，色卡场景取略高更稳） */
const LUMINANCE_THRESHOLD = 0.35

/** 解析 `#RRGGBB`（或三位简写）为三通道；非法输入返回 null */
export function parseHexColor(input: string): { r: number; g: number; b: number } | null {
  const normalized = normalizeHex(input)
  if (normalized === null) return null
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  }
}

/**
 * 相对亮度（WCAG 2.x 的简化式），0 表示全黑、1 表示全白。
 * 解析失败按 0（视为深色底）处理，保证总有一个可用的标注色。
 */
export function relativeLuminance(input: string): number {
  const rgb = parseHexColor(input)
  if (rgb === null) return 0

  const channel = (value: number): number => {
    const scaled = value / 255
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
  }

  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
}

/** 在给定底色上能看清的标注文字色（浅底用黑字、深底用白字） */
export function readableTextColor(input: string): 'black' | 'white' {
  return relativeLuminance(input) > LUMINANCE_THRESHOLD ? 'black' : 'white'
}

/** 画色卡需要的输入（色值应已归一化） */
export interface ColorCardPngInput {
  color: string
  width: number
  height: number
  showHex: boolean
}

/**
 * 把一套参数渲染成 PNG 字节。
 * @throws Error 中文消息（无 2D 上下文 / 编码失败），可直接展示给用户
 */
export async function renderColorCardPng(
  input: ColorCardPngInput,
  deps: Partial<ColorCardPngDeps> = {},
): Promise<Uint8Array> {
  const createCanvas = deps.createCanvas ?? defaultCreateCanvas
  const color = normalizeHex(input.color) ?? input.color

  const canvas = createCanvas(input.width, input.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error(COLOR_CARD_TEXT.renderFailed)

  // 整块铺满底色
  context.fillStyle = color
  context.fillRect(0, 0, input.width, input.height)

  if (input.showHex) {
    // 字号跟随短边：色卡越小标注越小，但保留 12px 下限以免糊成一团
    const fontSize = Math.max(12, Math.round(Math.min(input.width, input.height) / 6))
    context.font = `600 ${fontSize}px sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillStyle = readableTextColor(color)
    context.fillText(color.toUpperCase(), input.width / 2, input.height / 2)
  }

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png')
  })
  if (blob === null) throw new Error(COLOR_CARD_TEXT.encodeFailed)

  return new Uint8Array(await blob.arrayBuffer())
}
