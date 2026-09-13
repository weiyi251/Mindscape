// ============================================================================
// 模块说明（中文）
// 时间格式化工具。
//
// 4.1 示例里的时间戳形如 `2026-09-10T11:00:00` —— 本地时间、秒级、无时区后缀。
// 本模块统一产出这种格式，避免各处的 toISOString()（UTC + 毫秒）写出不一致的字符串。
//
// 实现任务：T1.1（阶段一）。
// ============================================================================

/**
 * 补零到两位（`5` → `"05"`）。
 * 导出供其他需要拼时间戳的文件复用（如 `core/board/ingest.ts` 的粘贴文件名）；
 * 2026-09-14 前它在 time.ts 与 ingest.ts 各有一份完全相同的私有实现。
 */
export function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * 当前本地时间，格式 `YYYY-MM-DDTHH:mm:ss`（对应 4.1 示例）。
 * 刻意不用 toISOString()：那是 UTC 且带毫秒与 Z 后缀，与文档示例不一致。
 */
export function nowIsoSeconds(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = pad2(date.getMonth() + 1)
  const d = pad2(date.getDate())
  const hh = pad2(date.getHours())
  const mm = pad2(date.getMinutes())
  const ss = pad2(date.getSeconds())
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}`
}
