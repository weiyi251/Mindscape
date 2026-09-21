// ============================================================================
// 模块说明（中文）
// mobileSpaces（移动端空间目录解析）的单元测试：纯路径拼接 + 依赖注入的薄胶水。
// ============================================================================

import { describe, expect, it, vi } from 'vitest'

import {
  UNNAMED_SPACE_DIR_NAME,
  buildMobileExportDir,
  buildMobileSpaceDir,
  resolveMobileExportDir,
  resolveMobileSpaceDir,
  spaceDirName,
} from './mobileSpaces'

describe('spaceDirName（空间名直接进路径，必须先洗）', () => {
  it('普通中文名原样保留', () => {
    expect(spaceDirName('项目A')).toBe('项目A')
  })

  it('路径分隔符换成下划线：一个空间名只会变成一个目录段', () => {
    expect(spaceDirName('a\\b/c')).toBe('a_b_c')
    // 段内的点不构成越界（没有分隔符就下不了目录），所以只换分隔符、不糟蹋 'v1.0' 这类名字
    expect(spaceDirName('../../etc')).toBe('_.._etc')
  })

  it('文件名字符（<>:"|?*）直接去掉（Windows 上这些做目录名会报错）', () => {
    expect(spaceDirName('a<b>:c|d?e*f"g')).toBe('abcdefg')
  })

  it('前导与尾随的点 / 空白洗掉：`.`、`..`、`.git` 都成不了目录名', () => {
    expect(spaceDirName('..')).toBe(UNNAMED_SPACE_DIR_NAME)
    expect(spaceDirName('.hidden ')).toBe('hidden')
    expect(spaceDirName('   ')).toBe(UNNAMED_SPACE_DIR_NAME)
  })

  it('超长空间名截到 60 段（Android 单段目录名有长度上限）', () => {
    expect(spaceDirName('长'.repeat(200))).toHaveLength(60)
  })
})

describe('buildMobileSpaceDir', () => {
  it('拼出 <dataDir>/Mindscape/spaces/<空间名>（Android 真机的目录形状，分隔符跟随 base）', () => {
    expect(buildMobileSpaceDir('/data/user/0/com.mindscape.canvas/files', '测试')).toBe(
      '/data/user/0/com.mindscape.canvas/files/Mindscape/spaces/测试',
    )
  })

  it('Windows 风格 dataDir 也能拼接（joinPath 归一分隔符）', () => {
    const dir = buildMobileSpaceDir('C:\\Users\\x\\AppData\\Roaming', '项目A')
    expect(dir).toContain('Mindscape')
    expect(dir).toContain('spaces')
  })

  it('空间名里的 `..` 与 `/` 只贡献**一个**目录段，不会多出层级（多出的层级就是逃逸 fs scope）', () => {
    const root = '/data/app/files/Mindscape/spaces'
    const dir = buildMobileSpaceDir('/data/app/files', '../../外部')

    expect(dir.startsWith(`${root}/`)).toBe(true)
    expect(dir.slice(root.length + 1).split('/')).toHaveLength(1)
  })
})

describe('buildMobileExportDir / resolveMobileExportDir（M4：移动端导出落点）', () => {
  it('导出目录与空间目录同一根、不同子目录（都在 $DATA/Mindscape/** 内）', () => {
    expect(buildMobileExportDir('/data/app/files', '测试')).toBe(
      '/data/app/files/Mindscape/exports/测试',
    )
    expect(buildMobileExportDir('/data/app/files', '测试')).not.toBe(
      buildMobileSpaceDir('/data/app/files', '测试'),
    )
  })

  it('解析时幂等创建目录并返回同一路径', async () => {
    const createDir = vi.fn(async () => {})
    const dir = await resolveMobileExportDir('测试', {
      dataDir: async () => '/data/data/app/files',
      createDir,
    })

    expect(createDir).toHaveBeenCalledWith('/data/data/app/files/Mindscape/exports/测试')
    expect(dir).toBe('/data/data/app/files/Mindscape/exports/测试')
  })
})

describe('resolveMobileSpaceDir', () => {
  it('解析后幂等创建目录并返回同一路径', async () => {
    const createDir = vi.fn(async () => {})
    const dir = await resolveMobileSpaceDir('测试', {
      dataDir: async () => '/data/data/app/files',
      createDir,
    })

    expect(createDir).toHaveBeenCalledTimes(1)
    expect(createDir).toHaveBeenCalledWith('/data/data/app/files/Mindscape/spaces/测试')
    expect(dir).toBe('/data/data/app/files/Mindscape/spaces/测试')
  })
})
