// ============================================================================
// 模块说明（中文）
// 移动端「导入文件」按钮（2026-09-21 移动端适配 M4，对应
// docs/移动端适配计划.md §3 M4「文件选择器替代拖入」的渲染层）。
//
// 只做一件事：把一个隐藏的 `<input type=file multiple>` 挂在一个纯图标按钮上，
// 用户点按钮 → 系统选择器 → 选中的文件原样交给 onFiles。
// 字节读取、落盘、建卡、撤销与文案全在 importFilesFlow.ts（本文件只导出组件，
// 否则 react-refresh 会警告），这里不做任何业务判断，
// 因此**桌面也不该渲染它**（拖入更好用）—— 由调用方按能力表 `dragAndDropImport` 决定显隐。
//
// 为什么用 input 而不是 Tauri 的 dialog 插件：dialog 的文件夹/文件选择器在移动端
// 直接报「not implemented on mobile」，而 `<input type=file>` 是 Android 系统选择器
// （SAF）的既有通道，拿到的是内容字节 —— 恰好是 content:// 路径唯一可用的形态。
// ============================================================================

import { useRef } from 'react'
import type { ChangeEvent } from 'react'

import { Button } from '@/components/ui/button'
import { ImportIcon } from '@/components/ui/icons'

import { IMPORT_FILE_ACCEPT, IMPORT_FILES_TEXT, pickedFilesFrom } from './importFilesFlow'
import type { PickedFile } from './ingestFlow'

export interface ImportFilesButtonProps {
  onFiles: (files: PickedFile[]) => void | Promise<void>
  /** 悬停提示（默认「从本机选择文件加入当前空间」；空间列表页复用时换成自己的话） */
  title?: string
  /** 读屏文案（aria-label，同时也是按钮的唯一语义来源——它是纯图标按钮） */
  label?: string
  /** 选择器的 accept（默认图片优先 + 全部兜底；导入布局文件时只要 .json） */
  accept?: string
  /** 是否多选（导入布局文件只需要一份） */
  multiple?: boolean
}

/**
 * 移动端「选文件」按钮。默认参数是画布页的「导入文件」场景；
 * 空间列表页的「导入空间」（选一个 mindscape-layout.json）复用同一个通道，只换文案与 accept，
 * 免得两处各写一遍隐藏 input 的坑（连选同一份文件要重置 value）。
 */
export function ImportFilesButton({
  onFiles,
  title = IMPORT_FILES_TEXT.title,
  label = IMPORT_FILES_TEXT.label,
  accept = IMPORT_FILE_ACCEPT,
  multiple = true,
}: ImportFilesButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = pickedFilesFrom(event.target.files)
    // 不重置 value：连选同一份文件时 change 不会再触发（用户以为按钮坏了）
    event.target.value = ''
    if (files.length > 0) void onFiles(files)
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        accept={accept}
        className="hidden"
        data-import-files=""
        onChange={handleChange}
      />
      <Button
        variant="outline"
        size="icon"
        className="shrink-0"
        title={title}
        aria-label={label}
        onClick={() => inputRef.current?.click()}
      >
        <ImportIcon />
      </Button>
    </>
  )
}
