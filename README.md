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

**第一版预览版（Preview v1.0，内部版本号 `0.1.0`）· 功能开发完成，进入整体验收与打包。**

| 阶段 | 内容 | 状态 |
|---|---|---|
| 准备层 T0.1 ~ T0.12 | 脚手架、数据 Schema、存储层接口、命令系统、插件注册中心、交互底座 | ✅ 已完成 |
| 阶段一 T1.1 ~ T1.7 | 空间列表页、读文件夹铺画布、平移缩放 | ✅ 已完成 |
| 阶段二 T2.1 ~ T2.11 | 卡片拖拽缩放、对齐吸附、分区框、移除/恢复、撤销重做 | ✅ 已完成 |
| 阶段三 T3.1 ~ T3.10 | 连线、备注、便签卡、文件卡片、拖入/粘贴 | ✅ 已完成 |

计划书范围内的工单（T0 ~ T3）已全部落地，当前处于整体验收与打包阶段。

### 验证基线

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `pnpm typecheck` | 无错误 |
| 单元测试 | `pnpm test` | 551 passed / 48 个测试文件 |
| Rust 单元测试 | `cargo test`（于 `src-tauri/`） | 46 passed |
| 代码检查 | `pnpm lint` | 无错误 |
| 生产构建 | `pnpm build` | 通过 |
| 安装包打包 | `pnpm tauri build` | 通过 · MSI 2.64 MB / NSIS 1.80 MB |

> 界面截图待整体验收后补充。

## 已知限制

第一版预览版有意收敛了范围，以下能力尚未实现，或存在明确取舍：

- **插件系统仅为占位** —— 已预留注册接口，但无插件管理界面。
- **深色模式** —— 已提供配色变量与切换入口，尚未做全量视觉走查。
- **缩略图体积偏大** —— 采用无损 WebP 编码（避免引入 C 依赖），照片类缩略图约为 JPEG q80 的 2~4 倍。
- **历史数据迁移的副作用** —— 早期版本存在卡片 id 撞号，加载时会自动重编号修复；被重编号的卡片上原有连线端点可能失配（渲染层有兜底，不会崩溃）。

## 技术栈

| 层 | 选型 |
|---|---|
| 桌面框架 | Tauri v2（复用系统 WebView2，实测安装包 1.8 ~ 2.6 MB） |
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
pnpm typecheck        # 类型检查（tsc --noEmit）
pnpm test             # 单元测试（Vitest）
pnpm lint             # ESLint
pnpm format           # Prettier 格式化
pnpm build            # 类型检查 + 前端构建
pnpm tauri build      # 打包 Windows 安装包（MSI / NSIS）
pnpm icon             # 重新生成应用图标与 favicon（设计参数见 scripts/generate-icon.mjs）
```

Rust 侧单元测试：

```bash
cd src-tauri && cargo test
```

仅启动前端（浏览器里预览，不含 Tauri 能力）：

```bash
pnpm dev              # http://localhost:1420
```

## 目录结构

```
src/
├── core/                    # 核心，不依赖任何插件
│   ├── types.ts             # 数据 Schema
│   ├── utils/               # 基础工具：路径 / ID / 时间 / 运行时检测 / 主题 / 媒体
│   ├── board/               # 画布数据层：卡片构建 / 网格 / 分区 / 合并 / 落盘 / 缩略图
│   ├── store/               # Zustand 状态（boardStore / spacesStore）
│   ├── commands/            # 操作命令 + 撤销重做栈（impl/ 下逐个命令）
│   ├── registry/            # 卡片类型 / 菜单 / 工具栏 / 插件注册中心
│   └── storage/             # 存储层接口与本地实现
├── canvas/                  # 画布渲染（Viewport / Card / Partition / Connection …）
│   └── interaction/         # 原生 Pointer Events 交互控制器（拖拽 / 缩放 / 平移 / 吸附）
├── pages/                   # 空间列表页 / 画布页
├── components/ui/           # shadcn/ui 生成物
├── lib/                     # shadcn 的 cn() 工具
├── plugins/                 # 插件目录（第一版仅占位）
├── styles/                  # 全局样式与主题变量

src-tauri/
├── icons/                   # 应用图标（app-icon.png 是源图，其余由 pnpm icon 派生）
└── src/commands/            # Rust 端命令：fs_ops / layout / thumbnail / system

scripts/generate-icon.mjs    # 图标生成脚本（矢量光栅化，无第三方依赖）
public/favicon.svg           # 浏览器标签页图标
.github/workflows/ci.yml     # CI：前端质量门 + Rust 单元测试
```

> 单元测试与被测模块同目录（`*.test.ts` / `*.test.tsx`），改动代码时测试就在旁边。

## 数据存放位置

| 数据 | 位置 |
|---|---|
| 空间列表 | `%APPDATA%\Mindscape\spaces.json` |
| 画布布局 | `<空间文件夹>\.mindscape\layout.json` |
| 缩略图缓存 | `<空间文件夹>\.mindscape\thumbnails\` |
| 被移除的文件 | `<空间文件夹>\_已移除\`（**不是删除，只是移出**） |

> 布局跟着文件夹走 —— 把项目文件夹拷给别人，卡片摆放和连线一起过去。

## 贡献

欢迎提交 issue 与 PR。动手前请先读 [CONTRIBUTING.md](CONTRIBUTING.md) —— 里面有代码约定、性能红线和提交前必须通过的检查。

变更记录见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

[MIT](LICENSE)
