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

**当前版本 `v0.5.0`（预览版），已在 GitHub 发布** —— 到 [Releases](https://github.com/weiyi251/Mindscape/releases/latest) 下载，支持 Windows 10/11 x64。应用内置自动更新，之后的版本可一键升级，无需再手动下载。

计划书范围内的功能已全部实现，画布现在能做的事：

| 能力 | 说明 |
|---|---|
| 文件夹 → 画布 | 新建空间指向一个已有文件夹，文件自动网格铺开：图片卡（直接加载原图）、文件卡（扩展名徽标 + 文件名）、便签卡（纯文字） |
| 摆放与整理 | 卡片拖动 / 缩放 / 框选多选 / 复制粘贴，对齐辅助线与吸附；分区框支持整组拖动、折叠、重命名、指定颜色、自定义宽高 |
| 记录想法 | 卡片之间拖出连线（可带标签）；任意卡片可加备注、编辑标签；便签卡双击即可在卡内直接编辑文字 |
| 文件进出 | 从资源管理器拖入文件（自动判断落点）；`Ctrl+V` 粘贴剪贴板截图；**跨应用复制粘贴**：空间内复制的文件可粘贴到资源管理器 / 桌面等任意外部软件，外部复制的文件也可 `Ctrl+V` 粘贴进空间；图片可打开原图 |
| 安全兜底 | 「移除」只是把文件移入 `_已移除`，不真删除、可恢复；撤销 / 重做保留 50 步，含被移除文件的回滚 |
| 视图与外观 | 滚轮缩放 10% ~ 400%（以鼠标为锚点，`Ctrl+0` 复位、`Ctrl+Shift+0` 缩放到全部内容）、画布平移；深色模式且记住偏好 |
| 搜索定位 | `Ctrl+F` 搜索浮层：按文件名 / 便签正文 / 分区名匹配，`Enter` 在命中项之间跳转，命中卡片画虚线高亮 |
| 空间管理 | 空间卡片可重命名（只改显示名，文件夹不动）、收藏；列表按「收藏 → 最近打开」排序 |
| 数据持久 | 布局与视口存在软件目录（`%APPDATA%\Mindscape\layouts\`），**空间文件夹里零新增文件**；布局可显式导出成 `mindscape-layout.json`，也可从别人的文件夹导入 |
| 分发更新 | 安装包经 minisign 签名校验；应用内检查更新，更新清单托管在 GitHub Release |

### 验证基线

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `pnpm typecheck` | 无错误 |
| 单元测试 | `pnpm test` | 726 passed / 58 个测试文件 |
| Rust 单元测试 | `cargo test`（于 `src-tauri/`） | 43 passed |
| 代码检查 | `pnpm lint` | 无错误 |
| 生产构建 | `pnpm build` | 通过 |
| 安装包打包 | `pnpm tauri build` | 通过 · MSI 3.89 MB / NSIS 2.60 MB（含自动更新组件） |

> 界面截图待补充。

## 下载安装

到 [Releases](https://github.com/weiyi251/Mindscape/releases/latest) 下载最新版，支持 Windows 10/11 x64：

| 安装包 | 适用场景 |
|---|---|
| `Mindscape_x.y.z_x64-setup.exe` | **推荐**，体积更小，安装时可自选目录 |
| `Mindscape_x.y.z_x64_en-US.msi` | 需要走组策略或批量部署时用 |

安装包**未做代码签名**（个人开源项目），首次运行可能被 Windows SmartScreen 拦下，点「更多信息 → 仍要运行」即可。

### 自动更新

应用内置更新检查，发现新版本会弹窗，确认后自动下载安装，再点「立即重启」生效：

- **启动时静默检查** —— 只有真的发现新版本才打扰你；
- **手动检查** —— 空间列表页右上角「检查更新」；
- 安装包经过 **minisign 签名校验**，签名不通过会被拒绝安装。

覆盖安装**不会影响已有数据** —— 空间列表与布局都在 `%APPDATA%\Mindscape\` 下（空间文件夹里不写任何东西），全在安装目录之外，卸载重装也不会动。

## 已知限制

第一版预览版有意收敛了范围，以下能力尚未实现，或存在明确取舍：

- **插件系统仅为占位** —— 已预留注册接口，但无插件管理界面。
- **深色模式** —— 已提供配色变量与切换入口，尚未做全量视觉走查。
- **大图画布的内存占用** —— 图片卡片直接加载原图（不生成缩略图，空间文件夹里只有你自己的文件）；缩小视图下多张高分辨率原图同屏时，解码内存与渲染开销随原图分辨率增长。
- **历史数据迁移的副作用** —— 早期版本存在卡片 id 撞号，加载时会自动重编号修复；被重编号的卡片上原有连线端点可能失配（渲染层有兜底，不会崩溃）。
- **自动更新依赖 GitHub 可达** —— 检查与下载都直接走 GitHub Release；内网等受限网络下会静默失败，此时需手动下载覆盖安装。

## 技术栈

| 层 | 选型 |
|---|---|
| 桌面框架 | Tauri v2（复用系统 WebView2，实测安装包 2.6 ~ 3.9 MB） |
| 前端 | React 18 + TypeScript 5 + Vite 5 |
| UI | Tailwind CSS 3 + shadcn/ui |
| 画布渲染 | DOM 方案（卡片是 div，不是 Canvas） |
| 状态管理 | Zustand 4 |
| 后端 | Rust（Tauri 自带） |
| 自动更新 | Tauri updater（minisign 签名校验，更新清单托管在 GitHub Release） |

## 环境要求

- Node.js ≥ 20 LTS
- pnpm ≥ 10（`pnpm-workspace.yaml` 采用 pnpm 10+ 的配置格式；本仓库开发与 CI 均使用 11）
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
pnpm release          # 发版：签名打包 + 生成自动更新的 latest.json（见 CONTRIBUTING）
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
│   ├── board/               # 画布数据层：卡片构建 / 网格 / 分区 / 合并 / 落盘 / 图片尺寸
│   ├── store/               # Zustand 状态（boardStore / spacesStore / updaterStore）
│   ├── updater/             # 自动更新的插件封装（检查 / 下载安装 / 重启）
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
scripts/release.mjs          # 发版脚本：签名打包 + 生成自动更新清单 latest.json
public/favicon.svg           # 浏览器标签页图标
.github/workflows/ci.yml     # CI：前端质量门 + Rust 单元测试
```

> 单元测试与被测模块同目录（`*.test.ts` / `*.test.tsx`），改动代码时测试就在旁边。

## 数据存放位置

| 数据 | 位置 |
|---|---|
| 空间列表 | `%APPDATA%\Mindscape\spaces.json` |
| 画布布局 | `%APPDATA%\Mindscape\layouts\<空间 id>.json` |
| 被移除的文件 | `<空间文件夹>\_已移除\`（**不是删除，只是移出**） |

> 布局存在软件目录里，空间文件夹始终只有你自己的文件。要把摆放与连线带给别人，用「导出布局」在文件夹里生成 `mindscape-layout.json`，对方「导入空间」选中该文件夹即可还原。
> 老版本在空间文件夹里留下过 `.mindscape\layout.json`：首次打开会自动迁移到软件目录，**旧文件不会被删除**，可自行删除。

## 贡献

欢迎提交 issue 与 PR。动手前请先读 [CONTRIBUTING.md](CONTRIBUTING.md) —— 里面有代码约定、性能红线和提交前必须通过的检查。

变更记录见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

[MIT](LICENSE)
