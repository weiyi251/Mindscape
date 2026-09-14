// ============================================================================
// 模块说明（中文）
// 色卡的**落地编排**：参数 → PNG 字节 → 写入输出文件夹 →（可选）在画布上建卡。
//
// 为什么单独成文件：这一段是插件里唯一「有副作用、会失败、需要顺序」的逻辑，
// 也是最值得测的一段。它不 import 任何 Tauri / React，宿主能力（写文件、建卡、
// 取时间）全部由调用方注入，因此可以在 node 环境把成功、失败、跳过三种路径全测完。
//
// 两个刻意的设计：
//
//   1. **文件是产物，卡片是视图。** 用户要的是「PNG 存到指定文件夹」；
//      在画布上建卡只是顺手的便利。因此输出文件夹不在当前空间内时不是错误，
//      而是「只写文件」——返回结果里带上中文原因，由界面如实告知。
//
//   2. **建卡不进撤销栈**（undoable: false）。原因很硬：PNG 是插件现画的二进制，
//      没有任何「源文件」可供 redo 重新复制，若把它塞进 addCards 命令，
//      一次「撤销」就会删掉用户刚要的色卡文件，而 redo 再也造不回来。
//      卡片本身仍可被正常移除（走卡片自己的移除命令）。
// ============================================================================

import { metaWithHoverLabel } from '@/core/board/cardMeta'
import type { CreateCardInput } from '@/core/plugin/types'
import {
  DEFAULT_COLOR_CARD_OPTIONS,
  colorCardFileName,
  normalizeHex,
  normalizeOptions,
  validateColorCardOptions,
} from './options'
import type { ColorCardOptions } from './options'
import { renderColorCardPng } from './png'
import type { ColorCardPngInput } from './png'
import { COLOR_CARD_TEXT } from './text'

/** 色卡卡片写进 card.meta 的命名空间（= 插件 id，避免与他人撞键） */
export const COLOR_CARD_META_KEY = 'mindscape.color-card'

export interface SaveColorCardRequest {
  options: ColorCardOptions
  /** 当前空间文件夹绝对路径；未打开空间时为 null */
  spacePath: string | null
  /** 是否尝试在画布上建卡 */
  addToCanvas: boolean
}

export interface SaveColorCardResult {
  /** 实际写入的绝对路径（重名时可能带 _1 后缀，故以返回值而非预期值为准） */
  absolutePath: string
  /** 是否同时在画布上加了一张卡片 */
  addedToCanvas: boolean
  /** 未建卡时的中文原因；建卡成功或本就未要求时为 null */
  canvasSkipReason: string | null
}

export interface SaveColorCardDeps {
  /** 写字节到目标目录，返回实际写入的绝对路径（宿主：StorageProvider.writeFileBytes） */
  writeBytes: (destDir: string, fileName: string, bytes: Uint8Array) => Promise<string>
  /** 在画布上建卡（宿主：PluginBoardBridge.createCardFromFile）；未打开画布时为 undefined */
  createCardFromFile?: (input: CreateCardInput) => Promise<boolean>
  /** 渲染函数，测试可注入（默认走真实 Canvas） */
  render?: (input: ColorCardPngInput) => Promise<Uint8Array>
  /** 取当前时间，测试可注入（决定文件名里的时间戳） */
  now?: () => Date
}

/**
 * `path` 是否位于 `folder` 之内（**含 folder 自身**）。
 * 纯字符串比较：Windows 大小写不敏感，两种分隔符都归一化后再比前缀。
 *
 * 之所以不用 core/utils/paths.relativePathOf：那个函数在「前缀不匹配」时
 * 原样返回输入，调用方还得再判一次是否等于原串，语义绕；这里直接回答是/否。
 *
 * 含自身是刻意的：色卡的默认输出目录就是**空间根目录本身**，
 * 界面要据此判断「同时在画布上添加卡片」能不能勾。
 */
export function isPathWithin(path: string, folder: string): boolean {
  if (folder.trim() === '') return false
  const normalize = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const target = normalize(path)
  const base = normalize(folder)
  if (base === '') return false
  return target === base || target.startsWith(`${base}/`)
}

/**
 * 生成并保存一张色卡。
 * @throws Error 中文消息（参数非法 / 写盘失败），可直接展示给用户
 */
export async function saveColorCard(
  request: SaveColorCardRequest,
  deps: SaveColorCardDeps,
): Promise<SaveColorCardResult> {
  // ⚠️ 色值必须在**归一化之前**校验：normalizeOptions 的职责是「把坏值补成能用的一套」，
  //    若先归一化，用户手输错一个字符就会被静默换成默认色 —— 那是另一张色卡，不是他的。
  const rawColor = request.options.color ?? DEFAULT_COLOR_CARD_OPTIONS.color
  if (normalizeHex(rawColor) === null) throw new Error(COLOR_CARD_TEXT.invalidColor)

  const options = normalizeOptions(request.options)

  // 尺寸越界与色值一样，这里交给 normalizeOptions 夹紧（数字是滑杆/微调出来的，
  // 夹紧比报错友好）；剩下需要拦的只有「没选输出文件夹」。
  const problem = validateColorCardOptions(options)
  if (problem !== null) throw new Error(problem)

  // 渲染出的就是「一块纯色」—— 色号不进图片（2026-09-14 用户裁决），
  // 它只走下面建卡时的 meta.hoverLabel。见 png.ts 文件头说明。
  const render = deps.render ?? renderColorCardPng
  const bytes = await render({
    color: options.color,
    width: options.width,
    height: options.height,
  })

  const now = deps.now ?? (() => new Date())
  const fileName = colorCardFileName(options.namePrefix, options.color, now())
  const absolutePath = await deps.writeBytes(options.outputDir, fileName, bytes)

  if (!request.addToCanvas) {
    return { absolutePath, addedToCanvas: false, canvasSkipReason: null }
  }

  if (!deps.createCardFromFile) {
    return { absolutePath, addedToCanvas: false, canvasSkipReason: COLOR_CARD_TEXT.skipNoBridge }
  }
  if (!request.spacePath) {
    return { absolutePath, addedToCanvas: false, canvasSkipReason: COLOR_CARD_TEXT.skipNoSpace }
  }
  if (!isPathWithin(absolutePath, request.spacePath)) {
    return {
      absolutePath,
      addedToCanvas: false,
      canvasSkipReason: COLOR_CARD_TEXT.skipOutsideSpace,
    }
  }

  const relativePath = absolutePath
    .replace(/\\/g, '/')
    .slice(request.spacePath.replace(/\\/g, '/').replace(/\/+$/, '').length + 1)

  const added = await deps.createCardFromFile({
    relativePath,
    absolutePath,
    // 色卡就是一张 PNG，按核心 image 类型建卡：刷新空间后文件会被扫描器
    // 重新识别为同一张图片卡，卡片不会「只在本次会话里存在」。
    type: 'image',
    // 色号写进**通用**悬浮标记字段（meta.hoverLabel），而不是只放在插件自己的
    // 命名空间里：色卡 PNG 绝不把色值画进图（用户裁决），色号改由画布在悬停
    // 这张卡时显示在图片区域外的左下角（2026-09-14 第二次裁决，与右下角的
    // 分辨率徽章左右对称）—— 渲染层读的就是这个通用字段，
    // 它不认识「色卡插件」（见 core/board/cardMeta.ts）。
    meta: metaWithHoverLabel(
      {
        [COLOR_CARD_META_KEY]: {
          color: options.color,
          width: options.width,
          height: options.height,
        },
      },
      options.color,
    ),
    // 见文件头注释第 2 条：不进撤销栈
    undoable: false,
  })

  return {
    absolutePath,
    addedToCanvas: added,
    canvasSkipReason: added ? null : COLOR_CARD_TEXT.skipRejected,
  }
}
