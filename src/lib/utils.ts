/**
 * shadcn/ui 标准工具函数集合。
 * cn()：合并 className（clsx 处理条件类名 + tailwind-merge 消解冲突类）。
 * 该模块由 shadcn/ui 生成物统一引用，路径取自 components.json 的 aliases.utils。
 */
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
