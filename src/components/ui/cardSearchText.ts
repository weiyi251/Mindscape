// ============================================================================
// 模块说明（中文）
// 画布搜索浮层的中文文案表（2026-09-21 移动端适配 M3，对应 docs/移动端适配计划.md §3 M3）。
//
// 为什么要拆出来：浮层里有四处文案**带快捷键**（Shift+Enter / Enter / Esc），
// 触屏上没有物理键盘，这些提示在安卓既是噪音也是误导。两套措辞必须由平台能力表
// 选择，而选择结果要能在 node 环境断言（项目不引入 jsdom，见 AGENTS.md 规则 2），
// 所以文案与判定一起放这张纯常量表里 —— 与 canvasOverlayText.ts 同一套做法。
//
// 约定：中文 UI 文案一律进常量表（README / 计划书 17.1），组件里只写选择逻辑。
// ============================================================================

/** 一套（桌面或触屏）搜索浮层的全部可变文案 */
export interface CardSearchText {
  previous: string
  next: string
  close: string
  /** 输入框为空时的引导语 */
  empty: string
}

export const CARD_SEARCH_TEXT: Record<'desktop' | 'touch', CardSearchText> = {
  desktop: {
    previous: '上一个（Shift+Enter）',
    next: '下一个（Enter）',
    close: '关闭（Esc）',
    empty: '输入关键字，按 Enter 在命中项之间跳转',
  },
  touch: {
    previous: '上一个',
    next: '下一个',
    close: '关闭',
    empty: '输入关键字搜索，点结果即可跳转',
  },
}

/** 搜索浮层的固定文案（不随平台变化） */
export const CARD_SEARCH_STATIC_TEXT = {
  placeholder: '搜索文件名、便签正文或分区名',
  noMatch: '没有匹配的卡片',
  /** 命中计数「N 项」的量词 */
  countUnit: '项',
}
