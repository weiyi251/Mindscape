// ============================================================================
// 模块说明（中文）
// 路径拼接单元测试。对应 17.5「拼接逻辑放前端」。
//
// 实现任务：T1.3（阶段一）。
// ============================================================================

import { describe, it, expect } from 'vitest'

import { basenameOf, dirnameOf, joinPath } from '@/core/utils/paths'

describe('joinPath', () => {
  it('Windows 风格：用反斜杠拼', () => {
    expect(joinPath('D:\\Mindscape\\01_项目A', 'ref-01.jpg')).toBe(
      'D:\\Mindscape\\01_项目A\\ref-01.jpg',
    )
  })

  it('基准目录末尾已有分隔符时不重复', () => {
    expect(joinPath('D:\\Mindscape\\', 'ref-01.jpg')).toBe('D:\\Mindscape\\ref-01.jpg')
    expect(joinPath('D:\\Mindscape///', 'ref-01.jpg')).toBe('D:\\Mindscape\\ref-01.jpg')
  })

  it('相对路径前导分隔符会被去掉', () => {
    expect(joinPath('D:\\a', '\\b.jpg')).toBe('D:\\a\\b.jpg')
  })

  it('POSIX 风格：用斜杠拼', () => {
    expect(joinPath('/home/me/space', 'a/b.png')).toBe('/home/me/space/a/b.png')
  })

  it('相对路径内部的分隔符统一成基准目录的风格', () => {
    expect(joinPath('D:\\a', 'b/c.jpg')).toBe('D:\\a\\b\\c.jpg')
    expect(joinPath('/a', 'b\\c.jpg')).toBe('/a/b/c.jpg')
  })

  it('空基准 / 空相对路径的边界', () => {
    expect(joinPath('', 'b.jpg')).toBe('b.jpg')
    expect(joinPath('D:\\a', '')).toBe('D:\\a')
  })

  it('中文路径不受影响', () => {
    expect(joinPath('D:\\脑海空间\\01_项目A', '参考资料/香樟 01.jpg')).toBe(
      'D:\\脑海空间\\01_项目A\\参考资料\\香樟 01.jpg',
    )
  })
})

describe('dirnameOf / basenameOf', () => {
  it('拆分 Windows 路径', () => {
    expect(dirnameOf('D:\\a\\b.jpg')).toBe('D:\\a')
    expect(basenameOf('D:\\a\\b.jpg')).toBe('b.jpg')
  })

  it('拆分 POSIX 路径', () => {
    expect(dirnameOf('/a/b.jpg')).toBe('/a')
    expect(basenameOf('/a/b.jpg')).toBe('b.jpg')
  })

  it('末尾分隔符被忽略（目录也能取到名字）', () => {
    expect(basenameOf('D:\\a\\参考资料\\')).toBe('参考资料')
    expect(dirnameOf('D:\\a\\参考资料\\')).toBe('D:\\a')
  })

  it('没有分隔符时 basename 是自身、dirname 为空', () => {
    expect(basenameOf('b.jpg')).toBe('b.jpg')
    expect(dirnameOf('b.jpg')).toBe('')
  })
})
