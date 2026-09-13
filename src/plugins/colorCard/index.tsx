// ============================================================================
// 模块说明（中文）
// 色卡插件的**入口**：声明元信息，并在 activate(api) 里注册它能提供的东西。
//
// 一个插件文件夹的内部结构（约定，见 docs/插件功能实施方案.md §8 阶段 4）：
//   index.tsx      元信息 + activate（唯一的对外出口，被 builtinPlugins.ts 引用）
//   text.ts        中文文案常量
//   options.ts     参数模型 + 纯函数（预设 / 校验 / 文件名 / 配置映射）
//   png.ts         Canvas 2D → PNG 字节
//   save.ts        生成 → 写盘 →（可选）建卡 的编排
//   dialog.tsx     用户界面（交给宿主挂载）
//
// 「插件不 import 宿主」这条纪律具体到本插件就是：这里只调用 api 上的方法
// （registerCanvasMenuItem / ui.openDialog），绝不直接 import pluginCenter 的
// registerX —— 那些注册必须带上 pluginId 归属，宿主才知道「停用时该回收什么」。
//
// 用户要求的四项能力分别落在：
//   · 自定义新建色卡 —— 本文件的 registerCanvasMenuItem（画布空白菜单「新建色卡…」）
//   · 选择颜色、尺寸  —— dialog.tsx + options.ts
//   · 生成 PNG        —— png.ts
//   · 保存到指定文件夹 —— save.ts（走 api.fs.writeBytes → Rust write_file_bytes）
// ============================================================================

import type { BuiltinPluginDescriptor } from '@/core/plugin/types'
import { ColorCardDialog } from './dialog'
import { COLOR_CARD_TEXT } from './text'

/** 插件 id（反向域名风格；也是 card.meta 的命名空间与 plugins.json 的键） */
export const COLOR_CARD_PLUGIN_ID = 'mindscape.color-card'

/** 画布空白菜单项 id */
export const COLOR_CARD_MENU_ITEM_ID = 'mindscape.color-card.create'

export const colorCardPlugin: BuiltinPluginDescriptor = {
  manifest: {
    id: COLOR_CARD_PLUGIN_ID,
    name: COLOR_CARD_TEXT.pluginName,
    version: '1.0.0',
    description: COLOR_CARD_TEXT.pluginDescription,
    author: COLOR_CARD_TEXT.pluginAuthor,
    // 内置插件不经动态 import，这个字段只为与外部插件保持同一份清单形状
    main: 'index.js',
  },

  activate(api) {
    api.registerCanvasMenuItem({
      id: COLOR_CARD_MENU_ITEM_ID,
      label: COLOR_CARD_TEXT.menuLabel,
      action: (ctx) => {
        // 界面由宿主挂载（plugin-dialog-host.tsx），插件只交出 render 函数，
        // 因此插件 UI 的全部代码都待在本文件夹内，宿主不认识「色卡」。
        api.ui.openDialog(COLOR_CARD_TEXT.dialogTitle, () => (
          <ColorCardDialog api={api} spacePath={ctx.spacePath} />
        ))
      },
    })
  },
}
