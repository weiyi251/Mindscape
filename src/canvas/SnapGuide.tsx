// ============================================================================
// 模块说明（中文）
// 对齐参考线（SnapGuide）。对应开发计划书 T2.4 与 11.7。
//
// 实现约束（17.3）：参考线在拖动中每帧变化，**不进 React state** ——
// 父级通过 ref 拿句柄后直写 style。最多同时两条（x 轴一条 + y 轴一条），
// 因此固定两个 DOM 节点，不动态增删。
//
// 线的范围按「当前可见画布区域」传入（不画超长线，避免产生巨大的合成层，17.7）。
// ============================================================================

import { forwardRef, useImperativeHandle, useRef } from 'react'

import type { Rect } from '@/core/geometry/rect'
import type { GuideLine } from './interaction/snap'

export interface SnapGuideHandle {
  /** 更新参考线；传 null 表示该轴当前无对齐 */
  update(
    guides: { vertical: GuideLine | null; horizontal: GuideLine | null },
    bounds: Rect,
  ): void
  hide(): void
}

export const SnapGuide = forwardRef<SnapGuideHandle>(function SnapGuide(_props, ref) {
  const verticalRef = useRef<HTMLDivElement>(null)
  const horizontalRef = useRef<HTMLDivElement>(null)

  useImperativeHandle(
    ref,
    () => ({
      update(guides, bounds) {
        const vertical = verticalRef.current
        const horizontal = horizontalRef.current

        if (vertical) {
          if (guides.vertical) {
            vertical.style.display = 'block'
            vertical.style.transform = `translate3d(${guides.vertical.position}px, ${bounds.y}px, 0)`
            vertical.style.height = `${bounds.h}px`
          } else {
            vertical.style.display = 'none'
          }
        }

        if (horizontal) {
          if (guides.horizontal) {
            horizontal.style.display = 'block'
            horizontal.style.transform = `translate3d(${bounds.x}px, ${guides.horizontal.position}px, 0)`
            horizontal.style.width = `${bounds.w}px`
          } else {
            horizontal.style.display = 'none'
          }
        }
      },
      hide() {
        if (verticalRef.current) verticalRef.current.style.display = 'none'
        if (horizontalRef.current) horizontalRef.current.style.display = 'none'
      },
    }),
    [],
  )

  return (
    <>
      <div
        ref={verticalRef}
        style={{ display: 'none' }}
        className="pointer-events-none absolute left-0 top-0 z-10 w-px bg-accent/70"
      />
      <div
        ref={horizontalRef}
        style={{ display: 'none' }}
        className="pointer-events-none absolute left-0 top-0 z-10 h-px bg-accent/70"
      />
    </>
  )
})
