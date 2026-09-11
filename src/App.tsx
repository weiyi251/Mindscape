// ============================================================================
// 模块说明（中文）
// 应用根组件 —— 页面切换容器。对应 T1.1 / T1.2：
//   · 启动时读 %APPDATA%\Mindscape\spaces.json 恢复空间列表
//   · currentSpaceId 为 null → 空间列表页；否则 → 画布页
//
// 路由状态放在 spacesStore 里（而非 useState），因为「进入空间」这个动作
// 同时要更新 lastOpenedAt 并落盘，逻辑天然属于 store。
//
// ⚠️ 非桌面环境（浏览器打开了 dev 地址）直接渲染提示页，并且**不去读 spaces.json**：
//    没有 Rust 后端时任何本地文件操作都只会抛错。
//
// 实现任务：T1.1 / T1.2（阶段一）。
// ============================================================================

import { useEffect } from 'react'

import { Board } from '@/pages/Board'
import { DesktopRequired } from '@/pages/DesktopRequired'
import { SpaceList } from '@/pages/SpaceList'
import { isDesktopRuntime } from '@/core/runtime'
import { useSpacesStore } from '@/core/store/spacesStore'

export default function App() {
  const load = useSpacesStore((state) => state.load)
  const currentSpaceId = useSpacesStore((state) => state.currentSpaceId)
  const desktop = isDesktopRuntime()

  // 启动时加载一次；load 是 store 上的稳定引用，不会重复触发
  useEffect(() => {
    if (!desktop) return
    void load()
  }, [load, desktop])

  if (!desktop) return <DesktopRequired />

  return currentSpaceId ? <Board /> : <SpaceList />
}
