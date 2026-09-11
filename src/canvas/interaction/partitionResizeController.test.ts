// ============================================================================
// 模块说明（中文）
// 分区框大小调整控制器的单元测试（2026-09-11 用户裁决「分区框大小自定义」）。
// 固化：方向数学（e/s/se）、min/max 钳制、原地点击不产生命令、取消还原。
// ============================================================================

import { describe, expect, it, vi } from 'vitest'

import { PartitionResizeController } from './partitionResizeController'
import type { PartitionResizeDelegate, PartitionResizeSource } from './partitionResizeController'

function makeSource(): PartitionResizeSource & { zoom: number } {
  const source = {
    zoom: 1,
    getZoom: () => source.zoom,
    setSize: vi.fn(),
  }
  return source
}

function makeDelegate(): PartitionResizeDelegate {
  return { onResizeEnd: vi.fn() }
}

/** 伪造 PointerEvent 需要的字段 */
function fakeEvent(id: number, x: number, y: number, button = 0): PointerEvent {
  return { pointerId: id, clientX: x, clientY: y, button } as PointerEvent
}

/** 伪造可捕获的元素（jsdom 之外的 node 环境，直接 stub） */
function fakeElement(): HTMLElement {
  return {
    style: {},
    hasPointerCapture: () => true,
    releasePointerCapture: () => {},
    setPointerCapture: () => {},
  } as unknown as HTMLElement
}

const LIMITS = { minW: 100, minH: 80, maxW: 500, maxH: 400 }

describe('PartitionResizeController', () => {
  it('e（右缘）：水平位移换算成宽度', () => {
    const source = makeSource()
    const delegate = makeDelegate()
    const controller = new PartitionResizeController(source, delegate)
    const element = fakeElement()

    expect(controller.begin(fakeEvent(1, 0, 0), { partitionId: 'p1', element, edge: 'e', size: { w: 200, h: 200 }, limits: LIMITS })).toBe(true)
    controller.move(fakeEvent(1, 70, 999)) // dy 不影响宽度
    expect(source.setSize).toHaveBeenLastCalledWith(element, 270, 200)
    controller.end(fakeEvent(1, 70, 999))
    expect(delegate.onResizeEnd).toHaveBeenCalledWith('p1', { w: 200, h: 200 }, { w: 270, h: 200 })
  })

  it('s（下缘）：垂直位移换算成高度', () => {
    const source = makeSource()
    const delegate = makeDelegate()
    const controller = new PartitionResizeController(source, delegate)
    const element = fakeElement()

    controller.begin(fakeEvent(1, 0, 0), { partitionId: 'p1', element, edge: 's', size: { w: 200, h: 200 }, limits: LIMITS })
    controller.move(fakeEvent(1, 999, -60))
    expect(source.setSize).toHaveBeenLastCalledWith(element, 200, 140)
    controller.end(fakeEvent(1, 999, -60))
    expect(delegate.onResizeEnd).toHaveBeenCalledWith('p1', { w: 200, h: 200 }, { w: 200, h: 140 })
  })

  it('se（右下角）：宽高同时变化', () => {
    const source = makeSource()
    const delegate = makeDelegate()
    const controller = new PartitionResizeController(source, delegate)

    controller.begin(fakeEvent(1, 0, 0), { partitionId: 'p1', element: fakeElement(), edge: 'se', size: { w: 200, h: 200 }, limits: LIMITS })
    controller.move(fakeEvent(1, 50, 40))
    controller.end(fakeEvent(1, 50, 40))
    expect(delegate.onResizeEnd).toHaveBeenCalledWith('p1', { w: 200, h: 200 }, { w: 250, h: 240 })
  })

  it('缩放比换算：zoom = 2 时屏幕位移减半', () => {
    const source = makeSource()
    source.zoom = 2
    const delegate = makeDelegate()
    const controller = new PartitionResizeController(source, delegate)

    controller.begin(fakeEvent(1, 0, 0), { partitionId: 'p1', element: fakeElement(), edge: 'e', size: { w: 200, h: 100 }, limits: LIMITS })
    controller.move(fakeEvent(1, 100, 0))
    controller.end(fakeEvent(1, 100, 0))
    expect(delegate.onResizeEnd).toHaveBeenCalledWith('p1', { w: 200, h: 100 }, { w: 250, h: 100 })
  })

  it('min / max 钳制：缩小不低于 min、放大不超过 max', () => {
    const source = makeSource()
    const delegate = makeDelegate()
    const controller = new PartitionResizeController(source, delegate)

    controller.begin(fakeEvent(1, 0, 0), { partitionId: 'p1', element: fakeElement(), edge: 'e', size: { w: 200, h: 100 }, limits: LIMITS })
    controller.move(fakeEvent(1, -500, 0)) // 远超 min
    expect(source.setSize).toHaveBeenLastCalledWith(expect.anything(), 100, 100)
    controller.move(fakeEvent(1, 2000, 0)) // 远超 max
    expect(source.setSize).toHaveBeenLastCalledWith(expect.anything(), 500, 100)
    controller.end(fakeEvent(1, 2000, 0))
    expect(delegate.onResizeEnd).toHaveBeenCalledWith('p1', { w: 200, h: 100 }, { w: 500, h: 100 })
  })

  it('原地单击（尺寸没变）：还原 DOM，不产生命令', () => {
    const source = makeSource()
    const delegate = makeDelegate()
    const controller = new PartitionResizeController(source, delegate)
    const element = fakeElement()

    controller.begin(fakeEvent(1, 0, 0), { partitionId: 'p1', element, edge: 'se', size: { w: 200, h: 200 }, limits: LIMITS })
    controller.end(fakeEvent(1, 0, 0))
    expect(source.setSize).toHaveBeenLastCalledWith(element, 200, 200)
    expect(delegate.onResizeEnd).not.toHaveBeenCalled()
  })

  it('cancel：还原 DOM，不产生命令', () => {
    const source = makeSource()
    const delegate = makeDelegate()
    const controller = new PartitionResizeController(source, delegate)
    const element = fakeElement()

    controller.begin(fakeEvent(1, 0, 0), { partitionId: 'p1', element, edge: 'e', size: { w: 200, h: 200 }, limits: LIMITS })
    controller.move(fakeEvent(1, 100, 0))
    controller.cancel()
    expect(source.setSize).toHaveBeenLastCalledWith(element, 200, 200)
    expect(delegate.onResizeEnd).not.toHaveBeenCalled()
  })

  it('非左键按下不启动', () => {
    const source = makeSource()
    const delegate = makeDelegate()
    const controller = new PartitionResizeController(source, delegate)

    expect(controller.begin(fakeEvent(1, 0, 0, 2), { partitionId: 'p1', element: fakeElement(), edge: 'e', size: { w: 200, h: 200 }, limits: LIMITS })).toBe(false)
    expect(controller.isResizing).toBe(false)
  })
})
