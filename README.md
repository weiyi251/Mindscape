# Mindscape / 脑海空间

> **把你当前的项目文件、思路想法铺成一张可自由摆放、连线、迭代的思考空间 —— 数据始终是你自己的文件。**

Mindscape 是一个本地桌面画布。它不新建白板，而是**把一个已有的文件夹，变成白板**。

| | 现有工具（Miro / Milanote / Obsidian Canvas…） | Mindscape |
|---|---|---|
| 起点 | 新建一块白板，再往里塞东西 | **选一个已有文件夹，自动铺成画布** |
| 文件位置 | 上传到它的云 | **文件始终在你自己的硬盘** |
| 数据归属 | 存在它的数据库，换工具搬不走 | **数据就是你的普通文件，随时可迁移** |

## 三条铁律

1. **文件夹是真相，画布是视图** —— 软件挂了、卸载了，硬盘上的文件一个不少
2. **不搬家** —— 文件始终在你选定的文件夹里，产品不主动挪动它们
3. **不静默删除** —— 不提供「永久删除」，只提供「移出到 `_已移除`」

> 这是一个**思路整理工具**，不是图片管理器。你贴一张参考图，不是因为它是一张图，而是因为它代表了你的一个想法。

## 当前状态

**第一版预览版（Preview v1.0）· 开发中。**

| 阶段 | 内容 | 状态 |
|---|---|---|
| 准备层 T0.1 ~ T0.12 | 脚手架、数据 Schema、存储层接口、命令系统、插件注册中心、交互底座 | 🚧 进行中 |
| 阶段一 T1.1 ~ T1.7 | 空间列表页、读文件夹铺画布、平移缩放 | ⬜ 未开始 |
| 阶段二 T2.1 ~ T2.11 | 卡片拖拽缩放、对齐吸附、分区框、移除/恢复、撤销重做 | ⬜ 未开始 |
| 阶段三 T3.1 ~ T3.10 | 连线、备注、便签卡、文件卡片、拖入/粘贴 | ⬜ 未开始 |

> 截图待阶段一交付后补充。

## 技术栈

| 层 | 选型 |
|---|---|
| 桌面框架 | Tauri v2（复用系统 WebView2，安装包 5–10 MB） |
| 前端 | React 18 + TypeScript 5 + Vite 5 |
| UI | Tailwind CSS 3 + shadcn/ui |
| 画布渲染 | DOM 方案（卡片是 div，不是 Canvas） |
| 状态管理 | Zustand 4 |
| 后端 | Rust（Tauri 自带） |

## 环境要求

- Node.js ≥ 20 LTS
- pnpm ≥ 9
- Rust ≥ 1.75 stable（Windows 目标 `x86_64-pc-windows-msvc`）
- Windows 上的 MSVC 构建工具（Visual Studio Build Tools 的「使用 C++ 的桌面开发」工作负载）
- WebView2 运行时（Windows 10/11 已内置）

## 开发

```bash
pnpm install          # 安装依赖
pnpm tauri dev        # 启动桌面应用（开发模式）
pnpm build            # 类型检查 + 前端构建
pnpm test             # 单元测试（Vitest）
pnpm lint             # ESLint
pnpm format           # Prettier 格式化
```

仅启动前端（浏览器里预览，不含 Tauri 能力）：

```bash
pnpm dev              # http://localhost:1420
```

## 目录结构

```
src/
├── core/           # 核心，不依赖任何插件
│   ├── types.ts            # 数据 Schema
│   ├── registry/           # 卡片类型 / 菜单 / 工具栏 / 插件注册中心
│   ├── commands/           # 操作命令 + 撤销重做栈
│   ├── storage/            # 存储层接口与本地实现
│   └── hooks/              # 生命周期钩子
├── canvas/         # 画布渲染与交互（Viewport / Card / Partition / Connection …）
├── pages/          # 空间列表页 / 画布页
├── components/ui/  # shadcn/ui 生成物
├── plugins/        # 插件目录（第一版仅占位）
└── styles/         # 全局样式与主题变量

src-tauri/src/commands/   # Rust 端命令：fs_ops / layout / thumbnail / system
```

## 数据存放位置

| 数据 | 位置 |
|---|---|
| 空间列表 | `%APPDATA%\Mindscape\spaces.json` |
| 画布布局 | `<空间文件夹>\.mindscape\layout.json` |
| 缩略图缓存 | `<空间文件夹>\.mindscape\thumbnails\` |
| 被移除的文件 | `<空间文件夹>\_已移除\`（**不是删除，只是移出**） |

> 布局跟着文件夹走 —— 把项目文件夹拷给别人，卡片摆放和连线一起过去。

## 许可证

[MIT](LICENSE)
