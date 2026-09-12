// ============================================================================
// 模块说明（中文）
// 卡片资源表：cardId → 该卡片要显示的图片**原图绝对路径**。
//
// 【为什么独立于 Card 数据】
//   4.2 的卡片字段定义里没有图片绝对路径，zCardSchema 会 strip 掉未知字段，
//   写进去只会丢掉；而且这些路径是**本机绝对路径**，一旦写进 layout.json
//   换机器（或换了空间文件夹位置）就全错 —— 它是运行期派生数据，不是布局数据。
//   因此用模块级 Map 存放，只在内存里活着，不落盘、不进 Zustand。
//
// 【为什么只剩原图路径】（2026-09-12 用户裁决：方案 A）
//   原方案存 thumbnailPath + originalPath 两个路径，缩略图显示、原图懒加载升级。
//   裁决「空间文件夹内不再生成缩略图」后，显示路径与原图路径合一：
//   CardAsset 简化为只存 originalPath，渲染与懒加载共用它。
//
// 【读取时机与响应性】
//   卡片渲染（core/registry/cardTypes.ts 的 renderImage）是 React 同步渲染过程，
//   直接调用这里的 getter 读快照。只要写入发生在 boardStore.set({ cards }) 之前，
//   渲染时读到的就是最新的 —— loadSpace 严格按「先算资源、再写 cards」的顺序执行。
//
// 实现任务：T1.4（阶段一）→ 2026-09-12 重构（方案 A）。
// ============================================================================

import type { Card } from '@/core/types'
import { joinPath } from '@/core/utils/paths'

export interface CardAsset {
  /** 原图绝对路径（渲染 src 与懒加载 data-original-url 共用） */
  originalPath: string
}

const assetsByCardId = new Map<string, CardAsset>()

/** 写入一张卡片的资源路径 */
export function setCardAsset(cardId: string, asset: CardAsset): void {
  assetsByCardId.set(cardId, asset)
}

/** 取一张卡片的资源路径；没有则返回 undefined */
export function getCardAsset(cardId: string): CardAsset | undefined {
  return assetsByCardId.get(cardId)
}

/** 原图绝对路径；缺失返回空串（渲染层据此退回占位样式） */
export function getCardOriginalPath(cardId: string): string {
  return assetsByCardId.get(cardId)?.originalPath ?? ''
}

/** 清空资源表。切空间 / 离开画布时必须调用，避免旧空间的路径残留 */
export function clearCardAssets(): void {
  assetsByCardId.clear()
}

/** 当前登记的卡片数量（调试 / 测试用） */
export function cardAssetCount(): number {
  return assetsByCardId.size
}

/**
 * 把一批卡片登记进资源表（原图绝对路径 = 空间文件夹 + 卡片相对路径）。
 *
 * @param cards     已生成的卡片数组（用 card.filePath 拼绝对路径）
 * @param spacePath 空间文件夹绝对路径
 */
export function registerCardAssets(cards: readonly Card[], spacePath: string): void {
  for (const card of cards) {
    if (card.type !== 'image') continue
    setCardAsset(card.id, {
      originalPath: joinPath(spacePath, card.filePath),
    })
  }
}
