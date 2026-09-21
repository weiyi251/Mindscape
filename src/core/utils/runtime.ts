// ============================================================================
// 模块说明（中文）
// 运行环境判定。
//
// Mindscape 是 **Tauri 桌面应用**：本地文件读写、系统文件夹对话框、图片资源通道
// 全部依赖窗口里的 Rust 后端（`window.__TAURI_INTERNALS__`）。
//
// 如果直接用浏览器打开开发服务器地址（http://localhost:xxxx），页面能渲染，
// 但所有 invoke 都会失败，报出的是英文低级错误：
//   Cannot read properties of undefined (reading 'invoke')
// 对使用者毫无意义。因此统一在这里判定环境，并给出一句能照做的中文说明。
//
// 实现任务：T1.1 修复（阶段一）。
//
// 2026-09-21 移动端适配（M1）追加 `isMobileRuntime()`：Tauri 安卓/iOS 窗口里
// `__TAURI_INTERNALS__` 同样存在，故本模块的桌面判定**不能**用来表达「非移动端」。
// ============================================================================

/** 非桌面环境时展示的说明（中文，可直接显示给用户） */
export const DESKTOP_ONLY_MESSAGE =
  'Mindscape 是桌面应用：本地文件夹读写、文件选择对话框都依赖桌面窗口。' +
  '请用 pnpm tauri dev 启动桌面窗口后再操作，不要直接用浏览器打开开发服务器地址。'

/**
 * 当前是否运行在 Tauri 桌面窗口内。
 * 浏览器（含 vite dev / vite preview 打开的页面）与单元测试环境都会返回 false。
 */
export function isDesktopRuntime(): boolean {
  if (typeof window === 'undefined') return false
  const internals = (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  return typeof internals === 'object' && internals !== null
}

/**
 * 断言当前处于桌面环境。
 * 在需要本机能力的调用入口先执行它，把底层英文 TypeError 换成可执行的中文提示。
 */
export function assertDesktopRuntime(): void {
  if (isDesktopRuntime()) return
  throw new Error(DESKTOP_ONLY_MESSAGE)
}

/** 取当前 UserAgent；node（含单元测试）没有 navigator，返回空串 */
export function currentUserAgent(): string {
  return typeof navigator === 'undefined' ? '' : navigator.userAgent
}

/**
 * 当前是否运行在移动端（Android / iOS 的 Tauri 窗口，2026-09-21 移动端适配 M1）。
 *
 * 注意与 `isDesktopRuntime()` 的关系：Tauri 移动端**同样**有 `__TAURI_INTERNALS__`
 * （invoke / fs 命令都可用），所以「是不是 Tauri」不能用桌面判定表达；这里改看
 * UserAgent —— Android WebView / iOS WKWebView 的 UA 都含平台标识，桌面 WebView2
 * 不含。注入 userAgent 参数便于单测（node 环境没有 navigator）。
 */
export function isMobileRuntime(userAgent: string = currentUserAgent()): boolean {
  return /Android|iPhone|iPad|Mobile/i.test(userAgent)
}
