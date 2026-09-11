// ============================================================================
// 模块说明（中文）
// 时间格式化单元测试。对应 4.1 示例的时间戳格式 `2026-09-10T11:00:00`。
//
// 实现任务：T1.1（阶段一）。
// ============================================================================

import { describe, it, expect } from 'vitest'

import { nowIsoSeconds } from '@/core/utils/time'

describe('nowIsoSeconds', () => {
  it('输出 4.1 示例的格式（秒级、本地时间、无 Z 后缀）', () => {
    const date = new Date(2026, 8, 10, 11, 0, 0) // 月份从 0 开始：8 = 9 月
    expect(nowIsoSeconds(date)).toBe('2026-09-10T11:00:00')
  })

  it('月 / 日 / 时 / 分 / 秒都补零', () => {
    const date = new Date(2026, 0, 5, 3, 7, 9)
    expect(nowIsoSeconds(date)).toBe('2026-01-05T03:07:09')
  })

  it('不含毫秒与时区后缀', () => {
    const value = nowIsoSeconds(new Date(2026, 11, 31, 23, 59, 59))
    expect(value).not.toContain('.')
    expect(value).not.toContain('Z')
    expect(value).toHaveLength(19)
  })

  it('可被 zSpaceSchema 的时间字段接受（纯字符串，规则一致）', () => {
    expect(typeof nowIsoSeconds()).toBe('string')
  })
})
