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
// 自动更新（不在 17 章原范围，经用户批准后引入）：
//   · 启动后**静默**检查一次 —— 只在「发现新版本」时弹窗，已是最新或检查失败都不打扰；
//   · UpdateDialog 挂在这一层，因此空间列表页与画布页都能看到提示；
//   · 手动入口见 pages/SpaceList.tsx 顶栏的「检查更新」。
//
// 实现任务：T1.1 / T1.2（阶段一）；自动更新为 2026-09-12 追加。
// ============================================================================

import { useEffect } from 'react'

import { Board } from '@/pages/Board'
import { DesktopRequired } from '@/pages/DesktopRequired'
import { SpaceList } from '@/pages/SpaceList'
import { UpdateDialog } from '@/components/ui/update-dialog'
import { isDesktopRuntime } from '@/core/utils/runtime'
import { useSpacesStore } from '@/core/store/spacesStore'
import { useUpdaterStore } from '@/core/store/updaterStore'

/**
 * 启动后延迟多久再发起更新检查。
 * 不放在挂载瞬间：WebView 刚起来时首屏渲染、读 spaces.json、读文件夹三件事挤在一起，
 * 检查更新要走网络，让开这一小段时间避免争抢。
 */
const STARTUP_UPDATE_CHECK_DELAY_MS = 1500

export default function App() {
  const load = useSpacesStore((state) => state.load)
  const currentSpaceId = useSpacesStore((state) => state.currentSpaceId)
  const desktop = isDesktopRuntime()

  // 启动时加载一次；load 是 store 上的稳定引用，不会重复触发
  useEffect(() => {
    if (!desktop) return
    void load()
  }, [load, desktop])

  // 启动静默检查更新。走 getState() 而非订阅，避免把更新状态引进本组件的渲染依赖
  useEffect(() => {
    if (!desktop) return
    const timer = window.setTimeout(() => {
      void useUpdaterStore.getState().check({ silent: true })
    }, STARTUP_UPDATE_CHECK_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [desktop])

  if (!desktop) return <DesktopRequired />

  return (
    <>
      {currentSpaceId ? <Board /> : <SpaceList />}
      <UpdateDialog />
    </>
  )
}
