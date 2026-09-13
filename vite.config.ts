import { fileURLToPath, URL } from 'node:url'
// 从 vitest/config 引入 defineConfig：与 Vite 的 defineConfig 兼容，且额外提供 test 字段类型
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import process from 'node:process'

const host = process.env.TAURI_DEV_HOST

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],

  resolve: {
    alias: {
      // 与 tsconfig.json 的 paths 保持一致，供 shadcn/ui 组件引用
      '@': fileURLToPath(new URL('./src', import.meta.url)),
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
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
}))
