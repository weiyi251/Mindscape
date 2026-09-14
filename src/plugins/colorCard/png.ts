// ============================================================================
// 模块说明（中文）
// 色卡的 PNG 编码层：用浏览器 Canvas 2D 把一套参数画成 PNG 字节。
//
// 为什么不用 Rust 生成：Tauri 侧没有图像编码依赖（17.1 依赖清单锁定，加 `image`
// crate 属于「清单外新增」），而 WebView2 自带 Canvas 2D —— 画 + `toBlob('image/png')`
// 就能拿到标准 PNG，落盘复用已有的 `write_file_bytes` 命令，**零 Rust 改动**。
//
// ⚠️ 色卡**只铺一层纯色，图内不画任何文字**（2026-09-14 用户裁决，第二次收紧）。
//   曾经有一个「在色卡上标注色值」的开关，把色号 fillText 到图片正中；用户明确
//   要求「确保色块内部不再展示任何色号文本或标签」—— 只把它默认关掉是不够的：
//   对话框会从 plugins.json 读回上次保存的 `showHex: true`，于是新生成的色卡依旧
//   带色号（用户截图 #0541F5 反馈）。所以整条文字绘制链路连同开关一并删除，
//   连同只为它服务的亮度计算 / 对比色选择（parseHexColor / relativeLuminance /
//   readableTextColor）也一并删掉，不留死代码。
//
//   色号改由卡片 meta.hoverLabel 承载，在画布上悬停该色卡时显示在**图片区域之外**
//   （见 core/registry/cardTypes.ts 的 hoverLabelChip）。顺带的好处：色卡导出到
//   别处时是一整块纯色，不会被文字破坏。
//
// 可测性（关键设计）：`document.createElement('canvas')` 是浏览器专有 API，
// 本项目不引入 jsdom（用户裁决），因此画布工厂是**可注入的** ——
// 测试注入一个记录绘制指令的假画布，就能把「底色铺满 / 尺寸正确 / 不画任何文字」
// 这些真正会画错的地方在 node 环境钉死，而不必渲染真实像素。
// ============================================================================

import { normalizeHex } from './options'
import { COLOR_CARD_TEXT } from './text'

/**
 * 本模块真正用到的最小 2D 上下文接口（故意声明得很窄，方便测试注入假实现）。
 * 只有「填色」一项 —— 色卡不画文字，所以既不需要 font / textAlign，也不需要 fillText。
 */
export interface ColorCardContext2D {
  /** 只写不读；真实 CanvasRenderingContext2D 的类型更宽，故此处放宽为 unknown */
  fillStyle: unknown
  fillRect: (x: number, y: number, width: number, height: number) => void
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
  // 「真实 CanvasRenderingContext2D 的类型比最小接口更宽」这一类型细节。
  return canvas as unknown as ColorCardCanvas
}

/** 画色卡需要的输入（色值应已归一化） */
export interface ColorCardPngInput {
  color: string
  width: number
  height: number
}

/**
 * 把一套参数渲染成 PNG 字节 —— 就是「一块纯色」，没有别的。
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

  // 整块铺满底色。**除此之外什么都不画**：色号不进图片（见文件头说明）
  context.fillStyle = color
  context.fillRect(0, 0, input.width, input.height)

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png')
  })
  if (blob === null) throw new Error(COLOR_CARD_TEXT.encodeFailed)

  return new Uint8Array(await blob.arrayBuffer())
}
