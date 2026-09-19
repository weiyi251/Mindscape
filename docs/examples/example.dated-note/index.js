// ============================================================================
// Mindscape 官方示例外部插件：日期便签（example.dated-note）
//
// 演示一个「最小但真实可用」的外部插件：
//   · manifest.json —— 清单契约（id / name / version / main，见 docs/插件开发指南.md §2.2）
//   · index.js      —— ES module，导出 activate(api)；宿主在启用时注入 api
//   · 只用画布菜单 + 无文件建卡两个能力，不 import 宿主任何模块（铁律 §1.1）
//
// 安装：把整个 example.dated-note 文件夹复制到
//   %APPDATA%\Mindscape\plugins\
// 然后打开 设置面板 → 插件 → 刷新 → 启用。详见本目录 README.md。
// ============================================================================

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

/** 今天的日期文本，如「2026-09-20 周日」。独立导出便于单元测试。 */
export function formatDate(now) {
  const pad = (value) => String(value).padStart(2, '0')
  return (
    now.getFullYear() +
    '-' +
    pad(now.getMonth() + 1) +
    '-' +
    pad(now.getDate()) +
    ' 周' +
    WEEKDAYS[now.getDay()]
  )
}

export function activate(api) {
  api.registerCanvasMenuItem({
    id: 'example.dated-note.create',
    label: '新建日期便签',
    action(ctx) {
      void api.board.createCard({
        type: 'note',
        note: formatDate(new Date()),
        ...(ctx.canvasPoint ? { x: ctx.canvasPoint.x, y: ctx.canvasPoint.y } : {}),
      })
    },
  })
}

// 宿主回收注册之后调用；本插件没有定时器 / 订阅等外部资源，留空即可。
export function deactivate() {}
