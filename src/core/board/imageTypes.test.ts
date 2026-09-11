// ============================================================================
// 模块说明（中文）
// 文件类型判定单元测试。对应 8.3「支持的文件类型」。
//
// 实现任务：T1.3（阶段一）。
// ============================================================================

import { describe, it, expect } from 'vitest'

import { IMAGE_EXTENSIONS, cardTypeFor, getExtension, isImageFile } from '@/core/board/imageTypes'

describe('getExtension', () => {
  it('取小写扩展名', () => {
    expect(getExtension('a.jpg')).toBe('jpg')
    expect(getExtension('a.JPG')).toBe('jpg')
    expect(getExtension('参考图.PnG')).toBe('png')
  })

  it('多点文件名取最后一段', () => {
    expect(getExtension('archive.tar.gz')).toBe('gz')
    expect(getExtension('v1.2.final.webp')).toBe('webp')
  })

  it('无扩展名 / 隐藏文件返回空串', () => {
    expect(getExtension('README')).toBe('')
    expect(getExtension('.gitignore')).toBe('')
    expect(getExtension('')).toBe('')
  })
})

describe('isImageFile', () => {
  it('8.3 列出的图片格式全部识别', () => {
    expect(IMAGE_EXTENSIONS).toEqual(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'])
    for (const ext of IMAGE_EXTENSIONS) {
      expect(isImageFile(`photo.${ext}`)).toBe(true)
      expect(isImageFile(`photo.${ext.toUpperCase()}`)).toBe(true)
    }
  })

  it('非图片文件不误判（对应第九章的分流）', () => {
    for (const name of ['总平面.pdf', '模型.skp', '图纸.dwg', '源文件.psd', '片段.mp4', '说明.txt']) {
      expect(isImageFile(name)).toBe(false)
    }
  })

  it('中文名与空格名同样正确处理', () => {
    expect(isImageFile('杭州植物园 香樟 01.jpg')).toBe(true)
    expect(isImageFile('说明 文档.pdf')).toBe(false)
  })
})

describe('cardTypeFor', () => {
  it('图片 → image，其余 → file', () => {
    expect(cardTypeFor('a.png')).toBe('image')
    expect(cardTypeFor('a.pdf')).toBe('file')
    expect(cardTypeFor('无扩展名')).toBe('file')
  })
})
