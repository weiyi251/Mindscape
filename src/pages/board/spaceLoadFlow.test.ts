// ============================================================================
// 模块说明（中文）
// 空间加载 / 重新扫描编排层的单元测试（A1，2026-09-20）。
//
// 覆盖：重新加载（含「修复过脏数据就补落盘」）、重新扫描（清标记 + 重新加载）、
//      签名基线的刷新（成功 / 读不到）、聚焦比对（一致 / 变动 / 不该检查的场景）。
//
// 直接操作真实 store（zustand 单例）而不 mock 它：这几个入口本就是「读 store 组依赖」，
// 用真 store 才能覆盖到接线本身；只有 loadSpace 这种会碰 Tauri 的方法才替换为假实现。
// 目录签名的真实行为由 Rust 侧测试覆盖（dir_signature.rs 8 例）。
// ============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

vi.mock('@/core/utils/runtime', () => ({
  isDesktopRuntime: () => true,
}))

import { useBoardStore } from '@/core/store/boardStore'
import { useSpacesStore } from '@/core/store/spacesStore'
import type { Space } from '@/core/types'

import {
  checkExternalChanges,
  refreshDirSignatureBaseline,
  reloadSpace,
  rescanCurrentSpace,
} from './spaceLoadFlow'

const SPACE: Space = {
  id: 'sp_001',
  name: '项目A',
  type: '项目',
  folderPath: 'D:\\Mindscape\\01_项目A',
  createdAt: '2026-09-10T11:00:00',
  lastOpenedAt: '2026-09-10T11:00:00',
  favorite: false,
  meta: {},
}

const SIGNATURE = { hash: 'aaa111', files: 3, dirs: 1 }

const originalLoadSpace = useBoardStore.getState().loadSpace

beforeEach(() => {
  invokeMock.mockReset()
  useSpacesStore.setState({ spaces: [SPACE], currentSpaceId: SPACE.id })
  useBoardStore.setState({
    loadSpace: originalLoadSpace,
    status: 'ready',
    readOnly: false,
    dirSignature: null,
    externalChange: null,
    needsMigration: false,
  })
})

describe('reloadSpace', () => {
  it('加载空间；修复过脏数据（needsMigration）时补一次立即落盘', async () => {
    const loadSpace = vi.fn(async () => {
      useBoardStore.setState({ needsMigration: true })
    })
    useBoardStore.setState({ loadSpace })
    const flush = vi.fn(async () => {})

    await reloadSpace(SPACE, { writer: { flush } })

    expect(loadSpace).toHaveBeenCalledWith(SPACE)
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('没有需要迁移的修复时不落盘（省一次无意义写盘）', async () => {
    useBoardStore.setState({ loadSpace: vi.fn(async () => {}) })
    const flush = vi.fn(async () => {})

    await reloadSpace(SPACE, { writer: { flush } })

    expect(flush).not.toHaveBeenCalled()
  })

  it('落盘失败：经 onError 报错，不向上抛（加载本身已完成）', async () => {
    useBoardStore.setState({
      loadSpace: vi.fn(async () => {
        useBoardStore.setState({ needsMigration: true })
      }),
    })
    const onError = vi.fn()

    await expect(
      reloadSpace(SPACE, {
        writer: {
          flush: async () => {
            throw new Error('磁盘只读')
          },
        },
        onError,
      }),
    ).resolves.toBeUndefined()

    expect(onError).toHaveBeenCalledWith('磁盘只读')
  })
})

describe('rescanCurrentSpace', () => {
  it('先落盘（防丢改动）→ 清「外部变动」标记 → 重新加载当前空间', async () => {
    const loadSpace = vi.fn(async () => {})
    useBoardStore.setState({ loadSpace, externalChange: { prevFiles: 3, files: 5 } })
    const flush = vi.fn(async () => {})

    const ok = await rescanCurrentSpace({ writer: { flush } })

    expect(ok).toBe(true)
    // 重新加载会用 layout 覆盖内存态，落盘必须发生在它之前
    expect(flush.mock.invocationCallOrder[0]).toBeLessThan(loadSpace.mock.invocationCallOrder[0])
    expect(loadSpace).toHaveBeenCalledWith(SPACE)
    expect(useBoardStore.getState().externalChange).toBeNull()
  })

  it('落盘失败不阻止重扫（不能让一次写盘错误把用户卡在旧画布上）', async () => {
    const loadSpace = vi.fn(async () => {})
    useBoardStore.setState({ loadSpace })
    const onError = vi.fn()

    const ok = await rescanCurrentSpace({
      writer: {
        flush: async () => {
          throw new Error('磁盘只读')
        },
      },
      onError,
    })

    expect(ok).toBe(true)
    expect(loadSpace).toHaveBeenCalledWith(SPACE)
  })

  it('没有当前空间：不加载、返回 false', async () => {
    useSpacesStore.setState({ currentSpaceId: null })
    const loadSpace = vi.fn(async () => {})
    useBoardStore.setState({ loadSpace })

    await expect(rescanCurrentSpace({ writer: { flush: vi.fn() } })).resolves.toBe(false)
    expect(loadSpace).not.toHaveBeenCalled()
  })
})

describe('refreshDirSignatureBaseline', () => {
  it('落盘成功后写入新基线', async () => {
    invokeMock.mockResolvedValue(SIGNATURE)

    await refreshDirSignatureBaseline()

    expect(invokeMock).toHaveBeenCalledWith('dir_signature', { path: SPACE.folderPath })
    expect(useBoardStore.getState().dirSignature).toEqual(SIGNATURE)
  })

  it('读不到（路径被删 / 异常）→ 基线置 null（宁可漏报也不误报）', async () => {
    invokeMock.mockRejectedValue('路径不存在：D:\\Mindscape\\01_项目A')
    useBoardStore.setState({ dirSignature: SIGNATURE })

    await refreshDirSignatureBaseline()

    expect(useBoardStore.getState().dirSignature).toBeNull()
  })

  it('未进入空间（状态不是 ready）时不读盘', async () => {
    useBoardStore.setState({ status: 'idle' })

    await refreshDirSignatureBaseline()

    expect(invokeMock).not.toHaveBeenCalled()
  })
})

describe('checkExternalChanges', () => {
  it('签名一致 → 无变动，标记为 null', async () => {
    useBoardStore.setState({ dirSignature: SIGNATURE, externalChange: { prevFiles: 1, files: 2 } })
    invokeMock.mockResolvedValue(SIGNATURE)

    await expect(checkExternalChanges()).resolves.toBe(false)
    expect(useBoardStore.getState().externalChange).toBeNull()
  })

  it('文件数变化 → 写入变动摘要并返回 true', async () => {
    useBoardStore.setState({ dirSignature: SIGNATURE })
    invokeMock.mockResolvedValue({ ...SIGNATURE, hash: 'bbb222', files: 5 })

    await expect(checkExternalChanges()).resolves.toBe(true)
    expect(useBoardStore.getState().externalChange).toEqual({ prevFiles: 3, files: 5 })
  })

  it('数量没变但内容变了（改名 / 覆盖）→ 同样报变动', async () => {
    useBoardStore.setState({ dirSignature: SIGNATURE })
    invokeMock.mockResolvedValue({ ...SIGNATURE, hash: 'changed' })

    await expect(checkExternalChanges()).resolves.toBe(true)
    expect(useBoardStore.getState().externalChange).toEqual({ prevFiles: 3, files: 3 })
  })

  it('只读模式 / 未进入空间：不读盘、不报变动', async () => {
    useBoardStore.setState({ readOnly: true, dirSignature: SIGNATURE })

    await expect(checkExternalChanges()).resolves.toBe(false)
    expect(invokeMock).not.toHaveBeenCalled()

    useBoardStore.setState({ readOnly: false, status: 'loading' })
    await expect(checkExternalChanges()).resolves.toBe(false)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('读盘失败静默（自动检查是后台行为，不打扰用户）', async () => {
    useBoardStore.setState({ dirSignature: SIGNATURE })
    invokeMock.mockRejectedValue('无权限访问')

    await expect(checkExternalChanges()).resolves.toBe(false)
    expect(useBoardStore.getState().externalChange).toBeNull()
  })
})
