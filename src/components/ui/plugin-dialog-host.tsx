// ============================================================================
// 模块说明（中文）
// 插件对话框宿主：把「插件自己渲染的界面」挂到应用里。
//
// 为什么要有它（对应需求「插件相关代码独立拆分，集中放入单独的文件夹」）：
//   插件要提供自己的输入界面（色卡插件：选颜色 / 尺寸 / 输出文件夹），
//   但插件既不在 React 树里，也不该去 import 宿主的弹窗组件 ——
//   否则插件代码就散到宿主里了。
//   于是约定：插件把 `() => ReactNode` 交给 api.ui.openDialog，
//   宿主在**一个固定位置**挂载它。插件代码 100% 待在插件自己的目录里。
//
// 同时只允许一个插件对话框（pluginUiStore 里 dialog 是单值）。
// ============================================================================

import { usePluginUiStore } from '@/core/store/pluginUiStore'
import { Modal } from './modal'

export function PluginDialogHost() {
  const dialog = usePluginUiStore((state) => state.dialog)
  const closeDialog = usePluginUiStore((state) => state.closeDialog)

  if (!dialog) return null

  return (
    <Modal open title={dialog.title} onClose={closeDialog} className="max-w-lg">
      {dialog.render()}
    </Modal>
  )
}
