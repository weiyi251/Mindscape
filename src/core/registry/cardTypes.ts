// ============================================================================
// 模块说明（中文）
// 卡片类型注册表。对应开发计划书第十三章「准备 4」。
//
// 内置三种核心类型（第一版）：
//   image —— 图片卡片（jpg / png / webp / gif / bmp）
//   file  —— 非图片文件卡片（pdf / dwg / skp / psd / mp4 …）
//   note  —— 文字便签（核心类型，承载"想法"本身）
//
// 渲染时按 card.type 查表（getCardTypeDef），新增类型只需注册一条，不改渲染逻辑。
// 插件类型由 pluginCenter.registerCardType 注册，本模块的查表函数会兜底到插件注册中心。
//
// ⚠️ 当前 render 的完成度：
//    file / note 是极简可视占位（文件=扩展名徽标+文件名 / 便签=文字内容）；
//    image 自 T1.4 起走真实图片渲染（经 17.10 的 assetProtocol 通道），
//    2026-09-12 方案 A 起直接加载原图（可见时由懒加载写入 src，无缩略图）。
//
// 实现任务：T0.10（准备层）/ T1.4（图片类型接入 asset 通道）。
// ============================================================================

import { createElement } from 'react'
import type { ReactNode } from 'react'

import type { Card, CoreCardType } from '@/core/types'
import { CORE_CARD_TYPES } from '@/core/types'
import { toAssetUrl } from '@/core/utils/media'
import { getCardOriginalPath } from '@/core/board/cardAssets'
import { tagsOfMeta } from '@/core/commands/impl/setCardMeta'
import type { CardRenderProps, CardTypeDef } from './pluginCenter'
import { getRegisteredCardType, listRegisteredCardTypes } from './pluginCenter'
import { CORE_CARD_MENU_ITEMS } from './menus'

// ---------------------------------------------------------------------------
// 展示用元数据
// ---------------------------------------------------------------------------

/** 中文显示名（界面文案统一在此处维护） */
export const CORE_CARD_TYPE_LABELS: Record<CoreCardType, string> = {
  image: '图片',
  file: '文件',
  note: '便签',
}

/**
 * 新建卡片时的默认尺寸（逻辑像素 / 画布坐标）。
 * ⚠️ 文档未给出默认尺寸，此处为准备层拟定值，阶段一按实际观感调整。
 */
export const CORE_CARD_TYPE_DEFAULT_SIZE: Record<CoreCardType, { w: number; h: number }> = {
  image: { w: 220, h: 220 },
  file: { w: 180, h: 96 },
  note: { w: 200, h: 160 },
}

// ---------------------------------------------------------------------------
// 渲染辅助
// ---------------------------------------------------------------------------

/** 取路径最后一段（兼容 Windows 反斜杠与 POSIX 斜杠） */
function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath
}

/** 取小写扩展名（无扩展名返回空串） */
function extname(filePath: string): string {
  const name = basename(filePath)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

// ---------------------------------------------------------------------------
// 卡片底部的「备注条 / 标签条」视觉规范（2026-09-11 用户裁决：两者必须一眼可分）：
//   · 备注条 —— 「文档」图标 + 灰底通栏文字（低调、可折行）；
//   · 标签条 —— 「标签」图标 + 苔绿胶囊 chip（形状、配色均与备注不同）；
//   · 两者同用 border-t 分隔、px-1.5 左右对齐，纵向依次排列，左边线对齐卡片内容。
// 图标用内联 SVG（stroke = currentColor），不引入任何图标库（10.1 约束）。
// ---------------------------------------------------------------------------

/** 12×12 线性小图标底座：尺寸 / 对齐统一，颜色随文字色（currentColor） */
function miniIcon(children: ReactNode, iconClass: string): ReactNode {
  return createElement(
    'svg',
    {
      key: 'icon',
      viewBox: '0 0 12 12',
      width: 11,
      height: 11,
      'aria-hidden': true,
      className: `mt-px shrink-0 ${iconClass}`,
    },
    children,
  )
}

/** 备注图标：文档 + 内容行 */
function noteIcon(): ReactNode {
  return miniIcon(
    [
      createElement('rect', {
        key: 'doc',
        x: 2,
        y: 1.5,
        width: 8,
        height: 9,
        rx: 1,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.1,
      }),
      createElement('path', {
        key: 'lines',
        d: 'M4 4.5h4M4 6.5h3',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.1,
        strokeLinecap: 'round',
      }),
    ],
    'text-muted-foreground/80',
  )
}

/** 标签图标：吊牌（右上斜挂 + 圆孔） */
function tagIcon(): ReactNode {
  return miniIcon(
    [
      createElement('path', {
        key: 'tag',
        d: 'M1.5 5.2V2.5a1 1 0 0 1 1-1h2.7L11 7.2 7.2 11 1.5 5.2z',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.1,
        strokeLinejoin: 'round',
      }),
      createElement('circle', { key: 'hole', cx: 3.9, cy: 3.9, r: 0.9, fill: 'currentColor' }),
    ],
    'text-primary/80',
  )
}

/**
 * 备注条（T3.3）：有备注时显示在卡片底部。
 * 任何核心类型都可以带备注（note 字段是 4.2 的通用字段）；
 * 便签（note 类型）整个卡片就是备注本体，不重复显示。
 */
function noteBar(card: Card): ReactNode {
  if (card.type === 'note' || card.note.trim() === '') return null
  return createElement(
    'div',
    {
      key: 'note-bar',
      'data-note-bar': '',
      className:
        'flex shrink-0 items-start gap-1 border-t border-border/60 bg-muted/40 px-1.5 py-1 text-[18px] leading-snug text-muted-foreground',
      title: card.note,
    },
    noteIcon(),
    createElement(
      'span',
      { key: 'text', className: 'min-w-0 flex-1 break-words' },
      card.note,
    ),
  )
}

/**
 * 标签条（T3.9 修复）：右键菜单「编辑标签」写入的 card.meta.tags 在这里显示。
 * ⚠️ 修复记录：此前标签只写进了 store / 落盘，任何类型都不渲染 ——
 * 「编辑标签」后在界面上无处可见。现三种核心类型底部统一显示标签条。
 */
function tagBar(card: Card): ReactNode {
  const tags = tagsOfMeta(card.meta)
  if (tags.length === 0) return null
  return createElement(
    'div',
    {
      key: 'tag-bar',
      'data-tag-bar': '',
      className:
        'flex shrink-0 flex-wrap items-center gap-1 border-t border-border/40 bg-primary/5 px-1.5 py-1',
    },
    tagIcon(),
    ...tags.map((tag) =>
      createElement(
        'span',
        {
          key: tag,
          className:
            'max-w-full truncate rounded-full border border-primary/25 bg-primary/10 px-1.5 py-px text-[18px] leading-snug text-primary',
          title: tag,
        },
        tag,
      ),
    ),
  )
}

/** 卡片外壳：统一选中态、圆角、底色，各类型只负责填内容 */
function shell(
  card: Card,
  selected: boolean,
  contentClass: string,
  children: ReactNode,
): ReactNode {
  return createElement(
    'div',
    {
      'data-card-id': card.id,
      'data-card-type': card.type,
      'data-selected': selected,
      className: [
        'relative flex h-full w-full overflow-hidden rounded-md border border-border bg-card text-foreground shadow-sm',
        selected ? 'ring-2 ring-primary' : '',
        contentClass,
      ].join(' '),
    },
    children,
  )
}

/** image：图片本体（可见时由 lazyOriginal 写入原图 src，见 canvas/lazyOriginal.ts） */
function renderImage({ card, selected }: CardRenderProps): ReactNode {
  const name = basename(card.filePath)
  const originalUrl = toAssetUrl(getCardOriginalPath(card.id))
  const note = noteBar(card)
  const tags = tagBar(card)

  // 图片必须**同时有确定宽和高**（flex-1 + min-h-0）才能让 object-contain 生效：
  //   · 只给 w-full 时，img 元素盒的高度会按"宽度 × 原图比例"自己撑开；
  //     卡片比原图更宽更扁（例如 480×135 装 16:9 图）时元素盒会比卡片高，
  //     多出的部分被外壳的 overflow-hidden 裁掉 —— 表现就是"图片显示不完整"。
  //   · 给成 flex-1（有备注条 / 标签条时自动让出它们的高度）后元素盒被容器约束，
  //     object-contain 才真正做"等比缩放 + 居中留白"，任何卡片尺寸下都完整不变形。
  // ⚠️ 卡片缩放本身也已锁定原图比例（cardResizeController），这里是渲染层兜底：
  //    旧布局里已经失真的卡片、以及带备注条的卡片都能正确显示。
  // 坐标写进 dataset，供原图懒加载在**不触发 React 更新**的前提下直接判交（17.3）；
  // src 初始为空（方案 A：不生成缩略图）——可见时由 lazyOriginal 把原图写进 img.src，
  // 视口外的卡片完全不加载（17.11 反模式 9）。
  const body = createElement('img', {
    key: 'image',
    'data-card-image': '',
    'data-original-url': originalUrl,
    'data-x': card.x,
    'data-y': card.y,
    'data-w': card.w,
    'data-h': card.h,
    alt: name,
    title: name,
    draggable: false,
    decoding: 'async',
    className: [
      'pointer-events-none min-h-0 w-full flex-1 select-none object-contain',
      // 原图 URL 缺失（非 Tauri 环境 / 未登记）时给一块可辨识的底色，不留白
      originalUrl ? '' : 'bg-muted/60 text-[11px] text-muted-foreground',
    ].join(' '),
  })

  return shell(card, selected, 'flex-col', [body, note, tags].filter(Boolean))
}

/** file：扩展名徽标 + 文件名（+ 备注条） */
function renderFile({ card, selected }: CardRenderProps): ReactNode {
  const note = noteBar(card)
  const tags = tagBar(card)
  const row = createElement('div', { key: 'row', className: 'flex min-h-0 flex-1 flex-row items-center gap-2 p-2' }, [
    createElement(
      'div',
      {
        key: 'ext',
        'data-placeholder': 'file-ext',
        className:
          'flex h-10 w-10 shrink-0 items-center justify-center rounded bg-secondary/15 text-[11px] font-semibold uppercase text-secondary',
      },
      extname(card.filePath) || 'FILE',
    ),
    createElement(
      'div',
      { key: 'name', className: 'truncate text-[18px]', title: basename(card.filePath) },
      basename(card.filePath),
    ),
  ])

  return shell(card, selected, 'flex-col', [row, note, tags].filter(Boolean))
}

/** note：便签文字（保留换行） */
function renderNote({ card, selected }: CardRenderProps): ReactNode {
  const text = card.note.trim()
  const tags = tagBar(card)
  return shell(card, selected, 'flex-col p-2', [
    createElement(
      'div',
      {
        key: 'text',
        'data-placeholder': 'note-text',
        className: [
          'overflow-hidden whitespace-pre-wrap break-words text-[18px] leading-relaxed',
          text ? '' : 'text-muted-foreground',
        ].join(' '),
      },
      text || '（空便签）',
    ),
    tags,
  ].filter(Boolean))
}

// ---------------------------------------------------------------------------
// 核心类型定义表
// ---------------------------------------------------------------------------

/**
 * 三种核心卡片类型。
 * menu 字段统一指向 CORE_CARD_MENU_ITEMS（共用一组配置，靠 appliesTo 区分），
 * 此处保留该字段是为了满足 17.8 的 CardTypeDef 接口形状。
 */
export const CORE_CARD_TYPE_DEFS: Record<CoreCardType, CardTypeDef> = {
  image: {
    type: 'image',
    render: renderImage,
    menu: CORE_CARD_MENU_ITEMS,
    defaultSize: CORE_CARD_TYPE_DEFAULT_SIZE.image,
  },
  file: {
    type: 'file',
    render: renderFile,
    menu: CORE_CARD_MENU_ITEMS,
    defaultSize: CORE_CARD_TYPE_DEFAULT_SIZE.file,
  },
  note: {
    type: 'note',
    render: renderNote,
    menu: CORE_CARD_MENU_ITEMS,
    defaultSize: CORE_CARD_TYPE_DEFAULT_SIZE.note,
  },
}

// ---------------------------------------------------------------------------
// 查表
// ---------------------------------------------------------------------------

/** 是否为内核自带的三种类型 */
export function isCoreCardType(type: string): type is CoreCardType {
  return (CORE_CARD_TYPES as readonly string[]).includes(type)
}

/**
 * 按类型取定义：核心优先，其次插件注册中心。
 * 两者都没有时返回 undefined —— 调用方负责用 file 类型兜底（未知类型一律按文件显示）。
 */
export function getCardTypeDef(type: string): CardTypeDef | undefined {
  if (isCoreCardType(type)) return CORE_CARD_TYPE_DEFS[type]
  return getRegisteredCardType(type)
}

/**
 * 已提示过"与核心同名"的插件类型 id。
 * 去重的原因：listCardTypes 可能被频繁调用（每次渲染列表），不能反复刷日志。
 */
const warnedDuplicateTypeIds = new Set<string>()

/**
 * 列出全部可用类型（核心在前，插件在后；插件若注册与核心同名则忽略，并提示一次）。
 */
export function listCardTypes(): CardTypeDef[] {
  const core = CORE_CARD_TYPES.map((type) => CORE_CARD_TYPE_DEFS[type])
  const plugin = listRegisteredCardTypes().filter((def) => {
    if (!isCoreCardType(def.type)) return true
    if (!warnedDuplicateTypeIds.has(def.type)) {
      warnedDuplicateTypeIds.add(def.type)
      console.warn(
        `[cardTypes] 插件注册的卡片类型「${def.type}」与核心类型同名，已忽略插件版本（核心优先）。`,
      )
    }
    return false
  })
  return [...core, ...plugin]
}

/** 清空"同名提示"去重记录。仅供单元测试使用。 */
export function resetCardTypeWarnings(): void {
  warnedDuplicateTypeIds.clear()
}

/** 取某卡片的渲染函数（未知类型按 file 兜底，保证画布上永远不出现空白卡片） */
export function renderCard(props: CardRenderProps): ReactNode {
  const def = getCardTypeDef(props.card.type) ?? CORE_CARD_TYPE_DEFS.file
  return def.render(props)
}
