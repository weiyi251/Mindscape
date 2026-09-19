# 参与开发

感谢你对 Mindscape 感兴趣。这份文档说明本项目的开发方式、代码约定与提交要求，请在动手前过一遍。

## 三条铁律

任何改动都不能破坏这三条，它们决定了这个产品是什么：

1. **文件夹是真相，画布是视图** —— 软件挂了、卸载了，用户硬盘上的文件必须一个不少。
2. **不搬家** —— 文件始终留在用户选定的文件夹里，产品不主动挪动它们。
3. **不静默删除** —— 只提供「移出到 `_已移除`」，绝不提供「永久删除」。

## 环境准备

| 依赖 | 版本 |
|---|---|
| Node.js | ≥ 20 LTS |
| pnpm | ≥ 10（`pnpm-workspace.yaml` 用的是 pnpm 10+ 配置格式；开发与 CI 均使用 11） |
| Rust | ≥ 1.75 stable（Windows 目标 `x86_64-pc-windows-msvc`） |
| MSVC 构建工具 | Visual Studio Build Tools 的「使用 C++ 的桌面开发」工作负载 |
| WebView2 | Windows 10/11 已内置 |

```bash
pnpm install
pnpm tauri dev
```

## 提交前必须全绿

CI 会跑同一组检查（见 `.github/workflows/ci.yml`），本地先跑一遍避免来回：

```bash
pnpm typecheck                 # tsc --noEmit
pnpm test                      # Vitest
pnpm lint                      # ESLint
cd src-tauri && cargo test     # Rust 侧单元测试
```

改动涉及构建配置时，再补一次 `pnpm build`。

## 代码约定

### 注释语言

- **每个模块顶部**写一段中文模块说明，必要时注明对应《Mindscape 开发计划书》的章节号。
- **函数与行内注释用英文**，便于与外部贡献者协作。
- 引用设计依据时写成「章节号 + 原文关键句」的形式，方便回溯。

### 文案

中文界面文案统一收在常量表里（例如卡片类型标签集中在注册表），不要散落在 JSX 中。

### 性能红线

这几条是踩过坑之后固化下来的，改动相关代码时务必遵守：

- **高频坐标数据不进 Zustand、不 setState** —— 卡片 `x/y`、视口 `zoom/offset` 只写 `element.style.transform`。
- **拖拽与平移使用原生 Pointer Events + `setPointerCapture`**，不引入 `dnd-kit` / `react-rnd`。
- **滚轮监听必须 `{ passive: false }`**，并显式 `preventDefault()`。
- **滚轮缩放必须以鼠标位置为锚点**，缩放范围 10% ~ 400%。
- **坐标换算一律先转换到画布坐标系再计算**：`画布坐标 = (屏幕坐标 - 容器左上角 - offset) / zoom`。
- **从资源管理器拖入文件必须用 Tauri `onDragDropEvent`**，不能用 HTML5 `drop`（WebView 会吞掉）。
- **落盘防抖 500ms + 原子写入**（`.tmp` + rename）。

### 坐标换算的经典陷阱

`getBoundingClientRect()` 会随 CSS transform 变化。**被变换的元素不能同时充当参照系**：

- 写入了 `translate3d` 的 `stage` 元素，其 `getBoundingClientRect()` 会跟着 offset 移动；
- 用它当作公式里的「画布容器左上角」，会把 offset 重复扣减，导致缩放锚点漂移；
- 因此 `ViewportController.attach(stageEl, originEl)` 必须传入**未被变换的根容器**作为参照。

画布根容器不要加 `border` / `padding`，`transform-origin` 必须是 `0 0`，否则上述公式不成立。
`viewportController.test.ts` 里有对应的守卫用例，改动时不要删。

### 依赖

技术栈已锁定（Tauri v2 / React 18 / TypeScript 5 strict / Vite 5 / Tailwind 3 / Zustand 4 / shadcn-ui）。
**新增第三方依赖前请先开 issue 讨论**，说明为什么现有依赖无法解决。

## 测试约定

- 测试文件与被测模块**同目录**，命名 `*.test.ts` / `*.test.tsx`，改动代码时测试就在旁边。
- Vitest 运行在 `node` 环境（不引入 jsdom）。需要验证 DOM 行为时，把逻辑抽成纯函数再测，胶水层保持极薄。
- Rust 侧单元测试用 `#[cfg(test)]` 内联在模块底部。
- 修 bug 时优先补一个能复现该 bug 的测试。

## 提交信息

推荐 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：

```
feat: 卡片连线支持标签
fix: 修正滚轮缩放锚点漂移
docs: 补充坐标换算说明
test: 补齐分区框折叠用例
chore: 升级 Tauri 依赖
```

一条提交只做一件事；纯格式化改动单独提交。

## 重新生成图标

图标由脚本绘制（矢量光栅化，无第三方依赖），不需要设计源文件：

```bash
pnpm icon
```

脚本以 `src-tauri/icons/app-icon.jpg`（1080×1080 源图）为源：调用 Tauri CLI 派生各平台桌面图标，并由 128×128 派生图生成浏览器 favicon（`public/favicon.svg`）。

## 发布新版本

应用内置自动更新，而 updater 插件**强制校验签名**（无法关闭），所以发版比普通打包多一步。

### 一次性准备：生成签名密钥

```bash
pnpm tauri signer generate -w "%USERPROFILE%\.tauri\mindscape.key"
```

- 私钥写到 `~/.tauri/mindscape.key`，**必须在仓库之外** —— 不要提交，也不要贴进 issue。
- 命令会同时输出公钥文本，把它填进 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`。
- 换密钥意味着**已安装的旧版本将无法再自动更新**（旧版本内置的是旧公钥），慎换。

### 每次发版

```bash
# 1. 同步版本号：src-tauri/tauri.conf.json 与 package.json 的 version，并在 CHANGELOG.md 记录改动
# 2. 签名构建 + 生成更新清单
pnpm release

# 3. 把安装包与 latest.json 一起上传到 GitHub Release，tag 用 v + 版本号
```

`pnpm release` 做两件事：

1. 读取 `~/.tauri/mindscape.key` 并签名打包（可用 `TAURI_SIGNING_PRIVATE_KEY_PATH` 指定别的路径，
   CI 里用 `TAURI_SIGNING_PRIVATE_KEY` 直接给密钥内容）。
   注意 **tauri CLI 本身只认 `TAURI_SIGNING_PRIVATE_KEY`（内容）**，只给路径会报
   「A public key has been found, but no private key」—— 路径变量是本脚本提供的便利写法，由它读成内容后注入；
2. 读取 NSIS 安装包旁的 `.sig`，生成 `src-tauri/target/release/bundle/latest.json`。

只想用已有产物重新生成清单时加 `--manifest-only`：`pnpm release --manifest-only`。

上传到 Release 的物料应包含：`latest.json`、`*_x64-setup.exe`、`*_x64-setup.exe.sig`。

> ⚠️ 这个 Release 必须是「最新正式版」——不能是草稿或预发布，否则
> `releases/latest/download/latest.json` 会 404，客户端的检查更新会直接失败。
>
> ⚠️ `latest.json` 里的 `signature` 必须是 **`.sig` 文件的文本内容**，不是路径也不是 URL。
> 手工拼清单时最容易在这里出错，所以请用脚本生成。

### 本地验证自动更新

不必真的发一个版本也能把链路验通：临时把 `tauri.conf.json` 的 `plugins.updater.endpoints`
指向本地 HTTP 服务上的 `latest.json`，其中 `version` 填一个比当前更高的值，`pnpm tauri dev` 启动后
就会走到「发现新版本」的分支。安装环节想要真的跑通，清单里的 `url` 与 `signature` 必须对应一个
**用同一把私钥签出来的真实安装包**；否则会在验签阶段失败，这是预期行为。

验证完记得把 `endpoints` 改回 GitHub 地址 —— 这个值会被打进发布包。

