// ============================================================================
// 模块说明（中文）
// 画布桥接：把「只有 React 组件里才拿得到的能力」交给插件运行时。
//
// 为什么需要它：插件要「新建一张色卡」，而建卡必须走画布的命令 + 撤销历史 +
// 落盘调度器 —— 这三样都活在 pages/Board.tsx 的闭包里。core 层不能 import
// 上层（架构守卫规则 4），所以反过来：**由 Board 在挂载时把能力注册进来**。
//
// 生命周期：Board 挂载 → setPluginBoardBridge(...)；卸载 → setPluginBoardBridge(null)。
// 未注册时（比如还没打开空间）插件的建卡请求返回 false，插件自己给用户提示。
//
// 2026-09-17 扩展（待办卡片插件）：新增 createCard（无文件建卡，插件自绘类型）
// 与 updateCardContent（meta 整体替换 + 高度自适应，一条命令入撤销栈）。
// 实现住在 pages/board/pluginBridgeImpl.ts，由 Board 注入依赖后组装。
// ============================================================================

import type { CreateCardInput, CreatePlainCardInput, UpdateCardContentInput } from './types'

/** 画布提供给插件的能力 */
export interface PluginBoardBridge {
  /** 当前空间文件夹绝对路径；未打开空间时为 null */
  currentSpacePath: () => string | null
  /**
   * 在画布上加一张「已存在于硬盘」的卡片；成功返回 true。
   * 异步的原因：需要读图片原始尺寸 + 登记资源表 + 走 addCards 命令（见 types.ts）。
   */
  createCardFromFile: (input: CreateCardInput) => Promise<boolean>
  /**
   * 在画布上加一张「不对应任何硬盘文件」的卡片（插件自绘类型，如待办卡）；
   * 成功返回新卡片 id（插件后续更新内容要用），失败（未打开空间 / 只读 / 无画布）返回 null。
   */
  createCard: (input: CreatePlainCardInput) => Promise<string | null>
  /**
   * 更新插件卡片的内容：meta **整体替换** + 可选高度（自适应内容），
   * 两个变化合为一条命令入撤销栈 —— 撤销一次就完整回到原样。
   * 成功返回 true；卡片不存在 / 只读 / 未打开空间返回 false。
   */
  updateCardContent: (input: UpdateCardContentInput) => Promise<boolean>
}

let bridge: PluginBoardBridge | null = null

/** 注册 / 注销桥接实现（传 null 表示画布已卸载） */
export function setPluginBoardBridge(next: PluginBoardBridge | null): void {
  bridge = next
}

/** 取当前桥接实现；未注册时返回 null */
export function getPluginBoardBridge(): PluginBoardBridge | null {
  return bridge
}
