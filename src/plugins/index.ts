// ============================================================================
// 模块说明（中文）
// 插件目录的统一入口（barrel）。
//
// 目录约定：**一个插件一个文件夹** —— src/plugins/<插件名>/，
// 每个文件夹自带它的文案、参数、生成逻辑与界面，互不引用。
// 本文件只做转出，不写逻辑，是应用其它部分接触插件系统的唯一入口。
//
// 历史上这里是一个空占位（`export {}`），因为第一版只有 pluginCenter 的接口、
// 没有任何生产路径会加载插件。插件功能落地后它变成了真正的入口：
// main.tsx 只 import 本文件即可完成「内置插件登记 + 宿主初始化」。
//
// 完整设计见 docs/插件功能实施方案.md，结构说明见 docs/插件系统-结构与实现要点.md。
// ============================================================================

export { BUILTIN_PLUGINS } from './builtinPlugins'
export { bootstrapPlugins } from './bootstrap'
export {
  COLOR_CARD_MENU_ITEM_ID,
  COLOR_CARD_PLUGIN_ID,
  colorCardPlugin,
} from './colorCard'
