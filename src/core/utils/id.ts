// ============================================================================
// 模块说明（中文）
// 实体 id 生成。4.1 的空间 id 示例为 `sp_001`，卡片 id 沿用同风格的 `c_001`。
//
// 采用「按现有最大序号 +1」而不是随机串，原因：
//   · 与文档示例一致，人工看数据时直观（sp_001 / sp_002 …）
//   · layout.json 与 spaces.json 里的 id 可读，便于排错
// 代价：删除后 id 不复用（序号只增不减），这符合直觉。
//
// 纯函数，可单元测试。
//
// 实现任务：T1.1（阶段一）。
// ============================================================================

/** 从一组已有 id 中推导下一个可用 id */
function nextId(prefix: string, existing: string[], width: number): string {
  const pattern = new RegExp(`^${prefix}(\\d+)$`)
  let max = 0
  for (const id of existing) {
    const matched = pattern.exec(id)
    if (matched) max = Math.max(max, Number(matched[1]))
  }
  return `${prefix}${String(max + 1).padStart(width, '0')}`
}

/** 下一个空间 id，如 sp_001 */
export function nextSpaceId(existingSpaceIds: string[]): string {
  return nextId('sp_', existingSpaceIds, 3)
}

/** 下一张卡片 id，如 c_001 */
export function nextCardId(existingCardIds: string[]): string {
  return nextId('c_', existingCardIds, 3)
}

/** 下一个分区框 id，如 p_001 */
export function nextPartitionId(existingPartitionIds: string[]): string {
  return nextId('p_', existingPartitionIds, 3)
}

/** 下一条连线 id，如 conn_001（T3.1） */
export function nextConnectionId(existingConnectionIds: string[]): string {
  return nextId('conn_', existingConnectionIds, 3)
}

/** 为重复 id 生成新 id：沿用原 id 的前缀与位宽，在同类前缀的最大序号 +1 */
function freshIdAfter(id: string, used: Set<string>): string {
  const matched = /^(\D+)(\d+)$/.exec(id)
  const prefix = matched ? matched[1] : id
  const width = matched ? matched[2].length : 3
  return nextId(prefix, [...used], width)
}

/**
 * 实体 id 去重：按数组顺序保留首次出现的 id，后续重复项重新编号。
 *
 * 背景：历史版本 loadSpace 的每批目录扫描各自从 c_001 重新计数，导致落盘的
 * layout.json 里卡片 / removed 记录 id 大面积撞号 —— 按 id 的操作（置顶/置底、
 * 选中、恢复记录匹配）会命中「同号的所有实体」而失准。加载时跑一遍本函数
 * 即可把存量损坏数据修复到一致状态（幂等，去重后再次加载不再变化）。
 */
export function dedupeIds<T extends { id: string }>(items: readonly T[]): T[] {
  const used = new Set<string>()
  return items.map((item) => {
    if (!used.has(item.id)) {
      used.add(item.id)
      return item
    }
    const id = freshIdAfter(item.id, used)
    used.add(id)
    return { ...item, id }
  })
}
