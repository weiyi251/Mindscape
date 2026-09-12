// ============================================================================
// 模块说明（中文）
// 卡片搜索的纯匹配层（P1-3）。
//
// 匹配范围（对应计划的「文件名 / 标签 / 便签正文」）：
//   · name  —— 卡片文件名（`filePath` 的最后一段）。便签卡 `filePath` 为空串，
//               天然不参与文件名匹配，不会因为「空文件名包含空查询」而误命中
//   · note  —— 便签正文 / 卡片备注（`Card.note`）
//   · group —— 所属分区名。本项目**没有独立的 tags 字段**（`meta` 是自由扩展位，
//               不该被搜索逻辑私自占用），分区名承担「标签」的角色
//
// 匹配规则：**大小写不敏感的子串匹配**。空查询（含纯空白）返回空结果 ——
//   「空查询 = 全部命中」会让刚打开搜索框就满屏高亮，这里选择返回空，
//   UI 也就能用「0 命中」和「还没输入」区分开来。
//
// 本模块是纯函数、零 UI 依赖（只用 `basenameOf`），视图跳转与浮层渲染都不在这里。
//
// 实现任务：P1-3。
// ============================================================================

import { basenameOf } from '@/core/utils/paths'

/** 参与搜索的卡片字段子集（`Card` 结构兼容，便于直接传 `Card[]`） */
export interface CardSearchDoc {
  id: string
  /** 相对空间文件夹的路径；便签卡为空串 */
  filePath: string
  /** 便签正文 / 备注 */
  note: string
  /** 所属分区名，没有分区时为空 */
  group?: string
}

/** 命中的字段名，用于告诉用户「为什么这张卡被搜到」 */
export type SearchFieldKey = 'name' | 'note' | 'group'

export interface CardSearchHit {
  id: string
  /** 命中的字段，按 name → note → group 顺序排列，至少一项 */
  fields: SearchFieldKey[]
  /** 便签正文命中时的上下文摘录（已压平换行、超长加省略号）；否则空串 */
  excerpt: string
}

/** 查询词规范化：去首尾空白 + 转小写。匹配与摘录必须共用它，否则索引会错位 */
export function normalizeQuery(raw: string): string {
  return raw.trim().toLowerCase()
}

/**
 * 取命中处附近的摘录。`radius` 是命中词前后各保留的字符数。
 * 换行先压平成单空格，保证截取到的是「一行话」而不是半截断行。
 */
export function excerptOf(text: string, rawQuery: string, radius = 24): string {
  const query = normalizeQuery(rawQuery)
  if (query === '' || text === '') return ''

  const flat = text.replace(/\s+/g, ' ').trim()
  const index = flat.toLowerCase().indexOf(query)
  if (index < 0) return ''

  const start = Math.max(0, index - radius)
  const end = Math.min(flat.length, index + query.length + radius)
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`
}

/**
 * 按查询词过滤卡片。空查询返回空数组（见模块说明）。
 * `excerpt` 优先取便签正文 —— 文件名本身在 UI 上已经显示，正文摘录才是额外信息。
 */
export function matchCards(
  docs: readonly CardSearchDoc[],
  rawQuery: string,
): CardSearchHit[] {
  const query = normalizeQuery(rawQuery)
  if (query === '') return []

  const hits: CardSearchHit[] = []
  for (const doc of docs) {
    const fields: SearchFieldKey[] = []

    const name = basenameOf(doc.filePath)
    if (name !== '' && name.toLowerCase().includes(query)) fields.push('name')

    if (doc.note !== '' && doc.note.toLowerCase().includes(query)) fields.push('note')

    const group = doc.group ?? ''
    if (group !== '' && group.toLowerCase().includes(query)) fields.push('group')

    if (fields.length === 0) continue
    hits.push({
      id: doc.id,
      fields,
      excerpt: fields.includes('note') ? excerptOf(doc.note, query) : '',
    })
  }
  return hits
}

/**
 * 在命中列表里按 `delta`（+1 下一个 / −1 上一个）移动，越界回绕。
 * `current < 0` 表示「还没选中任何一项」：向下取第一条、向上取最后一条。
 * 空列表返回 -1（哨兵），调用方据此禁用按钮。
 */
export function stepIndex(current: number, total: number, delta: number): number {
  if (total <= 0) return -1
  if (current < 0 || current >= total) return delta >= 0 ? 0 : total - 1
  return (((current + delta) % total) + total) % total
}

// ---------------------------------------------------------------------------
// 浮层展示整形（仍是纯函数，方便单测；渲染在 components/ui/card-search.tsx）
// ---------------------------------------------------------------------------

/** 命中字段的中文标签（约定：中文文案进常量表，先例 `CORE_CARD_TYPE_LABELS`） */
export const SEARCH_FIELD_LABELS: Record<SearchFieldKey, string> = {
  name: '文件名',
  note: '便签',
  group: '分区',
}

/** 搜索结果在浮层里的一条展示数据 */
export interface CardSearchItem {
  id: string
  /** 标题：文件名；便签卡（无文件）取正文第一行，正文也为空则叫「便签」 */
  title: string
  /** 命中字段的中文标签（顺序同 `CardSearchHit.fields`） */
  fieldLabels: string[]
  /** 便签正文命中时的摘录；否则空串 */
  excerpt: string
}

/**
 * 把命中结果整形为浮层可渲染的条目。
 * `docs` 与 `hits` 可能不同步（卡片刚被删而 hits 还是旧的），此时跳过该条而不是崩掉。
 */
export function describeHits(
  docs: readonly CardSearchDoc[],
  hits: readonly CardSearchHit[],
): CardSearchItem[] {
  const byId = new Map(docs.map((doc) => [doc.id, doc]))
  const items: CardSearchItem[] = []
  for (const hit of hits) {
    const doc = byId.get(hit.id)
    if (!doc) continue

    const name = basenameOf(doc.filePath)
    const firstLine = (doc.note.split('\n', 1)[0] ?? '').trim()
    const title = name !== '' ? name : firstLine !== '' ? firstLine : '便签'
    items.push({
      id: hit.id,
      title,
      fieldLabels: hit.fields.map((field) => SEARCH_FIELD_LABELS[field]),
      excerpt: hit.excerpt,
    })
  }
  return items
}
