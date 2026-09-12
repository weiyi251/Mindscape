# 更新日志

本文件记录 Mindscape / 脑海空间 的所有重要变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增

- **应用内检查更新** —— 集成 Tauri updater：启动时静默检查（只有真的发现新版本才提示），
  空间列表页右上角提供「检查更新」手动入口；安装包经 minisign 签名校验后下载安装，可一键重启生效
- 发版脚本 `pnpm release` —— 签名打包并生成自动更新所需的 `latest.json`
  （`pnpm release --manifest-only` 可用已有产物只重生成清单）

### 变更

- 应用标识由 `com.mindscape.app` 改为 `com.mindscape.canvas`
  —— 原值以 `.app` 结尾，与 macOS 应用包扩展名冲突，每次构建都会告警；改动不影响已存数据
- 工具链要求：pnpm 提升到 **≥ 10**（`pnpm-workspace.yaml` 使用 pnpm 10+ 的配置格式，pnpm 9 会解析失败）

### 文档

- README 补充「下载安装」与「自动更新」说明
- CONTRIBUTING 补充发版流程（签名密钥生成、发版步骤、Release 需上传的物料）

## [0.1.0] - 2026-09-12

首个预览版。功能范围对应开发计划书的 T0 ~ T3 全部工单。

### 新增

**准备层（T0）**

- 项目脚手架：Tauri v2 + React 18 + TypeScript 5（strict）+ Vite 5 + Tailwind 3 + Zustand 4
- 数据 Schema 与 zod 运行时校验（`src/core/types.ts`）
  - 读取落盘数据时校验，版本号高于当前 `DATA_VERSION` 时进入只读模式，一律不写盘
  - 布局文件损坏时不覆盖原文件，先备份 `.bak`，前端改用空布局并给出中文提示
- Rust 端文件命令：`list_dir` / `dir_exists` / `create_dir`、`read_layout` / `write_layout`
  - 落盘采用「500ms 防抖 + `.tmp` 原子重命名」
- 存储层接口 `StorageProvider` 与本地实现 `LocalFolderProvider`
- 命令系统与撤销重做栈（history 上限 50 步）
- 插件注册中心（预留 5 个扩展接口，第一版无插件管理界面）
- 菜单配置中心与卡片类型注册表（一份配置 + `appliesTo` 过滤）
- 交互底座：视口控制器与坐标换算；点击 / 拖拽 4px 判定工具

**阶段一（T1）**

- 空间列表页与新建空间；空间列表持久化，重启后自动恢复
- 进入画布：读取文件夹内容并网格铺开
- 缩略图生成与卡片渲染，保留原始宽高比
  - 缩略图为无损 WebP，缓存于 `<空间文件夹>\.mindscape\thumbnails\`
- 基础交互：滚轮缩放（10% ~ 400%，以鼠标位置为锚点）、画布平移、`Ctrl+0` 复位
- `layout.json` 读写打通，含视口 `zoom` / `offset` 保存
- 50 张图片加载性能自测通过

**阶段二（T2）**

- 卡片拖动；卡片缩放与多选
- 对齐辅助线与吸附
- 分区框：渲染、拖动整组、折叠、重命名、拖拽边缘自定义宽高
- 移除卡片（移入 `_已移除`，**不删除**）、已移除视图与恢复
- 撤销 / 重做，含被移除文件的回滚
- 大批量回滚性能保护
- 布局持久化

**阶段三（T3）**

- 卡片连线：从卡片边缘拖出箭头；连线标签与删除连线
- 卡片备注（`card.note` 持久化）
- 文字便签卡（`note` 类型）
- Rust 端 `open_with_default` / `reveal_in_explorer`
- 从资源管理器拖入文件（基于 Tauri `onDragDropEvent`）与落点规则
- 右键菜单浮层，由配置中心驱动动作登记
- `Ctrl+V` 粘贴剪贴板截图

**验收阶段补充**

- 深色模式与偏好记忆
- 复制 / 粘贴扩展到全部卡片类型（含跨分区）
- 移除卡片时级联断开其连线
- 界面文字整体放大，改善可读性

### 修复

- 修正滚轮缩放锚点漂移：坐标换算必须区分「被变换元素」与「作为参照元素」
- `image` crate 的 `thumbnail()` 会放大小图，改为先判断长边再决定是否缩放
- 统一 `-0` 与 `0`，避免缩放锚点出现 `-0` 偏移
- 修正 `-0` 归一、卡片资源路径不落盘等问题（详见各模块测试中的守卫用例）

### 已知限制

- 插件系统仅为占位，无管理界面
- 深色模式已完成配色变量与切换入口，未做全量视觉走查
- 缩略图采用无损 WebP，照片类缩略图体积约为 JPEG q80 的 2 ~ 4 倍
- 早期版本存在卡片 id 撞号，加载时会自动重编号修复；被重编号卡片上的原有连线端点可能失配（渲染层有兜底，不会崩溃）

[Unreleased]: https://github.com/weiyi251/Mindscape/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/weiyi251/Mindscape/releases/tag/v0.1.0
