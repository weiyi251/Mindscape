// ============================================================================
// 模块说明（中文）
// 随应用一起发布的内置插件清单。
//
// 为什么单独成文件（而不是塞进 bootstrap.ts）：这里是回答「这个应用自带哪些插件」
// 的唯一位置，值得单独一眼能看完。插件本身的代码一律在各自的子文件夹里
// （src/plugins/<插件名>/），本文件只做「汇总 + 排序」。
//
// 外部插件（用户放进 %APPDATA%\Mindscape\plugins\ 的）不在这里，
// 它们由 pluginHost 扫描出来，与本清单合并后一起呈现在设置页的插件列表里。
// ============================================================================

import type { BuiltinPluginDescriptor } from '@/core/plugin/types'
import { colorCardPlugin } from './colorCard'

export const BUILTIN_PLUGINS: BuiltinPluginDescriptor[] = [colorCardPlugin]
