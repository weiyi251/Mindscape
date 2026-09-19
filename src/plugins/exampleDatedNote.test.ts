// ============================================================================
// 模块说明（中文）
// 官方示例外部插件（docs/examples/example.dated-note/）的**契约测试**。
//
// 背景（2026-09-20，A–D 计划 B2）：外部插件的动态加载链路（扫描 → 清单校验 →
// 动态 import → activate 注册）此前只有注入假件的单元测试，从未对着一个
// 真实插件文件夹跑过。本测试直接读仓库里的示例插件文件：
//   ① manifest.json 过**生产同款** parseManifest（zod 清单契约）；
//   ② index.js 以原生动态 import 真实加载（与 pluginLoader 的运行时路径一致），
//     用 isPluginModule 判定导出形状；
//   ③ 用假 api 跑 activate，断言画布菜单项注册成功，且菜单动作真的调用了
//     api.board.createCard（type=note + 今天的日期文本）。
// 示例文件被改动 / 删除时，本测试会红 —— 保证「官方示例永远可用」。
//
// 为什么放 src/plugins/：示例在 docs/ 下，core 不得越层 import 上层目录
// （守卫规则 4），而「插件样例」的归属本来就是 plugins 层。
// ============================================================================

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

import { parseManifest } from '@/core/plugin/manifest'
import { isPluginModule } from '@/core/plugin/pluginLoader'
import type { CanvasMenuItem } from '@/core/registry/pluginCenter'

const SAMPLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'examples', 'example.dated-note')

/** 假 api：只记录画布菜单注册；动作里用到的 board.createCard 也换成记录桩 */
function makeFakeApi() {
  const canvasMenuItems: CanvasMenuItem[] = []
  const createdCards: Record<string, unknown>[] = []
  return {
    canvasMenuItems,
    createdCards,
    api: {
      pluginId: 'example.dated-note',
      registerCardType: () => {},
      registerMenuItem: () => {},
      registerCanvasMenuItem: (item: CanvasMenuItem) => canvasMenuItems.push(item),
      registerHook: () => {},
      board: {
        createCard: async (input: Record<string, unknown>) => {
          createdCards.push(input)
          return 'card_new'
        },
      },
    },
  }
}

describe('官方示例外部插件 example.dated-note', () => {
  it('manifest.json 过生产同款清单校验', () => {
    const text = readFileSync(join(SAMPLE_DIR, 'manifest.json'), 'utf8')
    const result = parseManifest(text)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.id).toBe('example.dated-note')
    expect(result.data.main).toBe('index.js')
    expect(result.data.name).toBe('日期便签')
  })

  it('index.js 能被原生动态 import 加载，且导出 activate / deactivate', async () => {
    const module = await import(pathToFileURL(join(SAMPLE_DIR, 'index.js')).href)
    expect(isPluginModule(module)).toBe(true)
    expect(typeof module.formatDate).toBe('function')

    await expect(
      (async () => {
        await module.deactivate()
      })(),
    ).resolves.toBeUndefined()
  })

  it('activate 后注册出画布菜单项；点击动作创建带今天日期的便签', async () => {
    const module = await import(pathToFileURL(join(SAMPLE_DIR, 'index.js')).href)
    const { api, canvasMenuItems, createdCards } = makeFakeApi()

    await module.activate(api)

    expect(canvasMenuItems).toHaveLength(1)
    expect(canvasMenuItems[0].id).toBe('example.dated-note.create')
    expect(canvasMenuItems[0].label).toBe('新建日期便签')

    // 右键点 (120, 80) 触发菜单项
    canvasMenuItems[0].action({ spacePath: 'D:\\空间', canvasPoint: { x: 120, y: 80 } })
    expect(createdCards).toHaveLength(1)
    expect(createdCards[0].type).toBe('note')
    expect(createdCards[0].note).toBe(module.formatDate(new Date()))
    expect(createdCards[0]).toMatchObject({ x: 120, y: 80 })
  })

  it('右键点缺省（旧宿主）时不传坐标，由宿主放视口中心', async () => {
    const module = await import(pathToFileURL(join(SAMPLE_DIR, 'index.js')).href)
    const { api, canvasMenuItems, createdCards } = makeFakeApi()

    await module.activate(api)
    canvasMenuItems[0].action({ spacePath: 'D:\\空间' })

    expect(createdCards).toHaveLength(1)
    expect(createdCards[0].x).toBeUndefined()
    expect(createdCards[0].y).toBeUndefined()
  })

  it('formatDate：补零与星期映射', async () => {
    const module = await import(pathToFileURL(join(SAMPLE_DIR, 'index.js')).href)

    // 单月 / 单日补零；星期按 getDay()（0 = 日）映射
    const saturday = new Date(2026, 8, 19) // 2026-09-19 周六
    expect(module.formatDate(saturday)).toBe('2026-09-19 周六')
    const monday = new Date(2026, 0, 5) // 2026-01-05 周一（月份补零到 01）
    expect(module.formatDate(monday)).toBe('2026-01-05 周一')
    const sunday = new Date(2026, 11, 27) // 2026-12-27 周日
    expect(module.formatDate(sunday)).toBe('2026-12-27 周日')
  })
})
