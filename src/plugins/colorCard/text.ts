// ============================================================================
// 模块说明（中文）
// 色卡插件的中文文案常量表。
//
// 为什么单独成文件：与 core/plugin/pluginText.ts、components/ui/settingsText.ts 同理 ——
// 界面文案集中一处便于校对，且组件文件只导出组件（react-refresh 规则）。
//
// ⚠️ 本文件**不 import 任何模块**（连类型都不 import）。这样 options.ts 可以放心
//    import 它，而它永远不会反向依赖 options.ts，从根上避免循环依赖（守卫规则 5）。
//
// ⚠️ 文案里刻意不出现任何十六进制色值字面量（如 #5A7D6A）——
//    守卫规则 3 会把 hex 当作硬编码配色，本文件不是数据而是文案，不该进豁免清单。
// ============================================================================

export const COLOR_CARD_TEXT = {
  /* 插件元信息 */
  pluginName: '色卡',
  pluginDescription: '按自定义颜色与尺寸生成色卡 PNG 图片，并保存到指定文件夹。',
  pluginAuthor: 'Mindscape',

  /* 入口与标题 */
  menuLabel: '新建色卡…',
  dialogTitle: '新建色卡',

  /* 颜色区 */
  colorSection: '颜色',
  colorPresetsLabel: '常用色',
  colorHexLabel: '色值',
  colorHexPlaceholder: '例如 #RRGGBB',
  colorPickerLabel: '打开系统取色器',
  colorPreviewLabel: '预览',

  /* 尺寸区 */
  sizeSection: '尺寸',
  sizePresetsLabel: '常用尺寸',
  ratioPresetsLabel: '常用比例',
  longEdgePresetsLabel: '长边像素',
  longEdgeTitle: (pixels: number) => `长边 ${pixels} 像素（短边按当前比例折算）`,
  widthLabel: '宽',
  heightLabel: '高',
  sizeUnit: '像素',
  sizeHint: (min: number, max: number) => `可填 ${min} ~ ${max}，填入超范围的值会自动收敛。`,
  // ⚠️ 这里曾有 showHexLabel / showHexHint 两条（「在色卡图片上标注色值」开关）。
  //    2026-09-14 用户要求「确保色块内部不再展示任何色号文本或标签」→ 开关与整条
  //    绘制链路已删除，改为下面这条说明，让用户知道色号去哪看了（而不是静默消失）。
  hoverHexHint: '色号不画在图片里；在画布上把鼠标移到这张色卡上即可看到。',

  /* 输出区 */
  outputSection: '输出',
  outputDirLabel: '输出文件夹',
  outputDirEmpty: '（未选择）',
  pickDirLabel: '选择文件夹…',
  pickDirTitle: '选择色卡输出文件夹',
  namePrefixLabel: '文件名前缀',
  fileNamePreview: (name: string) => `将保存为：${name}`,
  addToCanvasLabel: '同时在画布上添加卡片',
  addToCanvasHint: '输出文件夹在空间内时才会建卡；不在空间内则只写文件。',

  /* 操作按钮 */
  save: '生成并保存',
  saving: '正在生成…',
  close: '关闭',

  /* 校验与失败（中文，可直接展示） */
  invalidColor: '色值格式不正确，请填写 6 位十六进制色值（形如 #RRGGBB）。',
  invalidSize: (min: number, max: number) => `尺寸需在 ${min} ~ ${max} 像素之间。`,
  missingOutputDir: '请先选择输出文件夹。',
  renderFailed: '无法创建画布 2D 上下文，色卡生成失败。',
  encodeFailed: '色卡图片编码失败，请重试。',
  saveFailed: (reason: string) => `生成失败：${reason}`,

  /* 成功 */
  savedTo: (path: string) => `已保存：${path}`,
  addedToCanvas: '已在画布上添加卡片。',

  /* 画布加卡被跳过时的原因（都说明「文件已经写好了」） */
  skipNoBridge: '画布尚未就绪，本次只在硬盘上生成了文件。',
  skipNoSpace: '当前没有打开的空间，本次只在硬盘上生成了文件。',
  skipOutsideSpace: '输出文件夹不在当前空间内，本次只在硬盘上生成了文件。',
  skipRejected: '画布拒绝了建卡请求，本次只在硬盘上生成了文件。',
} as const

/**
 * 色板预设的中文标签（键 = options.ts 里预设的 id）。
 * 拆成独立常量而不是塞进上面的对象：`as const` 会把嵌套值收窄成字面量类型，
 * 加一条 `Record<string, string>` 断言又要破坏 as const 的收益，分开更省事。
 * options.test.ts 会断言「每个预设 id 都有标签」，防止加预设时漏文案。
 */
export const COLOR_PRESET_LABELS: Record<string, string> = {
  graphite: '石墨灰',
  moss: '苔绿',
  clay: '陶土',
  amber: '琥珀',
  indigo: '靛青',
  rose: '绛红',
  sky: '天青',
  ivory: '米白',
}

/** 尺寸预设的中文标签（键 = options.ts 里预设的 id） */
export const SIZE_PRESET_LABELS: Record<string, string> = {
  'square-200': '方形 200',
  'square-400': '方形 400',
  'square-800': '方形 800',
  'card-600x400': '卡片 600×400',
  'banner-1200x300': '横幅 1200×300',
}

/**
 * 比例预设的中文标签（键 = options.ts 里 COLOR_CARD_RATIO_PRESETS 的 id）。
 * 比例本身没有像素，具体尺寸由「长边像素」一起决定（见 options.sizeForRatio）。
 */
export const RATIO_PRESET_LABELS: Record<string, string> = {
  'ratio-1-1': '1:1',
  'ratio-16-9': '16:9',
  'ratio-9-16': '9:16',
}
