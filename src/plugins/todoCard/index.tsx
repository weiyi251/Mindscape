// ============================================================================
// 模块说明（中文）
// 待办卡片插件的**入口**：声明元信息，并在 activate(api) 里注册它能提供的东西。
//
// 两类能力（与色卡插件同一套扩展点机制）：
//   · registerCardType —— 注册 todo 卡片类型：view.tsx 渲染条目行，
//     resizeHandles: 'widthHeight'（左缘调宽 + 下缘调高；高度仍以内容自适应为下限）；
//   · registerCanvasMenuItem —— 画布空白右键「新建待办」：经 api.board.createCard
//     在**右键点**落一张空待办卡（无文件建卡，undo 只删卡）；
//   · registerMenuItem —— 待办卡右键「完成项排列」三选一（2026-09-18 用户需求），
//     与全应用同一 ContextMenu 渲染层，风格天然统一。
//
// 「插件不 import 宿主」的纪律：这里只调用 api 上的方法，卡片数据的读写全部
// 走 meta 自由扩展位（meta.items / meta.itemAnchors），core 只认识通用协议
// （itemAnchors 锚点表），不认识「待办」本身。
// ============================================================================

import type { BuiltinPluginDescriptor } from '@/core/plugin/types'
import { TodoCardView } from './view'
import { TODO_DEFAULT_W, metaWithPlacement, placementOfMeta, titleOfMeta, todosOfMeta, todoCardHeight } from './todos'
import type { TodoCompletedPlacement } from './todos'
import { TODO_CARD_TEXT } from './text'

/** 插件 id（反向域名风格；也是 plugins.json 的键） */
export const TODO_CARD_PLUGIN_ID = 'mindscape.todo-card'

/** 注册的卡片类型 id（card.type === 'todo'） */
export const TODO_CARD_TYPE = 'todo'

/** 画布空白菜单项 id */
export const TODO_MENU_ITEM_ID = 'mindscape.todo-card.create'

export const todoCardPlugin: BuiltinPluginDescriptor = {
  manifest: {
    id: TODO_CARD_PLUGIN_ID,
    name: TODO_CARD_TEXT.pluginName,
    version: '1.0.0',
    description: TODO_CARD_TEXT.pluginDescription,
    author: TODO_CARD_TEXT.pluginAuthor,
    // 内置插件不经动态 import，这个字段只为与外部插件保持同一份清单形状
    main: 'index.js',
  },

  activate(api) {
    // 卡片类型：view 渲染 + widthHeight 手柄（左缘调宽 + 下缘调高）+
    // 空卡默认尺寸（含添加行）。高度可手动调是 2026-09-18 用户需求：
    // 几何同步「只增不减」，拖高留出的空白不会被实测值吃掉
    api.registerCardType({
      type: TODO_CARD_TYPE,
      render: (props) => <TodoCardView card={props.card} api={api} />,
      menu: [],
      defaultSize: { w: TODO_DEFAULT_W, h: todoCardHeight(0) },
      resizeHandles: 'widthHeight',
      // Ctrl+F 搜索（2026-09-20 搜索打通插件卡）：标题 + 每条待办正文都参与匹配
      searchText: (card) =>
        [titleOfMeta(card.meta), ...todosOfMeta(card.meta).map((item) => item.text)]
          .filter((text) => text !== '')
          .join('\n'),
    })

    // 待办卡右键菜单（与全应用同一 ContextMenu 渲染层，风格天然统一）：
    // 「完成项排列」三选一，写入 meta.completedPlacement，显示顺序随之重排
    // （渲染派生），一条命令可撤销。同值点击早退（不产生无意义的撤销记录）；
    // 右键菜单项是静态配置，无法随卡片状态动态标「当前」—— 三项并列可点即可
    const placementItems: TodoCompletedPlacement[] = ['none', 'bottom', 'top']
    const placementLabels: Record<TodoCompletedPlacement, string> = {
      none: TODO_CARD_TEXT.placementNone,
      bottom: TODO_CARD_TEXT.placementBottom,
      top: TODO_CARD_TEXT.placementTop,
    }
    for (const placement of placementItems) {
      api.registerMenuItem(
        {
          id: `${TODO_MENU_ITEM_ID}.placement.${placement}`,
          label: placementLabels[placement],
          appliesTo: (card) => card.type === TODO_CARD_TYPE,
          action: (ctx) => {
            if (!ctx.card) return
            if (placementOfMeta(ctx.card.meta) === placement) return
            void api.board.updateCardContent({
              cardId: ctx.card.id,
              meta: metaWithPlacement(ctx.card.meta, placement),
            })
          },
        },
        TODO_CARD_TYPE,
      )
    }

    // 画布空白右键入口：新建待办卡片（右键点 = 卡片左上角，与新建分区同体验；
    // 坐标缺省时由宿主放视口中心）
    api.registerCanvasMenuItem({
      id: TODO_MENU_ITEM_ID,
      label: TODO_CARD_TEXT.menuLabel,
      action: (ctx) => {
        void api.board.createCard({
          type: TODO_CARD_TYPE,
          x: ctx.canvasPoint?.x,
          y: ctx.canvasPoint?.y,
          w: TODO_DEFAULT_W,
          h: todoCardHeight(0),
          meta: { items: [], itemAnchors: {} },
        })
      },
    })
  },
}
