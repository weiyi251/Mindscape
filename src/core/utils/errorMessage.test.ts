// ============================================================================
// 模块说明（中文）
// core/utils/errorMessage.ts 的单元测试。
//
// 重点覆盖「两份旧实现漂移」的那一步：LocalFolderProvider 先判 string，
// updater 没有 —— 统一后裸字符串（Rust 侧返回的中文消息）必须原样透传，
// 不能被 String() 包成别的样子。
// ============================================================================

import { describe, expect, it } from 'vitest'

import { toErrorMessage } from './errorMessage'

describe('toErrorMessage', () => {
  it('裸字符串原样返回（Rust 命令返回的中文消息走这条）', () => {
    expect(toErrorMessage('目标文件夹不存在')).toBe('目标文件夹不存在')
  })

  it('Error 取 message', () => {
    expect(toErrorMessage(new Error('boom'))).toBe('boom')
  })

  it('TypeError 等子类同样取 message', () => {
    expect(toErrorMessage(new TypeError('x is not a function'))).toBe('x is not a function')
  })

  it('其余值走 String() 兜底', () => {
    expect(toErrorMessage(404)).toBe('404')
    expect(toErrorMessage(null)).toBe('null')
    expect(toErrorMessage(undefined)).toBe('undefined')
    expect(toErrorMessage({ code: 'E_NOENT' })).toBe('[object Object]')
  })

  it('对真实错误形态永不抛错（catch 块里可安全当最后一道归一化）', () => {
    for (const value of ['文本', new Error('e'), 1, null, undefined, {}, []]) {
      expect(() => toErrorMessage(value)).not.toThrow()
    }
  })
})
