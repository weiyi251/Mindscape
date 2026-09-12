# AGENTS.md — AI 代理工作约定

本文件约束所有在本仓库工作的 AI 代理（含 Claude / CodeBuddy 等编码代理）。以下规则为**强制要求**，任何改动都必须遵守。

## 强制规则

### 1. 每次改动必须创建对应的 Git commit

每次改动（无论大小）完成后，都必须立即创建一个对应的 Git commit，以便后续追踪和回滚。

- 禁止把多处无关改动混进同一个 commit；
- 禁止在交付前留下未提交的工作区改动；
- commit message 用 `type: 中文摘要` 格式（`feat` / `fix` / `docs` / `chore` / `refactor` / `test`）。

### 2. 每次改动必须编写或更新测试，且全部通过后才可交付

每次改动后，都必须编写或更新相关的测试，并在**交付给用户之前**确保所有测试和验证全部通过。

交付前的最低验证门禁（全部通过才算完成）：

```bash
pnpm typecheck    # tsc --noEmit，0 错误
pnpm lint         # eslint，0 error
pnpm test         # vitest run，全部通过（与源码同目录的 *.test.ts / *.test.tsx）
pnpm build        # tsc + vite build
cd src-tauri && cargo test   # Rust 单元测试，全部通过、零警告
```

- 新增/修改的行为必须有测试覆盖；修复 bug 时先写复现测试再修；
- 测试与被测模块同目录放置；
- 测试环境保持 `node`（**不引入 jsdom**），DOM 行为测试改为「纯函数 + 少量胶水」。

### 3. 每次变更必须同步写入交接文档

每次进行代码修改、内容更新或其他项目变更后，都**必须立即**将变更记录写入 `HANDOVER.md`（交接文档）第 9 节「变更记录」表格，**不得事后补记、不得批量合并补记**。

每条记录至少包含：

- **变更日期**
- **涉及的文件或模块**（精确到文件路径；配套的 commit 号一并给出）
- **变更内容摘要**（做了什么）
- **变更原因**（为什么做 / 谁要求的）

目的：让后续新开的对话会话（或接手的开发者）无需翻查 git 历史即可快速了解项目进展与上下文。

## 提交身份约定

本机 git 未配置 `user.name` / `user.email`，提交时必须使用一次性参数，**不得修改用户 git config**：

```bash
git -c user.name=weiyi251 -c user.email=3127459108@qq.com commit
```

## 其他重要约定（摘要）

- 代码内注释用英文；模块顶部写中文模块说明并注明对应文档章节；
- 中文 UI 文案统一进常量表；
- 未经批准不引入新第三方库；技术栈见 README「技术栈」表；
- 架构红线（高频坐标不进 React state、原生 Pointer Events、`transform-origin: 0 0` 等）见 `README.md` 与项目开发计划书 17.3 / 17.11 章；
- 发版流程见 `CONTRIBUTING.md`（`pnpm release`）。
