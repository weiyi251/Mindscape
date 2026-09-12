# Mindscape 交接文档

> **面向对象**：接下来接手本项目的开发者 / AI 对话会话。读完本文档应能独立开展工作，无需额外询问。
> **阅读顺序建议**：先看第 8 节「新会话避坑清单」，再按需查阅其余章节。
> 配套阅读：`README.md`（面向用户）、`CONTRIBUTING.md`（贡献与发版）、`AGENTS.md`（代理工作规范）、`CHANGELOG.md`（变更史）。

## 1. 项目概述与目标

**Mindscape / 脑海空间** —— 本地桌面无限画布。不新建白板，而是**把一个已有的文件夹变成白板**：文件还在原处，画布只是视图。

- **三条铁律**（产品哲学，不可违背）：① 文件夹是真相，画布是视图；② 不搬家（不主动挪动用户文件）；③ 不静默删除（只有「移出到 `_已移除`」）
- 当前状态：v0.1.0 / v0.2.0 均已发布到 GitHub Release，支持应用内自动更新
- 开源协议 MIT；仓库 https://github.com/weiyi251/Mindscape（公开，main 分支保护禁强推）

## 2. 技术栈与整体架构

### 技术栈（锁定，不得擅自替换）

Tauri v2 / Node ≥20 / **pnpm ≥10**（CI 用 11）/ Rust ≥1.75 / React 18 / TS 5 strict / Vite 5 / Tailwind 3（**不用 v4**）/ Zustand 4 / shadcn-ui。额外获批依赖：`zod`、`eslint+prettier`、`vitest`、`@tauri-apps/plugin-updater` + `plugin-process`。**未经批准不引入任何新第三方库。**

### 架构分层

```
src/
├── core/          核心，不依赖任何插件
│   ├── types.ts           数据 Schema（zod 运行时校验；版本高于 DATA_VERSION → 只读模式）
│   ├── board/             画布数据层：buildCards（文件夹→卡片）/ grid / partitions /
│   │                      layoutMerge（filePath 为键合并）/ layoutWriter（500ms 防抖+.tmp 原子写）/ imageSizes
│   ├── store/             Zustand：boardStore / spacesStore / updaterStore
│   ├── commands/          命令系统 + 撤销重做栈（impl/ 下逐个命令，history 上限 50 步）
│   ├── registry/          cardTypes（image/file/note 三种核心类型）/ menus（一份配置+appliesTo 过滤）/
│   │                      toolbar / pluginCenter（5 个扩展钩子）/ actionRegistry（动作落点）
│   ├── storage/           StorageProvider 接口 + LocalFolderProvider；spacesFile.ts 管空间列表
│   ├── updater/           自动更新封装（检查/下载/重启）
│   └── utils/             paths / id / time / runtime / theme / media
├── canvas/        渲染层：Canvas → Viewport（世界坐标）→ Card / Partition / Connection
│   └── interaction/       交互控制器（原生 Pointer Events）：cardDrag / cardResize /
│                          partitionDrag / partitionResize / viewportController / marquee / snap /
│                          pointerGesture（4px 判定）/ connectionAnchor
├── pages/         SpaceList（空间列表）/ Board（画布页）
├── plugins/       第一版仅占位（demoPlugin 是 T0.9 的验收交付，勿删）
└── components/ui/ shadcn/ui 生成物 + menu-list / modal / prompt-dialog / update-dialog

src-tauri/src/commands/    Rust 端：fs_ops / layout / thumbnail / system（打开原图、资源管理器）
scripts/                   generate-icon.mjs（图标生成，零依赖）/ release.mjs（发版）
```

### 数据流向（关键）

- **高频坐标（卡片 x/y、viewport zoom/offset）不进 Zustand、不 setState**，只直写 `element.style.transform`（`transform-origin: 0 0`），松手才走命令层落盘
- 落盘：500ms 防抖 + `.tmp` 原子重命名 → `<空间文件夹>\.mindscape\layout.json`
- 空间列表：`%APPDATA%\Mindscape\spaces.json`（`dataDir()` + 硬编码 `'Mindscape'`，**与 identifier 无关**）
- ~~缩略图~~：**已于 2026-09-12（方案 A）下线** —— 空间文件夹内不再生成缩略图，卡片直接加载原图（宽高比由 `read_image_size` 读图头获得，渲染走 `lazyOriginal` 可见时加载）；Rust `make_thumbnail` 命令保留未删（回退保命符）
- 卡片原图绝对路径**不进 schema 不落盘**，放 `core/board/cardAssets.ts` 模块级 Map；写入必须早于 `boardStore.set({cards})`

## 3. 已完成功能与当前进度

- **T0 ~ T3 全部工单已完成**（准备层 / 文件夹铺画布与平移缩放 / 拖拽缩放分区撤销重做 / 连线备注便签拖入粘贴）
- v0.1.0（2026-09-12）：首个公开预览版
- v0.2.0（2026-09-12）：应用内检查更新（启动静默检查 + 空间列表页手动入口 + minisign 签名校验）；`pnpm release` 发版脚本
- 全量基线（2026-09-12）：Vitest **582 passed / 50 文件**、tsc 0 错、eslint 0 error（2 条既有 warning）、cargo test **46 passed**、vite build 通过
- 死代码清理已完成（2026-09-12）：全项目仅 1 处死代码（`ResizeSnapshot`）已删；`menu-list.tsx` / `toolbar.ts` / `demoPlugin.ts` / `actionRegistry` 的 `unregisterAction` 等是**有意预留的准备层 API，勿当死代码删**

## 4. 待办事项与已知问题

### ⚠️ 高优先级（阻塞推送）

1. **本地与远端 sha 分叉**：远端 main = `36cdb32`，本地 = `e89bb99` + 3 个新提交（fe0d750 / fa2cb11 / fc86a05）。分叉原因是 git 被墙时走了 Git Data API 在远端重建提交链（内容树一致、历史不同）。**处理**：网络恢复后 `git fetch` → `git checkout -B main origin/main` → 用 `git cherry-pick` 或重建提交把本地 3 个提交带上去 → 重打本地 `v0.2.0` tag 指向远端 `36cdb32`
2. **hosts 恢复**：`C:\Windows\System32\drivers\etc\hosts.bak-20260912` 中 Steam/YouTube/Google/Docker/greasyfork 等**非 GitHub 条目**被误清（清理 GitHub 屏蔽时），需管理员恢复；Watt Toolkit（Steam++）运行会再写回屏蔽

### 中优先级

3. **README 界面截图仍缺**（需真机运行截取）
4. **GitHub PAT 轮换**：2026-10-11 到期，且曾在日志泄露 base64 形式

### 已知限制（有意取舍，见 README「已知限制」）

插件系统仅占位无管理界面；深色模式未做全量视觉走查；图片卡片直接加载原图，大图同屏时解码内存较高；早期卡片 id 撞号会自动重编号（连线端点可能失配，渲染层有兜底）；自动更新依赖 GitHub 可达。

## 5. 重要设计决策与约定（用户裁决，已生效）

1. **布局损坏**：Rust `Err` 承载中文提示（`LAYOUT_CORRUPT_MARKER`）→ 前端置 corrupt、用空布局、不立即回写、备份 `.bak`
2. **菜单**：共用一组配置 + `appliesTo` 过滤；配置层 + 纯渲染 `components/ui/menu-list.tsx`
3. **数据版本**：layout `version > DATA_VERSION` → 只读、一律不写盘
4. **不引入 jsdom**：vitest 保持 node 环境；DOM 行为测试改为「纯函数 + 少量胶水」
5. **边界阻尼参数**（文档未给，可调手感参数）：越界衰减 0.3 / 上限 8% / 140ms 后 10 步回弹（`coordinates.ts` / `viewportController.ts`）
6. **代码约定**：模块顶部写中文说明并注文档章节；代码内注释用英文；中文文案进常量表（如 `CORE_CARD_TYPE_LABELS`）
7. **架构红线**（17.3/17.11）：见第 2 节数据流向；另：拖拽平移**禁用** dnd-kit/react-rnd；资源管理器拖入用 Tauri `onDragDropEvent` **禁用** HTML5 drop；滚轮 `{ passive:false }` + preventDefault；缩放 10%~400% 以鼠标为锚点
8. **坐标换算**：`画布坐标 = (屏幕 − 容器左上角 − offset) / zoom`；`getBoundingClientRect()` 参照系陷阱见第 8 节

## 6. 运行、测试与发版

```bash
pnpm install        # 安装依赖（沙箱内需 nodeLinker: hoisted，见 pnpm-workspace.yaml）
pnpm tauri dev      # 开发模式启动桌面应用
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest run（582 tests）
pnpm lint           # eslint
pnpm build          # tsc + vite build
pnpm tauri build    # 打包（工具链缓存在 %LOCALAPPDATA%\tauri\{WixTools314,NSIS}，免联网）
pnpm release        # 发版：签名打包 + latest.json（--manifest-only 可只重生成清单）
pnpm icon           # 重新生成图标（scripts/generate-icon.mjs，零第三方依赖）
cd src-tauri && cargo test   # Rust 测试（46 passed）
```

- **cargo 全路径**：`C:\Users\lenovo\.cargo\bin\cargo.exe`（PATH 坑已修但沙箱内仍建议全路径）；crates 走 rsproxy 镜像
- **发版签名**：私钥 `C:\Users\lenovo\.tauri\mindscape.key`（仓库外、无密码）。两个坑：① CLI 不认 `TAURI_SIGNING_PRIVATE_KEY_PATH`，须读文件内容注入 `TAURI_SIGNING_PRIVATE_KEY`；② 必须显式 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD=''`（空串），否则交互式等密码挂死
- **提交身份**：本机 git 未配置身份，每次提交必须带 `git -c user.name=weiyi251 -c user.email=3127459108@qq.com commit`；**不得改 git config**
- **CI**：GitHub Actions 须 pnpm 11 + node 22（pnpm-workspace.yaml 是 10+ 格式，pnpm 9 报 `packages field missing` 且失败点误显示在装 Node 步骤）
- **GitHub 资产上传必须 raw body**：`uploads.github.com` 不解析 multipart（会原样存盘损坏文件），工具脚本 `.workbuddy/gh-finish.mjs` 已固定 raw body

## 7. 性能与素材

- 50 张图片（37.8 MB）性能自测通过；素材在 `D:\Mindscape\性能测试-50张`
- release exe 约 5.45 MB；安装包 NSIS 2.54 / MSI 3.79 MB；`src-tauri/target/` 体积大属正常（构建缓存，已 gitignore）

## 8. ⚠️ 新会话避坑清单（最容易踩的坑）

### 沙箱 / 工具环境（WorkBuddy 会话特有）

1. **Bash 工具可能整体失效**（`dirname: command not found` → cwd null）：改用 `node .workbuddy/node-run.mjs <脚本或.exe> [参数]` 执行工具链；脚本**写成文件**再跑，勿用内联 `-e`
2. **删除劫持**：`CODEBUDDY_SAFE_DELETE_ENABLED=1` 会拖死大目录递归删除 → node-run.mjs 已自动置空；删除后必须 `fs.existsSync` 复核
3. **沙箱静默丢弃 git 对 `refs/remotes/` 的写入**（fetch/update-ref 假成功）→ 用 node 按纯文本 ref 格式写文件；**本机一切写入都要回读验证**
4. **打包必须剔除 `HTTPS_PROXY` / `HTTP_PROXY`**（注入的失效代理走它 502）

### 代码 / 调试

5. **坐标参照系**：被 translate3d 的 `stage` 的 `getBoundingClientRect()` 不能当「容器左上角」（offset 重复扣减 → 缩放锚点漂移）；`ViewportController.attach(stageEl, originEl)` 第二参传**未变换的根容器**；根容器不能加 border/padding
6. **`assetProtocol` 须同步 Cargo feature** `"protocol-asset"`，否则 tauri-build 报错
7. **`thumbnail()` 会放大小图**须自判；**JPEG 不支持 alpha**（测试用 `RgbImage`）；**`-0 ≠ 0`**（`|| 0` 归一）—— 均为缩略图时代经验，`make_thumbnail` 保留未删，回退时仍适用
8. **黑屏三档排查**：① curl 看 Content-Type（SPA fallback 也是 200）；② netstat 看 ESTABLISHED（HMR websocket 是「JS 已执行」铁证）；③ `index.html` 有中文占位兜底；先 `tasklist` 清 mindscape 孤儿进程
9. **identifier** = `com.mindscape.canvas`（勿改回 `.app` 结尾，会与 macOS 包扩展名冲突）；`package.json` 保持 `private: true`

## 9. 变更记录

> 按 `AGENTS.md` 规范，每次变更完成后立即在此追加一行。格式：`日期 | commit | 涉及文件/模块 | 变更摘要 | 原因`

| 日期 | commit | 涉及文件/模块 | 变更摘要 | 原因 |
|---|---|---|---|---|
| 2026-09-12 | fe0d750 | `src/canvas/interaction/cardResizeController.ts` | 删除零引用死接口 `ResizeSnapshot`；另删项目根 18 个意外创建的空目录（未入库） | 用户要求全项目死代码清理 |
| 2026-09-12 | fa2cb11 | `AGENTS.md` | 新增代理工作规范（逐次提交 + 测试全绿） | 用户要求 |
| 2026-09-12 | fc86a05 | `README.md` | 重写「当前状态」：移除 T0~T3 工单过程叙述，改为能力分类功能表；修正「处于验收打包阶段」等过时表述 | 用户要求 README 聚焦现状 |
| 2026-09-12 | （本次） | `HANDOVER.md`、`AGENTS.md` | 新建交接文档；AGENTS.md 增加变更记录同步规范 | 用户要求建立交接机制 |
| 2026-09-12 | docs 提交 | `docs/缩略图重构计划.md`（新增） | 产出缩略图重构计划：现状链路分析、原图方案可行性、A/B/C 方案对比（推荐混合阈值+JPEG q80）、改动范围与回退策略；**未改任何代码** | 用户要求评估「直接加载原图」替代缩略图 |
| 2026-09-12 | docs 提交 | `docs/缩略图重构计划.md` | 计划定稿为方案 A（完全去缩略图、直接加载原图）：用户裁决①空间文件夹不再生成缩略图 ②layout.json 保留在空间文件夹 ③存量缩略图待重构验证后经确认再清；实施步骤 S1~S7 与风险回退已细化；**未改任何代码** | 用户裁决（AskUserQuestion 三问三答） |
| 2026-09-12 | d81fc87 | `src/core/board/`（thumbnails.ts→imageSizes.ts、cardAssets、boardStore、restoreCards、cardTypes、Board.tsx）及全部相关测试 | 前端下线缩略图链路：新增 `collectImageSizes`（readImageSize 6 路并发读图头定宽高比）；`cardAssets` 简化为仅原图路径（thumbnailPath 字段删除）；`renderImage` 初始 src 置空、由 `lazyOriginal` 可见时加载原图；拖入/粘贴/粘贴截图不再生成缩略图 | 方案 A 落地（用户裁决） |
| 2026-09-12 | 705d826 | `src-tauri/src/{commands/fs_ops.rs, lib.rs}`、`src/core/storage/{StorageProvider.ts, LocalFolderProvider.ts}`、`Board.tsx` 及守护测试 | 移除 `copy_image_with_thumbnail` 命令（含 CopiedImage / find_space_root 与 3 个测试），拖入/粘贴图片统一走 `copy_file`；`make_thumbnail` Rust 命令保留（回退保命符）；命令守护表 14→13 | 方案 A 落地（用户裁决） |
| 2026-09-12 | 764312e | `README.md`、`CHANGELOG.md`、`HANDOVER.md` | 文档同步方案 A：功能表改「图片卡（直接加载原图）」、数据位置表删缩略图行、已知限制改「大图画布内存占用」、§2 数据流与 §8 陷阱 7 更新 | 方案 A 落地（用户裁决） |
| 2026-09-12 | 5526702 | `src/canvas/{Canvas.tsx, Partition.tsx}`、`src/core/store/boardStore.ts(+test)`、`src/core/registry/menus.ts(+test)`、`src/core/commands/impl/moveCardToFolder.ts(+test 新增)`、`src/pages/Board.tsx` | 修复问题 1：Ctrl+V 粘贴不再按视口中心猜落点，改为「选中分区 → 未分类」确定性规则；新增分区选中（按下分区/调整手柄即选中，互斥卡片选中，主色描边高亮，点空白取消）；分区右键粘贴保持指定目标，空白右键粘贴 = 右键位置所在文件夹。实现问题 2：卡片右键新增「移动到…」二级菜单（分区 + 未分类，隐藏当前所在文件夹），新命令 `createMoveCardToFolderCommand` 物理移动文件 + 更新 filePath/originalPath/group + 目标分区扩框，undo 全量还原；新增 `boardStore.setCardFileRefs` | 用户要求修复两项体验问题（目标不受控 + 无法切换文件夹） |
| 2026-09-12 | 37354e8 | `src-tauri/icons/*`（全量）、`scripts/generate-icon.mjs` | 应用图标更换为用户提供的蓝橙无限符号图：源图入库为 `icons/app-icon.jpg`（1080×1080），`generate-icon.mjs` 由 SDF 矢量绘制改为薄包装（`tauri icon` 派生全尺寸 + 自动清 android/ios）；删除旧 SDF 源 `app-icon.png` | 用户反馈原图标不够美观，要求换图 |
| 2026-09-12 | 4fe044a | `src/canvas/{MiniMap.tsx(新增), minimapGeometry.ts(+test 新增), Canvas.tsx}`、`src/pages/Board.tsx` | 画布右下角新增小地图：2D canvas 概览分区（8 色）/卡片/当前视口框，点击/拖拽跳转（`CanvasApi.centerOn`），面板可收起（隐藏时只留小入口按钮），显示偏好 localStorage 记忆；视口每帧重绘走 registerRedraw 直呼 draw（零 React 更新），颜色读 CSS 变量适配深浅主题；纯几何拆 `minimapGeometry.ts`（6 例单测） | 用户要求新增小地图功能（概览 + 显隐切换） |
| 2026-09-12 | 759d4b4 | `src-tauri/build.rs`、`scripts/generate-icon.mjs` | 修复「图标换了但 exe 标题栏还是旧图标」：tauri-build 不监听图标文件（只监听 tauri.conf.json），且 build 脚本重跑后构建输出内容不变时 cargo 不重链接 exe。build.rs 补 `rerun-if-changed=icons/icon.ico`；generate-icon.mjs 生成后自动触碰 src/main.rs 强制重链接。已字节级验证 exe 内 6/6 图像条目为新图标 | 用户实测标题栏图标未变 |
| 2026-09-12 | 501ea62 | `src/components/ui/{settings-panel.tsx(新增), settingsText.ts(+test 新增)}`、`src/canvas/{Partition.tsx, MiniMap.tsx}`、`src/pages/Board.tsx` | 界面三项优化：①分区名与改名输入框字号 13px→15px；②顶栏收纳——新增「设置」按钮，主题切换/显示已移除/检查更新统一收进 SettingsPanel（更新区显示当前版本 getVersion + 最新版本 updaterStore.version，检查走既有 UpdateDialog 流程）；③小地图两态 bottom-3→bottom-12，避让 Canvas 状态条「复原视图」按钮。响应式：顶栏 flex-wrap、面板 max-w/max-h 自适应 | 用户要求三项界面优化 |
| 2026-09-12 | ec78f68 | `src/pages/{SpaceList.tsx, Board.tsx, App.tsx}`、`src/components/ui/{icons.tsx(新增), settings-panel.tsx}`、`src/core/hooks/useTheme.ts(新增)` | 主界面顶栏改纯图标入口：①新增内联 SVG 图标模块 icons.tsx（PlusIcon / SettingsIcon，零新增依赖）；②新增 useTheme hook 收敛「读偏好→切换→应用 <html>→写偏好」，Board 与 SpaceList 共用（原 Board 内联实现删除）；③SettingsPanel 加可选 `panelClassName`（定位）并把「显示已移除」三项 props 改为可选（主界面不传即不渲染该行）；④SpaceList：「新建空间」→ ＋ 纯图标按钮、「检查更新」独立按钮删除并收进 ⚙ 设置面板（与空间内同一组件），按钮组加 `ml-auto`；⑤Board：设置按钮改 ⚙ 纯图标，面板仍挂根容器右上。实测（本机 Chrome 无头，1280/1024/820/640/480 五档）：面板右缘与按钮右缘对齐、顶距 8px、全部落在视口内、无水平溢出、点外部可关、主题切换生效、面板无「显示已移除」 | 用户要求主界面加纯图标设置入口 + 新建空间改加号图标 + 面板与空间内保持一致 |
| 2026-09-12 | 65db243 | `src/canvas/Partition.tsx` | 分区名称字号 15px→17px（显示态与改名输入框同步），折叠按钮 h-5/11px→h-6/12px 保持比例；标题条仍为 PARTITION_TITLE_HEIGHT(32px)，17px 行盒不溢出、不遮挡 | 用户要求分区名字号更醒目 |
| 2026-09-12 | d1d863e | `src/components/ui/{icon-toolbar.tsx(新增), icons.tsx}`、`src/pages/Board.tsx` | 画布顶栏新增可折叠工具栏：撤销 / 重做 / 新建便签（已移除视图下为「恢复选中」）从铺排的文字按钮收进 `<IconToolbar>`，**一律纯图标**（文字只留在 title / aria-label）；「恢复选中」的张数改用右上角计数徽标承载；折叠后只剩手柄，展开/收起偏好 localStorage `mindscape.boardToolbar`（默认展开）；折叠只隐藏按钮，Ctrl+Z / Ctrl+Shift+Z 与右键菜单不受影响。icons.tsx 补 6 个图标（Undo/Redo/NoteAdd/Restore/ChevronsLeft/ChevronsRight）并抽 `StrokeIcon` 外壳；新增 `handleCreateNoteAtViewportCenter`（从内联 onClick 提取）。实测（临时预览页 + 无头 Chrome，1280/820/480）：工具栏 140×36（展开 4 钮）/ 38×36（收起 1 钮），与顶栏 h-9 按钮**等高**；所有按钮 `textContent` 为空且含 svg；水平溢出 0、无 JS 报错 | 用户要求把顶栏控件统一收进可折叠的纯图标工具栏 |
| 2026-09-12 | 15764e4 | `src/components/ui/{icon-toolbar.tsx, icons.tsx}` | 修正折叠手柄箭头方向：**收起 → 双箭头向右（»）、展开 → 双箭头向左（«）**。判据是「箭头指向按下后整块内容移动的方向」——工具栏在顶栏里**靠右对齐**，收起时内容向右缩回去、展开时向左铺开；原先按左侧面板的约定写反了。图标注释改为只描述字形（不再把语义绑在图标上，避免下次改动不一致）。实测：展开态手柄 d=`m6 17 5-5-5-5`（右）、收起态 d=`m11 17-5-5 5-5`（左） | 用户实测反馈展开/收起图标显示相反 |
| 2026-09-12 | 96fb3e1 | `src/canvas/interaction/cardResizeController.ts(+test)`、`src/canvas/Canvas.tsx` | **根因①（数据层）**：卡片缩放手柄自由改 w/h，卡片盒比例会脱离原图比例。`CardResizeSource` 新增 `getAspectRatio(cardId, element)`；新增纯函数 `ratioLockedSize` —— 有比例时按「相对变化更大的那一轴」等比缩放、另一轴由原图比例推出，短边仍受 MIN_CARD_SIZE 保底（先保高再反推宽，竖图/全景图都不会变细线），无比例保持自由缩放。Canvas 注入：优先读已加载原图的 naturalWidth/Height，未加载退回卡片当前比例，非图片返回 null。补 10 条单测 | 用户实测反馈「图片放大缩小后宽高比与原图不一致，图片显示不完整」 |
| 2026-09-12 | a80e604 | `src/core/registry/cardTypes.ts(+test)` | **根因②（渲染层）**：img 只给 `w-full` 时元素盒高度由「宽度 × 原图比例」自行推出，卡片比原图更宽更扁时元素盒比卡片高，被外壳 `overflow-hidden` 裁掉（`object-fit` 管不了元素盒超出容器）。实测 16:9 图放进 480×135 卡片：img 盒 478×268.9、图片仅 **50% 可见**。改为无条件 `flex-1 + min-h-0`（元素盒被容器约束，有备注/标签条时自动让出高度）→ 同用例 **100%**；六种尺寸 × 有/无备注条全部 100%。渲染层兜底：旧布局里已失真的卡片也能完整显示 | 同上（配合上一条：数据层锁比例 + 渲染层兜底） |
