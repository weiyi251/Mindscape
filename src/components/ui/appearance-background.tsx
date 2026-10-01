// ============================================================================
// 模块说明（中文）
// 背景图层：用户自选壁纸的渲染出口（App 顶层挂一份，全窗口共享）。
//
// · 层级 fixed inset-0 + 负 z：垫在全部内容底下，#root 的背景由 body 底色兜底；
//   不拦截任何指针事件（壁纸不是交互面，画布拖拽不能被它吃掉）。
// · bg-cover + 居中裁剪：任意宽高比的图都铺满窗口不变形。
// · 压暗遮罩走 .glass-bg-dim 类（颜色是 CSS 变量，组件不写颜色字面量 ——
//   architecture 规则 3），滑杆值实时生效。
// · 无壁纸时连 DOM 都不渲染（body 底色就是最终观感，与改造前完全一致）。
// ============================================================================

import { useAppearanceStore } from '@/core/appearance/appearanceStore'

export function AppearanceBackground() {
  const bgUrl = useAppearanceStore((state) => state.bgUrl)

  return (
    <div className="pointer-events-none fixed inset-0 -z-10" aria-hidden="true">
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
  )
}
