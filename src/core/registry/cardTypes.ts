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
// ⚠️ 当前 render 的完成度（2026-09-13 订正，原写「file / note 是极简可视占位」已不准确）：
//    file  = 扩展名徽标 + 文件名（仍是轻量渲染）；
//    note  = 完整便签（便签纸配色、行内编辑、四向缩放、备注条 / 标签条）；
//    image = 自 T1.4 起走真实图片渲染（经 17.10 的 assetProtocol 通道），
//            2026-09-12 方案 A 起直接加载原图（可见时由懒加载写入 src，无缩略图）。
//
// 实现任务：T0.10（准备层）/ T1.4（图片类型接入 asset 通道）。
// ⚠️ 本文件早已接线投产（Board 与卡片渲染都在用），不再是「准备层骨架」。
// ============================================================================

import { Fragment, createElement } from 'react'
import type { CSSProperties, ReactNode } from 'react'

import type { Card, CoreCardType } from '@/core/types'
import { CORE_CARD_TYPES } from '@/core/types'
import { toAssetUrl } from '@/core/utils/media'
import { getCardOriginalPath } from '@/core/board/cardAssets'
import { hoverLabelOfMeta, tagsOfMeta } from '@/core/board/cardMeta'
import {
  NOTE_BG_ALPHA,
  NOTE_BORDER_ALPHA,
  noteColorOfMeta,
} from '@/core/board/noteColors'
import {
  IMAGE_RESOLUTION_BADGE_ATTR,
  handleImageError,
  handleImageLoad,
} from './imageResolution'
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
//
// 【悬浮变体】（2026-09-13 用户裁决，两轮迭代）：图片卡上备注 / 标签**必须
// 在图片之外**——第一版左上角悬浮层仍压在图片内部（用户截图 2 反馈），
// 现改为**卡片盒上方外侧**（bottom-full 外挂），与图片内容零重叠；
// 卡片盒（w / h 与锁定比例）完全不变，悬浮层随卡片一同移动。
// 文件卡 / 便签仍用底部通栏（无图片比例问题）。
//
// 【悬浮标记 hoverLabel】（2026-09-14 用户裁决；位置同日第二次裁决改左下角）：
// 独立外挂元素承载 `card.meta.hoverLabel`（通用字段，见 core/board/cardMeta.ts），
// 挂在卡片盒**下方外侧左对齐** —— 与右下角的分辨率徽章左右对称（色号在左、
// 分辨率在右）。它**默认不显示**，鼠标悬停在卡片上时才淡入 —— 色卡插件把色号
// 写在这里，于是色卡图片本身保持纯净的一整块颜色，色号只在需要时出现在图片区域外。
// 显示与否走纯 CSS（group-hover），不经过 React state：悬停是高频事件，进 state
// 会触发重渲染，违反 17.3「高频交互不进 state」的红线。
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
 * 备注条（T3.3）：有备注时显示。任何核心类型都可以带备注（note 是 4.2 的通用字段）；
 * 便签（note 类型）整个卡片就是备注本体，不重复显示。
 * floating=true 时为图片卡悬浮层变体：去掉底部通栏的 border-t / 灰底，
 * 由外层悬浮容器统一提供底色与边框。
 */
function noteBar(card: Card, floating = false): ReactNode {
  if (card.type === 'note' || card.note.trim() === '') return null
  return createElement(
    'div',
    {
      key: 'note-bar',
      'data-note-bar': '',
      className: [
        'flex items-start gap-1 text-[18px] leading-snug text-muted-foreground',
        floating ? 'min-w-0 max-w-full' : 'shrink-0 border-t border-border/60 bg-muted/40 px-1.5 py-1',
      ].join(' '),
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
 * 「编辑标签」后在界面上无处可见。现三种核心类型统一显示标签条。
 * floating=true 时为图片卡悬浮层变体（见 noteBar 说明）。
 */
function tagBar(card: Card, floating = false): ReactNode {
  const tags = tagsOfMeta(card.meta)
  if (tags.length === 0) return null
  return createElement(
    'div',
    {
      key: 'tag-bar',
      'data-tag-bar': '',
      className: [
        'flex flex-wrap items-center gap-1',
        floating ? 'min-w-0 max-w-full' : 'shrink-0 border-t border-border/40 bg-primary/5 px-1.5 py-1',
      ].join(' '),
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

/**
 * 悬浮标记 chip（2026-09-14；位置 2026-09-14 第二次裁决改为**下方左下角**；
 * 2026-09-15 起改为由 belowCardStack 容器承载 —— chip 自身改为容器内的
 * 流内元素，不再自带定位类）：
 * `card.meta.hoverLabel` 有值时出现。
 * 这是**通用**能力 —— 核心只回答「这张卡有没有悬停标记」，至于标记是谁写的、
 * 什么含义，与核心无关（首个使用方是色卡插件，把色号写在这里）。
 *
 * 默认不可见，鼠标悬停在卡片上才淡入：用纯 CSS（group-hover）而不是 React 悬停
 * state —— 悬停是高频事件，进 state 会触发重渲染，违反 17.3 的红线。
 * `group` 类挂在 Card.tsx 的卡片根元素上。样式与分辨率徽章同一套（见 renderImage），
 * 视觉上成对出现。max-w-full truncate 兜底：标记再长也不越过卡片右缘。
 */
function hoverLabelChip(card: Card): ReactNode {
  const label = hoverLabelOfMeta(card.meta)
  if (label === null) return null
  return createElement(
    'span',
    {
      key: 'hover-label',
      'data-hover-label': '',
      // 等宽字体：色号是一串定长编码，等宽更整齐，也与「不是正文」的语义相符
      className:
        'max-w-full truncate rounded-md border border-border/70 ' +
        'bg-background/80 px-1.5 py-0.5 font-mono text-[11px] leading-snug text-foreground ' +
        'shadow-sm backdrop-blur-sm select-none pointer-events-none opacity-0 transition-opacity group-hover:opacity-100',
    },
    label,
  )
}

/**
 * 文件名 chip（2026-09-15 用户需求「在空间中要可以显示文件名字」）：
 * 图片卡此前完全没有可见的文件名（只有 alt / title 悬停提示），现在**常驻**
 * 显示在卡片盒下方外侧左对齐。文件卡已有文件名（renderFile 的主行）、
 * 便签没有文件，都不需要这个 chip。
 *
 * 常驻显示（不随悬停淡入）—— 文件名是用户「随时想核对」的信息，与
 * hoverLabel（色号，2026-09-14 裁决「默认不显示」）的可见性策略刻意不同。
 * 不可交互（pointer-events-none）：别抢画布的指针事件；truncate 兜底超长名。
 */
function fileNameChip(card: Card): ReactNode {
  return createElement(
    'span',
    {
      key: 'file-name',
      'data-file-name': '',
      className:
        'max-w-full truncate rounded-md border border-border/60 ' +
        'bg-background/80 px-1.5 py-0.5 text-[11px] leading-snug text-muted-foreground ' +
        'shadow-sm backdrop-blur-sm select-none pointer-events-none',
    },
    basename(card.filePath),
  )
}

/**
 * 卡片盒下方的外挂容器（2026-09-15 引入）：承载**常驻的文件名 chip** 与
 * **悬停淡入的悬浮标记（hoverLabel）**，两者同在卡片盒**下方外侧左对齐**
 * （与右下角的分辨率徽章左右对称），竖向堆叠互不遮挡。
 * 容器渲染在 shell **之外**（shell 有 overflow-hidden 会裁掉悬挂部分）；
 * absolute 的定位祖先仍是卡片根元素（Card.tsx 的定位容器）。
 */
function belowCardStack(card: Card): ReactNode {
  const hoverChip = hoverLabelChip(card)
  return createElement(
    'div',
    {
      key: 'below-stack',
      'data-below-stack': '',
      className:
        'absolute left-0 top-full z-20 mt-1.5 flex max-w-full flex-col items-start gap-1',
    },
    fileNameChip(card),
    hoverChip,
  )
}

/**
 * 图片卡顶部外挂层（2026-09-13 用户裁决，两轮迭代）：承载备注条 + 标签条。
 * 「图片之外」：absolute bottom-full 挂在卡片盒**上方外侧**（与图片零重叠）；
 * 定位祖先 = 卡片根元素（Card.tsx 的 absolute 定位容器），因此渲染在 shell
 * （带 overflow-hidden）之外也不会被裁剪。卡片盒的 w / h 与锁定比例完全不变，
 * 悬浮层随卡片一同移动。半透明底 + 模糊 + 边框 + 阴影：悬在画布上清晰可读。
 * 左缘与卡片对齐（left-0），多张卡片挂出的「标签牌」整齐统一。
 * 备注条与标签条**横排同行**（2026-09-13 第三轮用户反馈），超宽时整条换行。
 *
 * 【2026-09-14 第二次裁决】悬浮标记（hoverLabel，色号）已从本层移出 ——
 * 改为独立的下方左下角外挂元素（见 hoverLabelChip），与右下角的分辨率徽章
 * 左右对称；本层只剩**常驻**的备注 / 标签，两者都没有时直接不渲染。
 */
function imageOverlay(card: Card): ReactNode {
  const note = noteBar(card, true)
  const tags = tagBar(card, true)
  if (!note && !tags) return null
  return createElement(
    'div',
    {
      key: 'image-overlay',
      'data-image-overlay': '',
      // 横排同行（2026-09-13 第三轮用户反馈）：备注条与标签条**同一行**显示，
      // flex-wrap 兜底 —— 两者合计超宽时整条换行，不截断内容；items-center 让
      // 备注文字与标签胶囊在行内垂直居中，排版更紧凑美观
      className:
        'absolute bottom-full left-0 z-20 mb-1.5 flex max-w-full flex-row flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border/70 bg-background/95 px-2 py-1.5 shadow-sm backdrop-blur-sm',
    },
    [note, tags].filter(Boolean),
  )
}

// ---------------------------------------------------------------------------
// 卡片视觉（底色 / 边框 / 阴影）由各类型显式传入 shell。
// shell 的基础类不再写死这三项 —— core 层不得依赖 tailwind-merge（架构守卫
// 规则 4：core 不 import lib），无法用 cn() 消解同组冲突类，干脆不制造冲突。
// ---------------------------------------------------------------------------

/** 默认卡片视觉：纯白底 + 常规边框 + 轻阴影（image / file 用） */
const CARD_VISUAL_DEFAULT = 'border-border bg-card shadow-sm'

/** 便签视觉（2026-09-13 用户裁决：浅色模式下 bg-card 与米白画布背景过于接近
 *  看不清）——专属「便签纸」底色（globals.css --note，浅色淡黄 / 深色暗琥珀灰）
 *  + 加深边框 + 阴影提级；深浅主题都经语义变量生效。 */
const NOTE_VISUAL = 'border-foreground/25 bg-note shadow-md'

/** 便签自定义色视觉（2026-09-15 用户需求）：底色 / 边框改由内联样式按
 *  「色值 + 透明度后缀」提供（与分区框同款，主题安全），类里只留阴影。 */
const NOTE_VISUAL_CUSTOM = 'border-transparent shadow-md'

/** 卡片外壳：统一选中态、圆角，各类型负责填内容与视觉色。
 *  contentClass 必须自带底色 / 边框色 / 阴影（见上方常量），这里不提供默认值。
 *  style 为可选内联样式（2026-09-15 便签自定义色引入：语义类表达不了的
 *  「用户挑选的动态色值」走内联样式，内联优先级天然覆盖类里的占位色）。 */
function shell(
  card: Card,
  selected: boolean,
  contentClass: string,
  children: ReactNode,
  style?: CSSProperties,
): ReactNode {
  return createElement(
    'div',
    {
      'data-card-id': card.id,
      'data-card-type': card.type,
      'data-selected': selected,
      className: [
        'relative flex h-full w-full overflow-hidden rounded-md border text-foreground',
        selected ? 'ring-2 ring-primary' : '',
        contentClass,
      ]
        .filter(Boolean)
        .join(' '),
      style,
    },
    children,
  )
}

/** image：图片本体（可见时由 lazyOriginal 写入原图 src，见 canvas/lazyOriginal.ts） */
function renderImage({ card, selected }: CardRenderProps): ReactNode {
  const name = basename(card.filePath)
  const originalUrl = toAssetUrl(getCardOriginalPath(card.id))
  // 备注 / 标签走顶部外挂层（2026-09-13 用户裁决）：渲染在卡片盒**上方外侧**，
  // 与图片零重叠；卡片盒尺寸比例完全不变，随卡片一同移动（见 imageOverlay 说明）。
  // 悬浮标记（色号）与分辨率徽章走**下方**左右两角（2026-09-14 第二次裁决）
  const overlay = imageOverlay(card)

  // 图片必须**同时有确定宽和高**（flex-1 + min-h-0）才能让 object-contain 生效：
  //   · 只给 w-full 时，img 元素盒的高度会按"宽度 × 原图比例"自己撑开；
  //     卡片比原图更宽更扁（例如 480×135 装 16:9 图）时元素盒会比卡片高，
  //     多出的部分被外壳的 overflow-hidden 裁掉 —— 表现就是"图片显示不完整"。
  //   · 给成 flex-1（外挂层在卡片盒之外，不参与布局，图片元素盒恒占满卡片）后
  //     元素盒被容器约束，object-contain 才真正做"等比缩放 + 居中留白"，
  //     任何卡片尺寸下都完整不变形。
  // ⚠️ 卡片缩放本身也已锁定原图比例（cardResizeController），这里是渲染层兜底：
  //    旧布局里已经失真的卡片都能正确显示。
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
    // 实际分辨率徽章的数据源（2026-09-14 用户要求）：加载完成 / 失败时由
    // imageResolution 直写下方徽章文本（不走 state，见 imageResolution.ts 文件头）
    onLoad: handleImageLoad,
    onError: handleImageError,
    className: [
      'pointer-events-none min-h-0 w-full flex-1 select-none object-contain',
      // 原图 URL 缺失（非 Tauri 环境 / 未登记）时给一块可辨识的底色，不留白
      originalUrl ? '' : 'bg-muted/60 text-[11px] text-muted-foreground',
    ].join(' '),
  })

  const shellEl = shell(card, selected, `flex-col ${CARD_VISUAL_DEFAULT}`, [body])

  // 卡片盒下方外侧左对齐的外挂容器（2026-09-15）：常驻文件名 chip + 悬停淡入的
  // 悬浮标记（色号等），竖向堆叠 —— 与右下角的分辨率徽章左右对称；上方外挂层
  // 只留常驻的备注 / 标签
  const belowStack = belowCardStack(card)

  // 实际分辨率徽章（2026-09-14 用户要求）：悬停在卡片盒**下方外侧**右对齐淡入
  // 「宽 × 高」。⚠️ 三个刻意的设计（详见 imageResolution.ts 文件头）：
  //   · 常驻渲染 + 初始 hidden —— load / error 事件触发时徽章必须在 DOM 里等着
  //     被写入；文本写进之前一直隐藏，悬停不会出现空胶囊；
  //   · 元素不带 children —— 文本由 imageResolution 直写 textContent，
  //     后续任何 React 重渲染都不会把它清掉；
  //   · 淡入淡出走纯 CSS group-hover（悬停是高频事件，绝不进 state，17.3）。
  const resolutionBadge = createElement('span', {
    key: 'image-resolution-badge',
    [IMAGE_RESOLUTION_BADGE_ATTR]: '',
    className:
      'absolute right-0 top-full z-20 mt-1.5 hidden rounded-md border border-border/70 ' +
      'bg-background/80 px-1.5 py-0.5 font-mono text-[11px] leading-snug text-foreground ' +
      'shadow-sm backdrop-blur-sm pointer-events-none select-none opacity-0 transition-opacity group-hover:opacity-100',
  })

  // 外挂层 / 下方外挂容器 / 分辨率徽章都必须渲染在 shell **之外**（shell 有
  // overflow-hidden 会裁掉悬挂部分）；Fragment 内 absolute 的定位祖先仍是
  // 卡片根元素（Card.tsx 的定位容器）
  return createElement(Fragment, { key: 'image-root' }, shellEl, overlay, belowStack, resolutionBadge)
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

  return shell(card, selected, `flex-col ${CARD_VISUAL_DEFAULT}`, [row, note, tags].filter(Boolean))
}

/** note：便签文字（保留换行）。
 * 编辑态（noteEditing）不渲染正文与占位文字：行内编辑的 textarea 是
 * bg-transparent（透出便签纸底色），底下的占位文字「（空便签）」若照常渲染，
 * 会与用户正在输入的草稿重叠、显示不清（2026-09-13 用户截图反馈）——
 * 编辑中正文完全交给 textarea，这里只留卡片盒与标签条。
 *
 * 【自定义颜色】（2026-09-15 用户需求）：meta.noteColor 有值时底色 / 边框
 * 走「色值 + 透明度后缀」内联样式（见 noteColors.ts 文件头），类改用
 * NOTE_VISUAL_CUSTOM（透明边框占位 + 阴影）；无值维持默认便签纸。 */
function renderNote({ card, selected, noteEditing }: CardRenderProps): ReactNode {
  const text = card.note.trim()
  const tags = tagBar(card)
  const noteColor = noteColorOfMeta(card.meta)
  const contentClass = noteColor
    ? `flex-col p-2 ${NOTE_VISUAL_CUSTOM}`
    : `flex-col p-2 ${NOTE_VISUAL}`
  const style: CSSProperties | undefined = noteColor
    ? {
        backgroundColor: noteColor + NOTE_BG_ALPHA,
        borderColor: noteColor + NOTE_BORDER_ALPHA,
      }
    : undefined
  return shell(card, selected, contentClass, [
    createElement(
      'div',
      {
        key: 'text',
        'data-placeholder': 'note-text',
        className: [
          'overflow-hidden whitespace-pre-wrap break-words text-[18px] leading-relaxed',
          text && !noteEditing ? '' : 'text-muted-foreground',
        ].join(' '),
      },
      // 编辑中一律渲染空字符串：占位文字立即消失，输入内容清晰可见
      noteEditing ? '' : text || '（空便签）',
    ),
    tags,
  ].filter(Boolean), style)
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
 * 该类型的缩放手柄模式（2026-09-17）：default = 右下角（便签另有三边手柄）；
 * widthOnly = 仅左缘中点（插件卡片的高度按内容自适应，不允许拖高）。
 * 未注册 / 未声明的类型一律 default，行为与旧版完全一致。
 */
export function resizeHandleModeFor(type: string): 'default' | 'widthOnly' {
  return getCardTypeDef(type)?.resizeHandles === 'widthOnly' ? 'widthOnly' : 'default'
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
