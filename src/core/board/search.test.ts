// ============================================================================
// 模块说明（中文）
// `core/board/search.ts`（卡片搜索纯匹配层）的单元测试。实现任务：P1-3。
//
// 覆盖计划验收要求：大小写不敏感 / 命中计数 / 空查询返回空 / 多字段命中，
// 外加便签卡（filePath 为空）、分区名匹配、摘录边界与 stepIndex 回绕。
// ============================================================================

import { describe, expect, it } from 'vitest'

import type { CardSearchDoc } from './search'
import {
  describeHits,
  excerptOf,
  matchCards,
  normalizeQuery,
  SEARCH_FIELD_LABELS,
  stepIndex,
} from './search'

const doc = (patch: Partial<CardSearchDoc> & { id: string }): CardSearchDoc => ({
  filePath: '',
  note: '',
  ...patch,
})

describe('normalizeQuery：查询词规范化', () => {
  it('去掉首尾空白并转小写', () => {
    expect(normalizeQuery('  Hello  ')).toBe('hello')
  })

  it('纯空白归一为空串', () => {
    expect(normalizeQuery('   \t\n ')).toBe('')
  })
})

describe('matchCards：基础匹配', () => {
  const cards: CardSearchDoc[] = [
    doc({ id: 'c1', filePath: '参考/建筑 Sketch.png' }),
    doc({ id: 'c2', filePath: '封面图.jpg', note: '这里放主视觉' }),
    doc({ id: 'c3', filePath: '笔记.txt', group: '建筑研究' }),
    doc({ id: 'c4', filePath: '无关.md' }),
  ]

  it('匹配文件名（只看最后一段，不看目录名）', () => {
    expect(matchCards(cards, 'sketch').map((hit) => hit.id)).toEqual(['c1'])
  })

  it('目录名不参与匹配', () => {
    // 「参考」只出现在 c1 的目录段里
    expect(matchCards(cards, '参考')).toEqual([])
  })

  it('大小写不敏感', () => {
    expect(matchCards(cards, 'SKETCH').map((hit) => hit.id)).toEqual(['c1'])
    expect(matchCards(cards, 'sketch')).toEqual(matchCards(cards, 'SkEtCh'))
  })

  it('匹配便签正文', () => {
    const hits = matchCards(cards, '主视觉')
    expect(hits.map((hit) => hit.id)).toEqual(['c2'])
    expect(hits[0].fields).toEqual(['note'])
  })

  it('匹配分区名（充当标签）', () => {
    const hits = matchCards(cards, '建筑研究')
    expect(hits.map((hit) => hit.id)).toEqual(['c3'])
    expect(hits[0].fields).toEqual(['group'])
  })

  it('命中计数：单次查询返回全部命中项', () => {
    // 「图」同时出现在 c2 的文件名与 c3 的分区名里？——c3 是「建筑研究」，故只有 c2
    expect(matchCards(cards, '图').map((hit) => hit.id)).toEqual(['c2'])
    // 「究」只在 c3 的分区名里
    expect(matchCards(cards, '究').map((hit) => hit.id)).toEqual(['c3'])
  })

  it('多字段命中：同一张卡同时命中两个字段，fields 按 name→note→group 排列', () => {
    const both = [doc({ id: 'x', filePath: '草图.png', note: '草图待改' })]
    expect(matchCards(both, '草图')).toEqual([
      { id: 'x', fields: ['name', 'note'], excerpt: '草图待改' },
    ])
  })

  it('三字段同时命中时顺序稳定', () => {
    const all = [doc({ id: 'y', filePath: '甲.png', note: '甲', group: '甲组' })]
    expect(matchCards(all, '甲')[0].fields).toEqual(['name', 'note', 'group'])
  })

  it('未命中返回空数组', () => {
    expect(matchCards(cards, '不存在的词')).toEqual([])
  })
})

describe('matchCards：空查询与便签卡边界', () => {
  const cards: CardSearchDoc[] = [
    doc({ id: 'n1', filePath: '', note: '今天要买牛奶' }),
    doc({ id: 'f1', filePath: '报表.xlsx' }),
  ]

  it('空查询返回空数组', () => {
    expect(matchCards(cards, '')).toEqual([])
  })

  it('纯空白查询返回空数组', () => {
    expect(matchCards(cards, '   \n\t ')).toEqual([])
  })

  it('便签卡（filePath 为空）不会被空文件名误命中', () => {
    // 便签卡文件名为空串，任何查询都不该因为「空串 includes」而命中 name
    const hits = matchCards(cards, '牛奶')
    expect(hits.map((hit) => hit.id)).toEqual(['n1'])
    expect(hits[0].fields).toEqual(['note'])
  })

  it('便签卡可以只按正文命中，且带出摘录', () => {
    expect(matchCards(cards, '牛奶')[0].excerpt).toBe('今天要买牛奶')
  })

  it('空文档列表返回空数组', () => {
    expect(matchCards([], '甲')).toEqual([])
  })

  it('group 为 undefined 时不影响其他字段匹配', () => {
    expect(matchCards([doc({ id: 'z', filePath: 'z.txt' })], 'z.txt')).toHaveLength(1)
  })
})

describe('excerptOf：摘录', () => {
  it('命中较短文本时原样返回', () => {
    expect(excerptOf('今天要买牛奶', '牛奶')).toBe('今天要买牛奶')
  })

  it('超长文本两端加省略号，保留 radius 半径', () => {
    const long = `${'前'.repeat(40)}关键${'后'.repeat(40)}`
    const result = excerptOf(long, '关键', 5)
    expect(result).toBe('…前前前前前关键后后后后后…')
  })

  it('命中在开头时左侧不加省略号', () => {
    const text = `${'关键'}${'后'.repeat(60)}`
    expect(excerptOf(text, '关键', 5).startsWith('关键')).toBe(true)
    expect(excerptOf(text, '关键', 5).endsWith('…')).toBe(true)
  })

  it('命中在结尾时右侧不加省略号', () => {
    const text = `${'前'.repeat(60)}关键`
    expect(excerptOf(text, '关键', 5).endsWith('关键')).toBe(true)
    expect(excerptOf(text, '关键', 5).startsWith('…')).toBe(true)
  })

  it('换行被压平成单空格（摘录始终是一行）', () => {
    expect(excerptOf('第一行\n第二行', '第二行')).toBe('第一行 第二行')
  })

  it('无命中或空查询返回空串', () => {
    expect(excerptOf('今天要买牛奶', '面包')).toBe('')
    expect(excerptOf('今天要买牛奶', '  ')).toBe('')
    expect(excerptOf('', '牛奶')).toBe('')
  })

  it('摘录大小写不敏感', () => {
    expect(excerptOf('Build Sketch', 'sketch')).toBe('Build Sketch')
  })
})

describe('stepIndex：命中项之间移动', () => {
  it('空列表返回 -1 哨兵', () => {
    expect(stepIndex(-1, 0, 1)).toBe(-1)
  })

  it('未选中时向下取第一条、向上取最后一条', () => {
    expect(stepIndex(-1, 5, 1)).toBe(0)
    expect(stepIndex(-1, 5, -1)).toBe(4)
  })

  it('正常前进与后退', () => {
    expect(stepIndex(0, 5, 1)).toBe(1)
    expect(stepIndex(3, 5, -1)).toBe(2)
  })

  it('越界回绕', () => {
    expect(stepIndex(4, 5, 1)).toBe(0)
    expect(stepIndex(0, 5, -1)).toBe(4)
  })

  it('单条命中时来回都是它自己', () => {
    expect(stepIndex(0, 1, 1)).toBe(0)
    expect(stepIndex(0, 1, -1)).toBe(0)
  })

  it('索引越界（如命中数变少后）按未选中处理', () => {
    expect(stepIndex(9, 5, 1)).toBe(0)
    expect(stepIndex(9, 5, -1)).toBe(4)
  })
})

describe('SEARCH_FIELD_LABELS：命中字段中文标签', () => {
  it('三种字段都有标签', () => {
    expect(SEARCH_FIELD_LABELS).toEqual({ name: '文件名', note: '便签', group: '分区' })
  })
})

describe('describeHits：浮层展示整形', () => {
  it('文件卡标题取文件名，标签随命中字段', () => {
    const docs = [doc({ id: 'c1', filePath: '参考/建筑 Sketch.png', group: '素材' })]
    const hits = matchCards(docs, 'sketch')
    expect(describeHits(docs, hits)).toEqual([
      { id: 'c1', title: '建筑 Sketch.png', fieldLabels: ['文件名'], excerpt: '' },
    ])
  })

  it('便签卡（无文件名）标题取正文第一行', () => {
    const docs = [doc({ id: 'n1', filePath: '', note: '第一行标题\n第二行内容' })]
    const hits = matchCards(docs, '第一行')
    expect(describeHits(docs, hits)[0].title).toBe('第一行标题')
  })

  it('便签卡正文为空时标题兜底为「便签」', () => {
    const docs = [doc({ id: 'n2', filePath: '', note: '' })]
    // 正文为空、文件名为空的卡不可能被搜到，这里直接构造命中验证兜底
    const items = describeHits(docs, [{ id: 'n2', fields: ['group'], excerpt: '' }])
    expect(items[0].title).toBe('便签')
  })

  it('多字段命中时标签按 fields 顺序排列', () => {
    const docs = [doc({ id: 'x', filePath: '草图.png', note: '草图待改' })]
    const hits = matchCards(docs, '草图')
    expect(describeHits(docs, hits)[0].fieldLabels).toEqual(['文件名', '便签'])
  })

  it('docs 与 hits 不同步（卡片刚被删）时跳过，不崩', () => {
    const items = describeHits([], [{ id: 'ghost', fields: ['name'], excerpt: '' }])
    expect(items).toEqual([])
  })

  it('摘录原样透传', () => {
    const docs = [doc({ id: 'n1', filePath: '', note: '今天要买牛奶' })]
    const hits = matchCards(docs, '牛奶')
    expect(describeHits(docs, hits)[0].excerpt).toBe('今天要买牛奶')
  })
})
