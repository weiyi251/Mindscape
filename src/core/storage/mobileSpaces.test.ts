// ============================================================================
// 模块说明（中文）
// mobileSpaces（移动端空间目录解析）的单元测试：纯路径拼接 + 依赖注入的薄胶水。
// ============================================================================

import { describe, expect, it, vi } from 'vitest'

import { buildMobileSpaceDir, resolveMobileSpaceDir } from './mobileSpaces'

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
