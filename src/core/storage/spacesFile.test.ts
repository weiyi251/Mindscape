// ============================================================================
// 模块说明（中文）
// spaces.json 读写层的纯逻辑单元测试（不触碰 Tauri，只测解释 / 排序 / 序列化）。
//
// 实现任务：T1.1（阶段一）。
// ============================================================================

import { describe, it, expect } from 'vitest'

import {
  interpretSpacesText,
  serializeSpacesFile,
  sortSpacesByLastOpened,
  sortSpacesForList,
} from '@/core/storage/spacesFile'
import { parseSpacesFile } from '@/core/types'
import type { Space } from '@/core/types'

function makeSpace(over: Partial<Space> = {}): Space {
  return {
    id: 'sp_001',
    name: '项目A',
    type: '项目',
    folderPath: 'D:\\Mindscape\\01_项目A',
    createdAt: '2026-09-10T11:00:00',
    lastOpenedAt: '2026-09-10T11:30:00',
    favorite: false,
    meta: {},
    ...over,
  }
}

describe('interpretSpacesText', () => {
  it('空文本视为空列表（首次运行：文件存在但为空也不该崩）', () => {
    const result = interpretSpacesText('')
    expect(result.corrupted).toBe(false)
    expect(result.file.spaces).toEqual([])

    expect(interpretSpacesText('   \n  ').file.spaces).toEqual([])
  })

  it('解析 4.1 的示例结构', () => {
    const text = JSON.stringify({
      version: 1,
      spaces: [
        {
          id: 'sp_001',
          name: '项目A',
          type: '项目',
          folderPath: 'D:\\Mindscape\\01_项目A',
          createdAt: '2026-09-10T11:00:00',
          lastOpenedAt: '2026-09-10T11:30:00',
          meta: { coverNote: '封面图存于 .mindscape/cover.jpg' },
        },
      ],
    })

    const result = interpretSpacesText(text)
    expect(result.corrupted).toBe(false)
    expect(result.file.version).toBe(1)
    expect(result.file.spaces).toHaveLength(1)
    expect(result.file.spaces[0].name).toBe('项目A')
    expect(result.file.spaces[0].meta).toEqual({ coverNote: '封面图存于 .mindscape/cover.jpg' })
  })

  it('非法 JSON → 标记损坏、返回空结构、带中文原因（不抛错）', () => {
    const result = interpretSpacesText('{ 这不是 JSON')
    expect(result.corrupted).toBe(true)
    expect(result.file.spaces).toEqual([])
    expect(result.error).toContain('JSON')
  })

  it('结构非法（spaces 不是数组）→ 标记损坏', () => {
    const result = interpretSpacesText(JSON.stringify({ version: 1, spaces: 'nope' }))
    expect(result.corrupted).toBe(true)
    expect(result.file.spaces).toEqual([])
  })

  it('缺省字段由 zod 补默认值（老文件不迁移也能读）', () => {
    const result = interpretSpacesText(JSON.stringify({ spaces: [{ id: 'sp_009' }] }))
    expect(result.corrupted).toBe(true) // 缺 name / folderPath 等必填字段，仍属损坏

    const ok = interpretSpacesText(
      JSON.stringify({
        spaces: [
          {
            id: 'sp_009',
            name: '无类型空间',
            folderPath: 'D:\\x',
            createdAt: '2026-09-10T11:00:00',
            lastOpenedAt: '2026-09-10T11:00:00',
          },
        ],
      }),
    )
    expect(ok.corrupted).toBe(false)
    expect(ok.file.spaces[0].type).toBe('项目') // 默认值
    expect(ok.file.spaces[0].meta).toEqual({})
  })
})

describe('sortSpacesByLastOpened', () => {
  it('最近打开的排在最前', () => {
    const spaces = [
      makeSpace({ id: 'sp_001', lastOpenedAt: '2026-09-01T10:00:00' }),
      makeSpace({ id: 'sp_002', lastOpenedAt: '2026-09-10T10:00:00' }),
      makeSpace({ id: 'sp_003', lastOpenedAt: '2026-09-05T10:00:00' }),
    ]

    expect(sortSpacesByLastOpened(spaces).map((item) => item.id)).toEqual([
      'sp_002',
      'sp_003',
      'sp_001',
    ])
  })

  it('不修改原数组（纯函数）', () => {
    const spaces = [
      makeSpace({ id: 'sp_001', lastOpenedAt: '2026-09-01T10:00:00' }),
      makeSpace({ id: 'sp_002', lastOpenedAt: '2026-09-10T10:00:00' }),
    ]
    const snapshot = spaces.map((item) => item.id)

    sortSpacesByLastOpened(spaces)

    expect(spaces.map((item) => item.id)).toEqual(snapshot)
  })
})

describe('sortSpacesForList（P1-5：收藏 → 最近打开）', () => {
  it('收藏的空间排在未收藏前面，组内按最近打开倒序', () => {
    const spaces = [
      makeSpace({ id: 'old_fav', favorite: true, lastOpenedAt: '2026-09-01T10:00:00' }),
      makeSpace({ id: 'new_plain', favorite: false, lastOpenedAt: '2026-09-10T10:00:00' }),
      makeSpace({ id: 'new_fav', favorite: true, lastOpenedAt: '2026-09-09T10:00:00' }),
    ]

    expect(sortSpacesForList(spaces).map((item) => item.id)).toEqual([
      'new_fav',
      'old_fav',
      'new_plain',
    ])
  })

  it('全部未收藏时等价于按最近打开倒序', () => {
    const spaces = [
      makeSpace({ id: 'a', lastOpenedAt: '2026-09-01T10:00:00' }),
      makeSpace({ id: 'b', lastOpenedAt: '2026-09-10T10:00:00' }),
    ]
    expect(sortSpacesForList(spaces).map((item) => item.id)).toEqual(['b', 'a'])
  })

  it('不修改原数组（纯函数）', () => {
    const spaces = [
      makeSpace({ id: 'a', favorite: true, lastOpenedAt: '2026-09-01T10:00:00' }),
      makeSpace({ id: 'b', lastOpenedAt: '2026-09-10T10:00:00' }),
    ]
    const snapshot = spaces.map((item) => item.id)

    sortSpacesForList(spaces)

    expect(spaces.map((item) => item.id)).toEqual(snapshot)
  })
})

describe('favorite 字段向后兼容（P1-5）', () => {
  it('旧数据没有 favorite 字段 → 解析后为 false', () => {
    // v0.3.0 时代写出的 spaces.json 里没有 favorite
    const legacyText = JSON.stringify({
      version: 1,
      spaces: [
        {
          id: 'sp_legacy',
          name: '旧空间',
          type: '项目',
          folderPath: 'D:\\Mindscape\\旧空间',
          createdAt: '2026-09-01T10:00:00',
          lastOpenedAt: '2026-09-02T10:00:00',
          meta: {},
        },
      ],
    })

    const interpreted = interpretSpacesText(legacyText)
    expect(interpreted.corrupted).toBe(false)
    expect(interpreted.file.spaces[0].favorite).toBe(false)
  })

  it('旧数据排序时按未收藏处理，不会因为缺字段而崩', () => {
    const legacyText = JSON.stringify({
      version: 1,
      spaces: [
        {
          id: 'sp_legacy',
          name: '旧空间',
          type: '项目',
          folderPath: 'D:\\Mindscape\\旧空间',
          createdAt: '2026-09-01T10:00:00',
          lastOpenedAt: '2026-09-02T10:00:00',
          meta: {},
        },
        makeSpace({ id: 'sp_fav', favorite: true, lastOpenedAt: '2026-09-01T10:00:00' }),
      ],
    })

    const interpreted = interpretSpacesText(legacyText)
    expect(sortSpacesForList(interpreted.file.spaces).map((item) => item.id)).toEqual([
      'sp_fav',
      'sp_legacy',
    ])
  })
})

describe('serializeSpacesFile', () => {
  it('两空格缩进 + 末尾换行', () => {
    const text = serializeSpacesFile({ version: 1, spaces: [] })
    expect(text.endsWith('\n')).toBe(true)
    expect(text).toContain('\n  "spaces"')
  })

  it('序列化结果可被 parseSpacesFile 读回（往返一致）', () => {
    const file = { version: 1, spaces: [makeSpace()] }
    const parsed = parseSpacesFile(serializeSpacesFile(file))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.data).toEqual(file)
    }
  })
})
