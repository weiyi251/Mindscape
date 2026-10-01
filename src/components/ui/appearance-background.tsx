// ============================================================================
// 模块说明（中文）
// 背景图层 + 画布毛玻璃层（App 顶层挂一份，全窗口共享）。
//
// · 层级（都是 fixed inset-0 + 负 z，数值大的后画 = 在上）：
//     壁纸 -z-20 → 画布玻璃 -z-10 → 全部内容（正常流）。
//   玻璃层背衬只有静态壁纸，卡片 / 画布都在它**之上**活动 —— 合成器不需要
//   因内容移动重采样本层（性能安全，与把 blur 落在画布浮件上的 17.11 不同）。
//   低端设备若拖动卡顿，外观页有「画布毛玻璃」开关可关（canvasGlass）。
// · 不拦截任何指针事件（背景不是交互面，画布拖拽不能被它吃掉）。
// · bg-cover + 居中裁剪：任意宽高比的图都铺满窗口不变形。
// · 压暗遮罩走 .glass-bg-dim 类（颜色是 CSS 变量，组件不写颜色字面量 ——
//   architecture 规则 3），滑杆值实时生效。
// · 无壁纸时壁纸层不渲染（html 底色兜底）；玻璃层默认仍渲染 —— 磨砂盖在
//   底色上，保持「毛玻璃覆盖在背景之上」的整体观感（开关关掉才没有）。
// ============================================================================

import { useAppearanceStore } from '@/core/appearance/appearanceStore'

export function AppearanceBackground() {
  const bgUrl = useAppearanceStore((state) => state.bgUrl)
  const canvasGlass = useAppearanceStore((state) => state.glass.canvasGlass)

  return (
    <>
      {canvasGlass ? <div className="glass-canvas-layer pointer-events-none fixed inset-0 -z-10" aria-hidden="true" /> : null}
      <div className="pointer-events-none fixed inset-0 -z-20" aria-hidden="true">
        {bgUrl !== null ? (
          <>
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url("${bgUrl}")` }}
            />
            <div className="glass-bg-dim absolute inset-0" />
          </>
        ) : null}
      </div>
    </>
  )
}
