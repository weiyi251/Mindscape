// ============================================================================
// 模块说明（中文）
// 拖入 / 粘贴的内容摄取规则。对应开发计划书 T3.6 / T3.7 / T3.8 与第八章：
//
//   · 拖入 = 复制模式（决策 15：原件保留）；重名自动 `_1`（决策 16，Rust 端负责）
//   · 落点规则（T3.7 / 8.1）：落点在分区框内 → 该分区对应的子文件夹；
//     空白 → `未分类\`（不存在时自动创建 —— copy 命令的 create_dir_all 兜底）
//   · 粘贴文件名（T3.8 / 8.2）：`粘贴-YYYYMMDD-HHmm.png`（本地时间，分钟精度）
//
// 拖入文件本身必须走 Tauri v2 的 onDragDropEvent 拿真实路径（17.4 / 17.11，
// HTML5 drop 拿不到路径）—— 本模块只提供落点判定与命名，事件接线在 Board.tsx。
//
// 纯函数，可单元测试。
// 实现任务：T3.6 / T3.7 / T3.8。
// ============================================================================

import type { Card, Partition } from '@/core/types'
import { joinPath } from '@/core/utils/paths'

/** 空白落点目标子文件夹名（8.1） */
export const UNCLASSIFIED_DIR = '未分类'

/**
 * 可复制的卡片判定（2026-09-11 用户裁决：图片 / 文件 / 便签都支持复制与粘贴）。
 *   · 便签：纯文字、无硬盘文件，无条件可复制（粘贴时克隆文字内容）；
 *   · 图片 / 文件：必须有硬盘文件（filePath 非空）才拷贝得出来。
 * 不可复制的卡片直接排除，不会进入应用内剪贴板。
 */
export function isCopyableCard(card: Pick<Card, 'type' | 'filePath'>): boolean {
  return card.type === 'note' || card.filePath !== ''
}

/** 一次拖入 / 粘贴的落点判定结果 */
export interface DropDestination {
  /** 目标文件夹绝对路径（可能尚不存在，由 copy 命令自动创建） */
  destDir: string
  /** 落点命中的分区框 id；空白落点为 null */
  partitionId: string | null
  /** 命中分区时该分区在画布上的 group 名（= 分区名）；空白为 null */
  groupName: string | null
}

/**
 * 判定拖入 / 粘贴的落点（T3.7）。
 * 命中规则：画布坐标点落在分区框矩形内（含标题条）即视为「框内」；
 * 多个框重叠时取面积最小的（最精确的命中），与视觉直觉一致。
 *
 * 坐标点用内联结构类型，而不是 `@/canvas/interaction/connectionAnchor` 的 `Point`：
 * core 层不得依赖 canvas 层（架构守卫规则 4），而这里只需要两个数字，不值得把类型
 * 提到公共层（canvas 层里已存在 connectionAnchor / coordinates 两处 Point 定义）。
 */
export function resolveDropDestination(
  point: { x: number; y: number },
  partitions: readonly Partition[],
  spacePath: string,
): DropDestination {
  const hit = partitions
    .filter(
      (partition) =>
        point.x >= partition.x &&
        point.x <= partition.x + partition.w &&
        point.y >= partition.y &&
        point.y <= partition.y + partition.h,
    )
    .sort((a, b) => a.w * a.h - b.w * b.h)[0]

  if (hit) {
    return {
      destDir: joinPath(spacePath, hit.folderPath),
      partitionId: hit.id,
      groupName: hit.name,
    }
  }

  return {
    destDir: joinPath(spacePath, UNCLASSIFIED_DIR),
    partitionId: null,
    groupName: null,
  }
}

/** 补零（2 位） */
function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * 粘贴截图的文件名（T3.8 / 8.2）：`粘贴-YYYYMMDD-HHmm.png`。
 * 分钟精度；同一分钟内粘两张 → Rust 端 unique_path_in 自动加 `_1` 后缀。
 */
export function pasteFileName(now: Date): string {
  return `粘贴-${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}.png`
}

/**
 * 分区框扩大结果（T3.7）：把框的包围盒扩到包住新卡片（只扩不缩）。
 * 返回 null 表示框已包住卡片，无需变化。
 */
export function expandedBounds(
  partition: Partition,
  card: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } | null {
  const minX = Math.min(partition.x, card.x)
  const minY = Math.min(partition.y, card.y)
  const maxX = Math.max(partition.x + partition.w, card.x + card.w)
  const maxY = Math.max(partition.y + partition.h, card.y + card.h)

  const next = { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  if (
    next.x === partition.x &&
    next.y === partition.y &&
    next.w === partition.w &&
    next.h === partition.h
  ) {
    return null
  }
  return next
}
