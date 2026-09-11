// ============================================================================
// 模块说明（中文）
// 框选矩形（Ctrl + 左键拖出的半透明选框）。对应开发计划书 T2.3 与 11.5。
//
// 实现约束（17.3 / 17.7）：
//   · 选框每帧都在变，因此**不进 React state**：父级通过 ref 拿到句柄后直接写
//     style（transform / width / height），零 React 更新；
//   · 选框本身用画布坐标定位（stage 内），随视口缩放/平移自动保持正确；
//   · pointer-events-none：选框不参与命中，不会挡住卡片事件。
// ============================================================================

import { forwardRef, useImperativeHandle, useRef } from 'react'

import type { Rect } from './interaction/marquee'

/** 框选矩形的命令式句柄（父级每帧直写，不触发渲染） */
export interface SelectionBoxHandle {
  show(rect: Rect): void
  hide(): void
}

export const SelectionBox = forwardRef<SelectionBoxHandle>(function SelectionBox(_props, ref) {
  const boxRef = useRef<HTMLDivElement>(null)

  useImperativeHandle(
    ref,
    () => ({
      show(rect: Rect) {
        const element = boxRef.current
        if (!element) return
        element.style.display = 'block'
        element.style.transform = `translate3d(${rect.x}px, ${rect.y}px, 0)`
        element.style.width = `${rect.w}px`
        element.style.height = `${rect.h}px`
      },
      hide() {
        const element = boxRef.current
        if (!element) return
        element.style.display = 'none'
      },
    }),
    [],
  )

  return (
    <div
      ref={boxRef}
      style={{ display: 'none' }}
      className="pointer-events-none absolute left-0 top-0 border border-primary bg-primary/10"
    />
  )
})
