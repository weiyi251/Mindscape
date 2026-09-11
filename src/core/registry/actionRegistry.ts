// ============================================================================
// 模块说明（中文）
// 核心动作处理器注册表。为「配置驱动」的菜单 / 工具栏提供动作落点。
//
// 为什么需要它：
//   准备层（T0）只搭骨架，核心业务（移除卡片、置顶、改名…）要到阶段二才实现。
//   但菜单配置又不能是空壳 —— 否则「改配置即时反映到 UI」无法验证，点上去毫无反应。
//   因此把「菜单项的元数据（id/label/顺序/过滤）」与「动作实现」解耦：
//     · 菜单配置现在就写完整（真实 id、真实中文名、真实顺序）；
//     · 动作实现由各阶段任务在完成后调用 registerAction 登记；
//     · 未登记时点击给出明确的 console 提示（不静默、不抛错）。
//
// 与 17.11 反模式的关系：本模块不含任何业务判断，只做「id → 函数」的分发，
// 具体业务逻辑（含文件系统操作）由后续任务的命令层负责。
//
// 实现任务：T0.10（准备层）。
// ============================================================================

import type { MenuContext } from './pluginCenter'

/** 动作处理器。ctx 携带触发上下文（空间路径 / 卡片 / 分区框）。 */
export type ActionHandler = (ctx: MenuContext) => void

const handlers = new Map<string, ActionHandler>()

/** 登记一个动作实现。同一 id 重复登记会被覆盖（开发期 HMR 友好）。 */
export function registerAction(id: string, fn: ActionHandler): void {
  if (!id) throw new Error('registerAction 失败：id 不能为空')
  handlers.set(id, fn)
}

/** 注销动作实现 */
export function unregisterAction(id: string): void {
  handlers.delete(id)
}

/** 是否已有实现（UI 可据此把未实现项置灰） */
export function hasAction(id: string): boolean {
  return handlers.has(id)
}

/** 列出已登记的动作 id（调试 / 测试用） */
export function listRegisteredActionIds(): string[] {
  return [...handlers.keys()]
}

/**
 * 执行动作。未登记时打印提示并返回 false（不抛错 —— 准备层菜单允许先摆着）。
 * @param id    动作 id（与菜单项 id 一致）
 * @param label 中文名，仅用于提示文案
 * @param ctx   触发上下文；工具栏类无上下文动作传 undefined
 * @returns 是否真的执行了动作
 */
export function runAction(id: string, label: string, ctx?: MenuContext): boolean {
  const handler = handlers.get(id)
  if (!handler) {
    console.warn(`[actions] 核心动作「${label}」(${id}) 尚未实现，将在对应阶段任务中接入。`)
    return false
  }
  handler(ctx ?? { spacePath: '' })
  return true
}

/** 清空全部动作。仅供单元测试使用。 */
export function resetActions(): void {
  handlers.clear()
}
