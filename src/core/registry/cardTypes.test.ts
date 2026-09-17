// ============================================================================
// 模块说明（中文）
// 卡片类型注册表单元测试。覆盖 T0.10 验收标准中「三种核心卡片类型」部分：
//   · 三种核心类型可查表
//   · 三种类型渲染结果可区分（极简可视占位）
//   · 未知类型按文件卡片兜底，不出现空白卡片
//   · 插件类型可查表且排在核心类型之后
//
// 实现任务：T0.10（准备层）。
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { CORE_CARD_TYPES, zCardSchema } from '@/core/types'
import type { Card } from '@/core/types'
import { registerCardType, resetPluginCenter } from '@/core/registry/pluginCenter'
import { clearCardAssets, setCardAsset } from '@/core/board/cardAssets'
import {
  CORE_CARD_TYPE_DEFS,
  CORE_CARD_TYPE_LABELS,
  CORE_CARD_TYPE_DEFAULT_SIZE,
  getCardTypeDef,
  isCoreCardType,
  listCardTypes,
  renderCard,
  resetCardTypeWarnings,
} from '@/core/registry/cardTypes'

function makeCard(over: Partial<Card> = {}): Card {
  return zCardSchema.parse({
    id: 'card-1',
    type: 'image',
    filePath: '参考资料/ref-01.jpg',
    originalPath: '参考资料/ref-01.jpg',
    x: 0,
    y: 0,
    w: 220,
    h: 220,
    ...over,
  })
}

beforeEach(() => {
  resetPluginCenter()
  resetCardTypeWarnings()
  clearCardAssets()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('核心卡片类型', () => {
  it('恰好三种，且与 core/types 的 CORE_CARD_TYPES 一致', () => {
    expect(CORE_CARD_TYPES).toEqual(['image', 'file', 'note'])
    for (const type of CORE_CARD_TYPES) {
      expect(CORE_CARD_TYPE_DEFS[type].type).toBe(type)
    }
  })

  it('每种类型都有中文显示名与默认尺寸', () => {
    expect(CORE_CARD_TYPE_LABELS).toEqual({ image: '图片', file: '文件', note: '便签' })
    for (const type of CORE_CARD_TYPES) {
      const size = CORE_CARD_TYPE_DEFAULT_SIZE[type]
      expect(size.w).toBeGreaterThan(0)
      expect(size.h).toBeGreaterThan(0)
    }
  })

  it('isCoreCardType 只认三种核心类型', () => {
    expect(isCoreCardType('image')).toBe(true)
    expect(isCoreCardType('note')).toBe(true)
    expect(isCoreCardType('plugin-card')).toBe(false)
  })

  it('三种核心类型的 menu 指向同一组配置（共用一组 + appliesTo 过滤）', () => {
    const menus = CORE_CARD_TYPES.map((type) => CORE_CARD_TYPE_DEFS[type].menu)
    expect(menus[0]).toBe(menus[1])
    expect(menus[1]).toBe(menus[2])
  })
})

describe('getCardTypeDef 查表', () => {
  it('核心类型直接命中', () => {
    expect(getCardTypeDef('note')).toBe(CORE_CARD_TYPE_DEFS.note)
  })

  it('未知类型返回 undefined', () => {
    expect(getCardTypeDef('nope')).toBeUndefined()
  })

  it('插件注册的类型可查到', () => {
    const def = {
      type: 'plugin-card',
      render: () => null,
      menu: [],
      defaultSize: { w: 10, h: 10 },
    }
    registerCardType(def)

    expect(getCardTypeDef('plugin-card')).toBe(def)
  })
})

describe('listCardTypes', () => {
  it('核心三种在前，插件类型在后', () => {
    registerCardType({
      type: 'plugin-card',
      render: () => null,
      menu: [],
      defaultSize: { w: 10, h: 10 },
    })

    expect(listCardTypes().map((def) => def.type)).toEqual(['image', 'file', 'note', 'plugin-card'])
  })

  it('插件注册与核心同名时忽略插件版本并提示', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registerCardType({ type: 'image', render: () => null, menu: [], defaultSize: { w: 1, h: 1 } })

    const types = listCardTypes().map((def) => def.type)
    expect(types).toEqual(['image', 'file', 'note'])
    expect(warn).toHaveBeenCalledTimes(1)

    // 再列一次不会重复刷日志（去重生效）
    listCardTypes()
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// 渲染（用 renderToStaticMarkup 断言真实 DOM 输出）
// ---------------------------------------------------------------------------

describe('三种核心类型的渲染可区分', () => {
  it('image：输出真实图片元素（缩略图未就绪时留空 src）', () => {
    const html = renderToStaticMarkup(
      renderCard({ card: makeCard({ type: 'image' }), selected: false }),
    )

    expect(html).toContain('data-card-type="image"')
    expect(html).toContain('data-card-image')
    expect(html).toContain('alt="ref-01.jpg"')
    // 图片用 contain 等比缩放不变形；且必须有确定高度（flex-1 + min-h-0），
    // 否则 img 元素盒会按"宽度 × 原图比例"自行撑高，被 overflow-hidden 裁掉
    const imgTag = html.match(/<img[^>]*>/)?.[0] ?? ''
    expect(imgTag).toContain('object-contain')
    expect(imgTag).toContain('flex-1')
    expect(imgTag).toContain('min-h-0')
    expect(html).not.toContain('（空便签）')
  })

  it('image：把坐标与原图地址写进 dataset（供原图懒加载直接判交）', () => {
    setCardAsset('card-1', { originalPath: 'D:\\s\\a.jpg' })

    const html = renderToStaticMarkup(
      renderCard({ card: makeCard({ type: 'image' }), selected: false }),
    )

    expect(html).toContain('data-original-url')
    expect(html).toContain('data-x="0"')
    expect(html).toContain('data-y="0"')
    expect(html).toContain('data-w="220"')
    expect(html).toContain('data-h="220"')
  })

  it('image：src 初始为空（方案 A：可见时才由懒加载写入原图）', () => {
    setCardAsset('card-1', { originalPath: 'D:\\s\\a.jpg' })

    const html = renderToStaticMarkup(
      renderCard({ card: makeCard({ type: 'image' }), selected: false }),
    )

    expect(html).not.toContain('src=')
  })

  it('image：缩略图缺失时加兜底底色类名，不留白', () => {
    const html = renderToStaticMarkup(
      renderCard({ card: makeCard({ type: 'image' }), selected: false }),
    )

    expect(html).toContain('bg-muted/60')
  })

  it('file：输出大写扩展名徽标 + 文件名', () => {
    const html = renderToStaticMarkup(
      renderCard({ card: makeCard({ type: 'file', filePath: '方案/总平面.pdf' }), selected: false }),
    )

    expect(html).toContain('data-card-type="file"')
    expect(html).toContain('data-placeholder="file-ext"')
    expect(html).toContain('>pdf<')
    expect(html).toContain('总平面.pdf')
  })

  it('note：输出便签文字内容（保留换行）', () => {
    const html = renderToStaticMarkup(
      renderCard({
        card: makeCard({ type: 'note', filePath: '', note: '第一行\n第二行' }),
        selected: false,
      }),
    )

    expect(html).toContain('data-card-type="note"')
    expect(html).toContain('data-placeholder="note-text"')
    expect(html).toContain('第一行')
  })

  it('note 内容为空时显示占位文案', () => {
    const html = renderToStaticMarkup(
      renderCard({ card: makeCard({ type: 'note', filePath: '', note: '  ' }), selected: false }),
    )

    expect(html).toContain('（空便签）')
  })

  it('note 编辑态不渲染正文与占位文字（textarea 透明底，占位文字会与输入草稿重叠）', () => {
    // 2026-09-13 用户截图反馈：编辑时「（空便签）」压在正在输入的文字上。
    // 编辑中正文交给覆盖整个卡片盒的 textarea，渲染层一律输出空内容
    const emptyHtml = renderToStaticMarkup(
      renderCard({
        card: makeCard({ type: 'note', filePath: '', note: '' }),
        selected: false,
        noteEditing: true,
      }),
    )
    expect(emptyHtml).not.toContain('（空便签）')

    // 已有内容的便签进入编辑态同样不再重复渲染正文（避免两层文字叠加）
    const withTextHtml = renderToStaticMarkup(
      renderCard({
        card: makeCard({ type: 'note', filePath: '', note: '旧内容' }),
        selected: false,
        noteEditing: true,
      }),
    )
    expect(withTextHtml).not.toContain('旧内容')

    // 卡片盒本体仍然渲染（textarea 只是覆盖层，底色/边框来自 shell）
    expect(emptyHtml).toContain('data-card-type="note"')
  })

  it('选中态输出 ring 高亮类名', () => {
    const html = renderToStaticMarkup(
      renderCard({ card: makeCard({ type: 'image' }), selected: true }),
    )

    expect(html).toContain('data-selected="true"')
    expect(html).toContain('ring-2')
  })

  it('未知类型按 file 兜底，画布上不出现空白卡片', () => {
    const html = renderToStaticMarkup(
      renderCard({ card: makeCard({ type: 'unknown-type' }), selected: false }),
    )

    expect(html).toContain('data-placeholder="file-ext"')
  })
})

// ---------------------------------------------------------------------------
// 便签自定义颜色（2026-09-15 用户需求）：meta.noteColor 有值时底色 / 边框
// 走「色值 + 透明度后缀」内联样式（与分区框同款，主题安全）；无值 / 脏数据
// 一律回到默认便签纸（bg-note 语义变量）。见 core/board/noteColors.ts。
// ---------------------------------------------------------------------------

describe('便签自定义颜色（meta.noteColor）', () => {
  function noteHtml(meta: Card['meta']): string {
    return renderToStaticMarkup(
      renderCard({ card: makeCard({ type: 'note', filePath: '', meta }), selected: false }),
    )
  }

  function shellTag(html: string): string {
    return html.match(/<div data-card-id="card-1"[^>]*>/)?.[0] ?? ''
  }

  it('默认（无 noteColor）：便签纸底色类名，无内联颜色样式', () => {
    const html = noteHtml({})
    const shell = shellTag(html)
    expect(shell).toContain('bg-note')
    expect(shell).not.toContain('border-transparent')
    expect(shell).not.toContain('style=')
  })

  it('自定义色：去掉便签纸类名，底色 / 边框按「色值 + 透明度后缀」内联输出', () => {
    const html = noteHtml({ noteColor: '#E7C873' })
    const shell = shellTag(html)
    expect(shell).not.toContain('bg-note')
    expect(shell).toContain('border-transparent') // 占位类，内联色覆盖它
    expect(shell).toContain('background-color:#E7C87333')
    expect(shell).toContain('border-color:#E7C87399')
  })

  it('脏数据（缺 # / 非 6 位 / 非字符串）一律回到默认便签纸', () => {
    for (const dirty of ['E7C873', '#E7C87', '#E7C8733', '#GGGGGG', 42, '']) {
      const html = noteHtml({ noteColor: dirty as unknown as string })
      const shell = shellTag(html)
      expect(shell).toContain('bg-note')
      expect(shell).not.toContain('style=')
    }
  })

  it('色板之外的合法 #RRGGBB 也照常渲染（色板将来调整时旧数据不受影响）', () => {
    const html = noteHtml({ noteColor: '#123456' })
    expect(shellTag(html)).toContain('background-color:#12345633')
  })
})

// ---------------------------------------------------------------------------
// 标签条（T3.9 修复）：「编辑标签」写入的 meta.tags 必须显示在卡片上
// ---------------------------------------------------------------------------

describe('标签条渲染（meta.tags）', () => {
  it('image：有标签时输出标签条与标签文字', () => {
    const html = renderToStaticMarkup(
      renderCard({
        card: makeCard({ type: 'image', meta: { tags: ['参考', '待定'] } }),
        selected: false,
      }),
    )

    expect(html).toContain('data-tag-bar')
    expect(html).toContain('参考')
    expect(html).toContain('待定')
  })

  it('无标签时不输出标签条', () => {
    const html = renderToStaticMarkup(
      renderCard({ card: makeCard({ type: 'image' }), selected: false }),
    )

    expect(html).not.toContain('data-tag-bar')
  })

  it('note / file 类型同样显示标签条', () => {
    const noteHtml = renderToStaticMarkup(
      renderCard({
        card: makeCard({ type: 'note', filePath: '', meta: { tags: ['灵感'] } }),
        selected: false,
      }),
    )
    const fileHtml = renderToStaticMarkup(
      renderCard({
        card: makeCard({ type: 'file', meta: { tags: ['合同'] } }),
        selected: false,
      }),
    )

    expect(noteHtml).toContain('data-tag-bar')
    expect(noteHtml).toContain('灵感')
    expect(fileHtml).toContain('data-tag-bar')
    expect(fileHtml).toContain('合同')
  })

  it('meta.tags 是脏数据（非数组）时不显示标签条', () => {
    const html = renderToStaticMarkup(
      renderCard({
        card: makeCard({ type: 'image', meta: { tags: 'not-array' } as unknown as Card['meta'] }),
        selected: false,
      }),
    )

    expect(html).not.toContain('data-tag-bar')
  })
})

// ---------------------------------------------------------------------------
// 备注条 / 标签条视觉区分（2026-09-11 用户裁决：两者必须一眼可分）
// ---------------------------------------------------------------------------

describe('备注条与标签条的视觉区分', () => {
  // 2026-09-13 用户裁决：图片卡的备注 / 标签改走左上悬浮层（data-image-overlay），
  // 不占卡片布局；文件 / 便签仍用底部通栏。两者共用 noteBar / tagBar 的图标与 chip。
  const imageHtml = renderToStaticMarkup(
    renderCard({
      card: makeCard({ type: 'image', note: '总图', meta: { tags: ['总图'] } }),
      selected: false,
    }),
  )
  const fileHtml = renderToStaticMarkup(
    renderCard({
      card: makeCard({ type: 'file', note: '总图', meta: { tags: ['总图'] } }),
      selected: false,
    }),
  )

  it('图片卡：备注 / 标签挂在卡片盒上方外侧（与图片零重叠）', () => {
    expect(imageHtml).toContain('data-image-overlay')
    expect(imageHtml).toContain('data-note-bar')
    expect(imageHtml).toContain('data-tag-bar')
    // 外挂层 absolute bottom-full：整体位于卡片盒上方（2026-09-13 用户裁决，
    // 第一版 left/top 压在图片内部被否）；左缘与卡片对齐
    expect(imageHtml).toContain('absolute bottom-full left-0')
    expect(imageHtml).not.toContain('left-1.5 top-1.5')
    // 半透明底 + 模糊：悬在画布上可读
    expect(imageHtml).toContain('bg-background/95')
    // 备注条与标签条**横排同行**（2026-09-13 第三轮用户反馈「排版不够美观」）：
    // 容器 flex-row + flex-wrap（超宽整条换行兜底）、行内垂直居中
    expect(imageHtml).toContain('flex-row flex-wrap items-center')
    expect(imageHtml).not.toContain('flex-col items-stretch')
    // 图片元素盒始终占满卡片（flex-1），未被信息条挤矮
    expect(imageHtml).toContain('flex-1')
  })

  it('文件卡：备注 / 标签保持底部通栏（灰底备注条 + 苔绿 chip 标签条）', () => {
    expect(fileHtml).toContain('data-note-bar')
    expect(fileHtml).toContain('data-tag-bar')
    expect(fileHtml).not.toContain('data-image-overlay')
    // 配色区分（2026-09-11 用户裁决）：备注条灰底，标签 chip 苔绿底
    expect(fileHtml).toContain('bg-muted/40')
    expect(fileHtml).toContain('bg-primary/10')
  })

  it('形状区分：标签 chip 是胶囊（rounded-full）', () => {
    expect(imageHtml).toContain('rounded-full')
  })

  it('图标区分：备注条与标签条各带一个 12×12 内联图标（文档 / 吊牌）', () => {
    const icons = imageHtml.match(/viewBox="0 0 12 12"/g) ?? []
    expect(icons.length).toBe(2)
    // 文档图标是 rect 骨架，吊牌图标是 path 骨架
    expect(imageHtml).toContain('<rect')
    expect(imageHtml).toMatch(/<path d="M1\.5 5\.2/)
  })
})

// ---------------------------------------------------------------------------
// 悬浮标记（2026-09-14 用户裁决）：色号默认不显示，鼠标悬停在色卡上才淡入
// 它是 core 的**通用**能力（meta.hoverLabel），核心不认识「色卡插件」
// ---------------------------------------------------------------------------

describe('图片卡悬浮标记（meta.hoverLabel）', () => {
  function imageWith(meta: Card['meta']): string {
    return renderToStaticMarkup(
      renderCard({ card: makeCard({ type: 'image', meta }), selected: false }),
    )
  }

  it('带 hoverLabel 时渲染标记，且文字就是色号', () => {
    const html = imageWith({ hoverLabel: '#5A7D6A' })
    expect(html).toContain('data-hover-label')
    expect(html).toContain('#5A7D6A')
  })

  it('默认不可见：标记自己 opacity-0，靠 group-hover 才淡入（纯 CSS，17.3）', () => {
    const html = imageWith({ hoverLabel: '#5A7D6A' })
    const chipTag = html.match(/<span data-hover-label[^>]*>/)?.[0] ?? ''
    expect(chipTag).toContain('opacity-0')
    expect(chipTag).toContain('group-hover:opacity-100')
    // 不可交互，别抢画布的指针事件
    expect(chipTag).toContain('pointer-events-none')
  })

  it('与备注 / 标签同时出现时：标记是独立元素，不在上方外挂层里堆叠', () => {
    const html = imageWith({ hoverLabel: '#5A7D6A', tags: ['参考'] })
    // 上方外挂层只剩常驻的备注 / 标签（不带 opacity-0），里面没有标记
    const overlayTag = html.match(/<div data-image-overlay[^>]*>[\s\S]*?<\/div>/)?.[0] ?? ''
    expect(overlayTag).not.toContain('data-hover-label')
    expect(overlayTag).toContain('data-tag-bar')
    // 标记自己淡入
    const chipTag = html.match(/<span data-hover-label[^>]*>/)?.[0] ?? ''
    expect(chipTag).toContain('group-hover:opacity-100')
  })

  it('标记挂在卡片盒下方外侧左对齐（与右下角的分辨率徽章左右对称）', () => {
    const html = imageWith({ hoverLabel: '#5A7D6A' })
    const chipTag = html.match(/<span data-hover-label[^>]*>/)?.[0] ?? ''
    expect(chipTag).toContain('top-full')
    expect(chipTag).toContain('left-0')
  })

  it('没有 hoverLabel 时不渲染标记（普通图片卡完全不受影响）', () => {
    const html = imageWith({ tags: ['参考'] })
    expect(html).not.toContain('data-hover-label')
  })

  it('hoverLabel 是脏数据时不渲染（非字符串 / 空白）', () => {
    expect(imageWith({ hoverLabel: 42 })).not.toContain('data-hover-label')
    expect(imageWith({ hoverLabel: '   ' })).not.toContain('data-hover-label')
  })

  it('悬浮标记是通用能力：file 卡不渲染（外挂层是图片卡专属）', () => {
    const html = renderToStaticMarkup(
      renderCard({ card: makeCard({ type: 'file', meta: { hoverLabel: '#5A7D6A' } }), selected: false }),
    )
    expect(html).not.toContain('data-hover-label')
  })
})

// ---------------------------------------------------------------------------
// 实际分辨率徽章（2026-09-14 用户要求）：悬停在图片卡下方外侧显示「宽 × 高」。
// 文本由 imageResolution 在 load / error 时直写 DOM（不走 state），所以
// renderToStaticMarkup 断言的是「徽章元素在场且正确隐藏」这一渲染层契约。
// ---------------------------------------------------------------------------

describe('图片卡实际分辨率徽章', () => {
  it('图片卡渲染徽章元素：初始 hidden，文本位置留给 load 事件直写', () => {
    const html = renderToStaticMarkup(
      renderCard({ card: makeCard({ type: 'image' }), selected: false }),
    )

    expect(html).toContain('data-image-resolution')
    // 文本没写进之前必须隐藏 —— 否则悬停会出现一个空胶囊
    const badgeTag = html.match(/<span data-image-resolution[^>]*>/)?.[0] ?? ''
    expect(badgeTag).toContain('hidden')
    // 悬停淡入走纯 CSS（17.3：悬停态不进 state），且不可交互、半透明底
    expect(badgeTag).toContain('group-hover:opacity-100')
    expect(badgeTag).toContain('bg-background/80')
    expect(badgeTag).toContain('pointer-events-none')
  })

  it('徽章挂在卡片盒下方外侧右对齐（top-full + right-0，不遮挡图片）', () => {
    const html = renderToStaticMarkup(
      renderCard({ card: makeCard({ type: 'image' }), selected: false }),
    )
    expect(html).toContain('top-full')
    expect(html).toContain('right-0')
  })

  it('img 携带 load / error 语义的兜底底色之外不再多渲染文本（SSR 不输出事件）', () => {
    const html = renderToStaticMarkup(
      renderCard({ card: makeCard({ type: 'image' }), selected: false }),
    )
    // 徽章在图片加载前没有文本内容（等 load 直写），不会出现空标签文字
    expect(html).not.toContain('尺寸不可读')
  })

  it('file / note 卡不渲染分辨率徽章（只有图片有分辨率）', () => {
    const fileHtml = renderToStaticMarkup(
      renderCard({ card: makeCard({ type: 'file' }), selected: false }),
    )
    const noteHtml = renderToStaticMarkup(
      renderCard({ card: makeCard({ type: 'note', filePath: '' }), selected: false }),
    )
    expect(fileHtml).not.toContain('data-image-resolution')
    expect(noteHtml).not.toContain('data-image-resolution')
  })
})
