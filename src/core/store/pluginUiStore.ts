// ============================================================================
// 模块说明（中文）
// 插件对话框的宿主状态（Zustand）。
//
// 为什么需要：插件（如色卡）需要自己的输入界面（选颜色、尺寸）。
// 但插件代码在 core/registry 之外、又不能直接渲染 React 树 ——
// 于是走「插件把 render 函数交出来，宿主负责挂载」的模式：
//
//   插件  activate(api) → api.ui.openDialog(() => <ColorCardDialog .../>)
//   宿主  <PluginDialogHost />（挂在 Board 里）订阅本 store 并渲染
//
// 这样插件 UI 代码可以完全待在插件自己的文件夹里（用户要求：
// 「插件相关代码独立拆分，集中放入单独的文件夹」），宿主只认一个 render 函数。
//
// 属于低频状态（只在用户打开插件对话框时变），放 Zustand 完全合适。
// ============================================================================

import type { ReactNode } from 'react'
import { create } from 'zustand'

/** 当前打开的插件对话框描述 */
export interface PluginDialogState {
  /** 打开它的插件 id（用于标题与归属判断） */
  pluginId: string
  /** 弹窗标题 */
  title: string
  /** 内容渲染函数（由插件提供） */
  render: () => ReactNode
}

export interface PluginUiState {
  dialog: PluginDialogState | null
  /** 打开插件对话框（同时只允许一个） */
  openDialog: (dialog: PluginDialogState) => void
  /** 关闭当前对话框 */
  closeDialog: () => void
}

export const usePluginUiStore = create<PluginUiState>((set) => ({
  dialog: null,
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
}))

/** 非 React 环境（插件运行时）打开对话框的便捷入口 */
export function openPluginDialog(dialog: PluginDialogState): void {
  usePluginUiStore.getState().openDialog(dialog)
}

/** 非 React 环境关闭对话框 */
export function closePluginDialog(): void {
  usePluginUiStore.getState().closeDialog()
}
