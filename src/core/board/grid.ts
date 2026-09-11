// ============================================================================
// 模块说明（中文）
// 网格自动铺开。对应 5.2 的「自动布局」：
//   「新读入的图自动按网格排布（避免堆在原点）」
//
// 算法：行式排布。逐行从左往右放，放满一列数就换行；
//   **行高取该行内最高的卡片**，所以卡片宽高不一致（T1.4 的真实宽高比）时也不会重叠，
//   且横向、纵向间距都严格等于 gap（T1.3 验收标准「间距均匀」）。
//
// ⚠️ 网格参数（起始位置 / 列数 / 间距）文档未给出，此处为拟定值，
//    集中放在 DEFAULT_GRID_OPTIONS 里，按实际观感调整只改一处。
//
// 纯函数，可单元测试。
//
// 实现任务：T1.3（阶段一）。
// ============================================================================

export interface GridItemSize {
  w: number
  h: number
}

export interface GridPosition {
  x: number
  y: number
}

export interface GridOptions {
  /** 第一列卡片的左边缘 */
  startX?: number
  /** 第一行卡片的顶边缘（留出边距，避免贴住容器左上角） */
  startY?: number
  /** 每行最多几张 */
  columns?: number
  /** 横向间距 */
  gapX?: number
  /** 纵向间距（行与行之间，基于行高计算） */
  gapY?: number
}

/** 拟定网格参数（文档未给） */
export const DEFAULT_GRID_OPTIONS: Required<GridOptions> = {
  startX: 80,
  startY: 80,
  columns: 5,
  gapX: 32,
  gapY: 32,
}

/**
 * 计算每个卡片左上角应放的位置（画布坐标）。
 * @param items   按显示顺序排列的卡片尺寸
 * @param options 网格参数
 */
export function layoutGrid(items: GridItemSize[], options: GridOptions = {}): GridPosition[] {
  const { startX, startY, columns, gapX, gapY } = { ...DEFAULT_GRID_OPTIONS, ...options }

  const positions: GridPosition[] = []
  if (items.length === 0) return positions

  const perRow = Math.max(1, Math.floor(columns))
  let x = startX
  let y = startY
  let rowMaxHeight = 0
  let column = 0

  for (const item of items) {
    if (column === perRow) {
      x = startX
      y += rowMaxHeight + gapY
      rowMaxHeight = 0
      column = 0
    }

    positions.push({ x, y })
    x += item.w + gapX
    rowMaxHeight = Math.max(rowMaxHeight, item.h)
    column += 1
  }

  return positions
}
