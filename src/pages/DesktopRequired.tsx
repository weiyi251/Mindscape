// ============================================================================
// 模块说明（中文）
// 「请用桌面窗口打开」提示页。
//
// 触发场景：有人直接用浏览器打开了 vite 开发服务器地址（http://localhost:xxxx）。
// 页面本身能渲染，但没有 Rust 后端 —— 所有本地文件操作都会失败。
// 与其让用户看到 `Cannot read properties of undefined (reading 'invoke')`，
// 不如在这里把原因和正确的启动方式一次说清楚。
//
// 实现任务：T1.1 修复（阶段一）。
// ============================================================================

const CURRENT_URL = (() => {
  if (typeof window === 'undefined') return '(未知)'
  return window.location.href
})()

export function DesktopRequired() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-background p-6">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card p-6">
        <h1 className="text-sm font-medium">需要在桌面窗口中运行</h1>

        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          当前页面是用浏览器打开的。Mindscape 依赖桌面窗口提供本机能力 ——
          读取任意文件夹、系统文件选择对话框、图片资源通道，这些在浏览器里都不存在，
          所以「选择文件夹」等操作无法完成。
        </p>

        <div className="mt-4 rounded border border-border bg-muted/40 px-3 py-2">
          <p className="text-[11px] text-muted-foreground">在项目目录执行：</p>
          <code className="mt-1 block font-mono text-xs">pnpm tauri dev</code>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          如果桌面窗口已经开着，请直接切到那个窗口（标题「Mindscape 脑海空间」）操作，
          不要用浏览器打开它打印出的地址。
        </p>

        <p className="mt-3 break-all text-[11px] text-muted-foreground">当前地址：{CURRENT_URL}</p>
      </div>
    </div>
  )
}
