// ============================================================================
// 模块说明（中文）
// core/types.ts 的单元测试。对应 T0.4 验收标准：
//   ① 类型定义覆盖开发计划书 4.1 / 4.2 全部字段
//   ② 含 zod 校验（读文件时校验）
// 其中「覆盖全部字段」直接用文档 4.2 的示例 JSON 作为输入来验证 —— 若漏定义字段，
// 该用例会暴露出来。
// ============================================================================

import { describe, expect, it } from 'vitest'
import {
  DATA_VERSION,
  createEmptyLayout,
  createEmptySpacesFile,
  parseLayout,
  parseSpacesFile,
} from './types'

/** Verbatim example from the planning doc, section 4.2 */
const LAYOUT_EXAMPLE = `{
  "version": 1,
  "canvas": { "zoom": 1.0, "offsetX": 0, "offsetY": 0 },
  "cards": [
    {
      "id": "c_001",
      "type": "image",
      "filePath": "参考资料/ref-01.jpg",
      "originalPath": "参考资料/ref-01.jpg",
      "x": 120, "y": 80,
      "w": 320, "h": 240,
      "rotation": 0,
      "zIndex": 3,
      "note": "整体风格参考",
      "group": "参考资料",
      "meta": {}
    }
  ],
  "partitions": [
    {
      "id": "p_001",
      "name": "参考资料",
      "folderPath": "参考资料",
      "x": 80, "y": 40, "w": 900, "h": 600,
      "color": "auto",
      "collapsed": false,
      "meta": {}
    }
  ],
  "connections": [
    { "id": "cn_001", "from": "c_001", "to": "c_005", "label": "由此衍生", "color": "gray", "meta": {} }
  ],
  "removed": [
    { "id": "c_009", "originalPath": "参考资料/xxx.jpg", "movedTo": "_已移除/参考资料/xxx.jpg" }
  ],
  "extensions": {}
}`

/** Verbatim example from the planning doc, section 4.1 */
const SPACES_EXAMPLE = `{
  "version": 1,
  "spaces": [
    {
      "id": "sp_001",
      "name": "项目A",
      "type": "项目",
      "folderPath": "D:\\\\Mindscape\\\\01_项目A",
      "createdAt": "2026-09-10T11:00:00",
      "lastOpenedAt": "2026-09-10T11:30:00",
      "meta": {}
    }
  ]
}`

describe('parseLayout', () => {
  it('doc 4.2 示例 JSON 全部字段均可通过校验且无丢失', () => {
    const res = parseLayout(LAYOUT_EXAMPLE)
    expect(res.ok).toBe(true)
    if (!res.ok) return

    const { data } = res
    expect(data.version).toBe(1)
    expect(data.canvas).toEqual({ zoom: 1, offsetX: 0, offsetY: 0 })

    expect(data.cards).toHaveLength(1)
    const card = data.cards[0]
    // every field listed in 4.2
    expect(card).toMatchObject({
      id: 'c_001',
      type: 'image',
      filePath: '参考资料/ref-01.jpg',
      originalPath: '参考资料/ref-01.jpg',
      x: 120,
      y: 80,
      w: 320,
      h: 240,
      rotation: 0,
      zIndex: 3,
      note: '整体风格参考',
      group: '参考资料',
    })
    expect(card.meta).toEqual({})

    expect(data.partitions[0]).toMatchObject({
      id: 'p_001',
      name: '参考资料',
      folderPath: '参考资料',
      x: 80,
      y: 40,
      w: 900,
      h: 600,
      color: 'auto',
      collapsed: false,
    })

    expect(data.connections[0]).toMatchObject({
      id: 'cn_001',
      from: 'c_001',
      to: 'c_005',
      label: '由此衍生',
      color: 'gray',
    })

    expect(data.removed[0]).toEqual({
      id: 'c_009',
      originalPath: '参考资料/xxx.jpg',
      movedTo: '_已移除/参考资料/xxx.jpg',
    })

    expect(data.extensions).toEqual({})
  })

  it('meta / extensions 可承载任意插件数据（第十三章 准备 1）', () => {
    const res = parseLayout(
      JSON.stringify({
        version: DATA_VERSION,
        cards: [{ id: 'c_1', type: 'image', filePath: 'a.jpg', originalPath: 'a.jpg', x: 0, y: 0, w: 1, h: 1, meta: { pluginX: { k: 1 } } }],
        extensions: { colorPlugin: [1, 2, 3] },
      })
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.cards[0].meta).toEqual({ pluginX: { k: 1 } })
    expect(res.data.extensions).toEqual({ colorPlugin: [1, 2, 3] })
  })

  it('缺省字段回落到默认值，未列出的数组为空', () => {
    const res = parseLayout('{}')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data).toEqual({
      version: DATA_VERSION,
      canvas: { zoom: 1, offsetX: 0, offsetY: 0 },
      cards: [],
      partitions: [],
      connections: [],
      removed: [],
      extensions: {},
    })
  })

  it('损坏的 JSON 不抛异常，返回可展示的中文错误', () => {
    const res = parseLayout('{"version": 1, "cards": [')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('JSON 解析失败')
  })

  it('缺必填字段时校验失败并指出出错路径', () => {
    const res = parseLayout('{"version":1,"cards":[{"id":"c_1"}]}')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('cards.0')
  })
})

describe('parseSpacesFile', () => {
  it('doc 4.1 示例 JSON 全部字段均可通过校验', () => {
    const res = parseSpacesFile(SPACES_EXAMPLE)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.version).toBe(1)
    expect(res.data.spaces[0]).toMatchObject({
      id: 'sp_001',
      name: '项目A',
      type: '项目',
      folderPath: 'D:\\Mindscape\\01_项目A',
      createdAt: '2026-09-10T11:00:00',
      lastOpenedAt: '2026-09-10T11:30:00',
    })
    expect(res.data.spaces[0].meta).toEqual({})
  })

  it('空文件回落到空空间列表', () => {
    const res = parseSpacesFile('{}')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data).toEqual({ version: DATA_VERSION, spaces: [] })
  })
})

describe('factories', () => {
  it('createEmptyLayout / createEmptySpacesFile 返回合法结构', () => {
    expect(createEmptyLayout().version).toBe(DATA_VERSION)
    expect(createEmptyLayout().cards).toEqual([])
    expect(createEmptySpacesFile().spaces).toEqual([])
  })
})
