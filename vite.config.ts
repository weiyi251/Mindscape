import { fileURLToPath, URL } from 'node:url'
import { realpathSync } from 'node:fs'
// 从 vitest/config 引入 defineConfig：与 Vite 的 defineConfig 兼容，且额外提供 test 字段类型
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import process from 'node:process'

const host = process.env.TAURI_DEV_HOST

/**
 * `@` 别名指向 src。
 *
 * ⚠️ 为什么必须 realpathSync.native（磁盘真实大小写）：
 * Windows 下「vite 对部分模块做 realpath（得磁盘真实大小写 E:/…）」与
 * 「另一部分模块直接使用 alias 字符串（可能是 e:/…）」会产生**两种模块 id**；
 * vite-node 的模块缓存按 id 字符串区分 —— 同一文件被执行两次，模块级单例
 * （boardStore 等）直接变双例（2026-09-17 实测：B1 !== refA，执行日志两次）。
 * 把 alias 本身归一化到磁盘真实大小写后，做不做 realpath 结果都一致，单例恢复。
 * （本机磁盘目录真实为大写 E:\Mindscape，而 shell cwd 可能是小写 e:\Mindscape。）
 */
function srcAliasPath(): string {
  const raw = fileURLToPath(new URL('./src', import.meta.url))
  try {
    return realpathSync.native(raw)
  } catch {
    // 目录不存在（极端情况）就原样返回，保持旧行为
    return raw
  }
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],

  resolve: {
    alias: {
      // 与 tsconfig.json 的 paths 保持一致，供 shadcn/ui 组件引用
      '@': srcAliasPath(),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    // 开发服务必须双栈监听（2026-09-13 白屏排查）：默认 `false` 让 Node 只解析到
    // 单个地址（本机实测只绑 [::1]），而 WebView2 可能先连 127.0.0.1 ——
    // 两条 SYN 打不通 → 窗口白屏。'::' 在 Windows 上是双栈套接字（Node 默认
    // ipv6Only=false），IPv4 / IPv6 两种解析都能连上，消除随机性。
    // TAURI_DEV_HOST（移动端调试）优先，保持原行为
    host: host || '::',
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**'],
    },
  },

  // 单元测试（Vitest）：仅覆盖纯逻辑模块，不需要 DOM 环境
  test: {
    environment: 'node',
    // scripts/ 那一份是构建脚本里的纯逻辑（安卓架构映射、任务名、版本号）——
    // 真跑一次几十分钟，能在编译期判的字符串就别交给机器等
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'scripts/**/*.test.mjs'],
    // ⚠️ 必须串行执行测试文件（2026-10-01 实测）：并发收集时本机沙箱的文件代理
    // （node-brokered-fs-shim）在高并发下会拖垮 worker —— collect 阶段从 8s 涨到
    // 57s、抛 EPERM 未处理错误（exit=1），最坏情况是**静默丢弃个别测试文件**
    // （architecture.test.ts 整文件 14 例消失，但报告仍显示全 passed），门禁假绿。
    // 串行后 149 文件 1731 例全过、exit=0、全量约 63s，可接受。
    fileParallelism: false,
  },
}))
