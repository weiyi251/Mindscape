// ============================================================================
// 模块说明（中文）
// 文件类型判定。对应开发计划书 8.3「支持的文件类型」与第九章「非图片文件处理」：
//
//   图片（jpg / png / webp / gif / bmp）→ 图片卡片
//   其他（pdf / psd / dwg / skp / mp4 …）→ 文件卡片
//
// ⚠️ 只按扩展名判定，不读文件头。理由：list_dir 一次返回整层文件，
//    逐个读文件头会让 50 张图的首屏多出 50 次 IO（T1.7 要求 ≤3s）。
//    扩展名不符的极少数情况，表现为「缩略图生成失败」，卡片仍会以文件卡片形式显示。
//
// 纯函数，可单元测试。
//
// 实现任务：T1.3（阶段一）。
// ============================================================================

/** 8.3 明确列出的图片扩展名（小写，不含点） */
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] as const

/** 取小写扩展名；无扩展名返回空串 */
export function getExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0) return ''
  return fileName.slice(dot + 1).toLowerCase()
}

/** 是否为支持的图片文件 */
export function isImageFile(fileName: string): boolean {
  return (IMAGE_EXTENSIONS as readonly string[]).includes(getExtension(fileName))
}

/**
 * 该文件应使用哪种卡片类型。
 * 返回 core/types.ts 里 CORE_CARD_TYPES 的取值之一，供 cardTypes 注册表查表。
 */
export function cardTypeFor(fileName: string): 'image' | 'file' {
  return isImageFile(fileName) ? 'image' : 'file'
}
