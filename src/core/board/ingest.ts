// ============================================================================
// 模块说明（中文）
// 拖入 / 粘贴的内容摄取规则。对应开发计划书 T3.6 / T3.7 / T3.8 与第八章：
//
//   · 拖入 = 复制模式（决策 15：原件保留）；重名自动 `_1`（决策 16，Rust 端负责）
//   · 落点规则（T3.7 / 8.1；2026-09-13 用户裁决修订）：落点在分区框内 →
//     该分区对应的子文件夹；空白 → **空间主目录（根目录）**。
//     【旧规则废止】曾经把空白落点放进物理的 `未分类\` 子文件夹 ——
//     现在未分组文件直接放根目录，不再创建「未分类」文件夹。
//     已存在的 `未分类\` 是旧版遗留，软件不动它（铁律②「不搬家」），
//     用户可用卡片菜单「移动到…」把里面的文件逐个移到想要的位置。
//   · 粘贴文件名（T3.8 / 8.2）：`粘贴-YYYYMMDD-HHmm.png`（本地时间，分钟精度）
//
// 拖入文件本身必须走 Tauri v2 的 onDragDropEvent 拿真实路径（17.4 / 17.11，
// HTML5 drop 拿不到路径）—— 本模块只提供落点判定与命名，事件接线在 Board.tsx。
//
// 纯函数，可单元测试。
// 实现任务：T3.6 / T3.7 / T3.8。
// ============================================================================

import type { Card, Partition } from '@/core/types'
import { zCardSchema } from '@/core/types'
import { joinPath } from '@/core/utils/paths'
import { pad2 } from '@/core/utils/time'

/**
 * 旧版「未分类」物理子文件夹名。
 * ⚠️ 2026-09-13 起新落点**不再使用**它（空白落点 = 空间根目录）；
 * 保留此常量只为了两处历史兼容：
 *   · 识别存量卡片 filePath 的顶层段（`未分类/xxx` 仍是合法的历史数据）；
 *   · 「移动到…」菜单的「未分类」标签沿用这个名字指代空间根目录。
 */
export const UNCLASSIFIED_DIR = '未分类'

/**
 * 核心三类型的集合：图片 / 文件的复制粘贴依赖硬盘文件（copyFile），
 * 与「内容就在卡片数据里」的无文件卡是两条不同的粘贴路径。
 */
const FILE_BACKED_CARD_TYPES = new Set(['image', 'file'])

/**
 * 可复制的卡片判定（2026-09-11 用户裁决：图片 / 文件 / 便签都支持复制与粘贴；
 * 2026-09-18 扩展：无文件的插件卡——如待办卡——同样可复制）。
 *   · 便签 / 无文件插件卡：内容存在卡片数据里（note / meta），克隆即可复制；
 *   · 图片 / 文件：必须有硬盘文件（filePath 非空）才拷贝得出来。
 * 不可复制的卡片直接排除，不会进入应用内剪贴板。
 */
export function isCopyableCard(card: Pick<Card, 'type' | 'filePath'>): boolean {
  if (card.filePath !== '') return true
  // 无文件：便签是历史先例；其余无文件类型只能是插件自绘卡（createCard 建的），
  // 内容全在 meta 里 —— 同样按「克隆」路径复制
  return card.type === 'note' || !FILE_BACKED_CARD_TYPES.has(card.type)
}

/**
 * 无文件插件卡的粘贴克隆（2026-09-18，待办卡等）：整卡复制数据、换新 id 与位置。
 *
 * 与 cardWithoutEditables 的差异（为什么不清 meta）：「粘贴不复制备注与标签」
 * 裁决针对的是**图片 / 文件卡**的编辑层信息；插件卡的 meta 就是**内容本体**
 * （待办卡的条目清单全在里面），清掉等于粘贴出一张空卡 —— 与便签克隆
 * 必须保留 note 是同一条道理。
 */
export function cloneFilelessCard(
  copied: Card,
  id: string,
  x: number,
  y: number,
  groupName: string | null,
): Card {
  const clone = zCardSchema.parse({
    ...copied,
    id,
    x: Math.round(x),
    y: Math.round(y),
  })
  if (groupName) clone.group = groupName
  return clone
}

/**
 * 粘贴进空间的文件 / 图片卡片字段净化（2026-09-13 用户裁决）：
 * 复制粘贴**仅搬运内容本身**（文件字节 = 原图），原卡的备注与标签是编辑层
 * 信息，不随副本走 —— 粘贴出的新卡一律不带它们；其余信息（尺寸、位置、
 * 分组归属）的复制行为保持不变。
 *
 * ⚠️ 只对文件 / 图片卡使用：便签的 note 就是内容本体，克隆时必须保留。
 * 现状 buildIngestedCard 构建的新卡本就不带这些字段，这里是显式固化裁决
 * 的防线（防止未来构建链路变化时悄悄带出）。
 */
export function cardWithoutEditables(card: Card): Card {
  return { ...card, note: '', meta: {} }
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

  // 空白落点 = 空间主目录（2026-09-13 用户裁决：不再创建「未分类」文件夹）
  return {
    destDir: spacePath,
    partitionId: null,
    groupName: null,
  }
}

/**
 * 粘贴截图的文件名（T3.8 / 8.2）：`粘贴-YYYYMMDD-HHmm.png`。
 * 分钟精度；同一分钟内粘两张 → Rust 端 unique_path_in 自动加 `_1` 后缀。
 * （补零复用 core/utils/time.ts 的 pad2，本文件不再自带一份。）
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
