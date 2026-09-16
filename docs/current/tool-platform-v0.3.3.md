# Isla v0.3.3 第一梯队工具与组合边界

## 目标

本阶段参考 DSH 已验证的工具形态，为 Isla 补齐三个直接服务真实任务的能力：统一工具组合、项目文件发现、向用户提问。每个能力独立实现和验证，不复制 DSH 的完整工具框架。

## 实施顺序

### Batch A：静态工具组合

- 用一个组合入口创建当前会话的能力集合。
- 项目文件、项目发现、Web、用户交互分别保持独立 Capability。
- Tool Runtime 继续负责权限、批准、取消和错误归一化。
- Tool 错误码只维护一个事实源，协议层直接复用。

### Batch B：项目文件发现

- 新增 `glob_project({ pattern, path? })`，按 glob 查找工作区文件。
- 新增 `grep_project({ pattern, path?, include? })`，按正则查找匹配行。
- 使用 `@vscode/ripgrep` 提供跨平台二进制，通过参数数组直接启动，不经过 Shell。
- 所有路径仍受工作区沙箱约束；默认排除 Git 元数据、依赖目录、构建产物、Isla 本地状态和常见秘密文件。
- 返回稳定的工作区相对路径和行号，并对结果数、单行长度、总输出和执行时间设硬上限。

### Batch C：向用户提问

- 新增 `ask_user_question({ questions })`，用于模型在继续任务前获取缺失的用户选择或输入。
- 该能力与写入/网络 Approval 分离：Approval 回答“能不能做”，Question 回答“应该怎么做”。
- TTY 直接展示并等待回答；NDJSON 使用 `question_request` / `question_response` 事件配对。
- 提问仍属于当前 Turn，回答后从同一 Tool Call 继续；取消或输入断开必须结束等待。

## 采用、暂缓与拒绝

采用：Capability 分组、集中组合、稳定错误码、边界明确的工具输出、取消信号贯穿执行。

暂缓：按 Agent 动态裁剪工具、生命周期钩子、并行分类、后台 Job、LSP、MCP、Session 查询和计划任务。这些能力尚无 Isla 当前需求驱动。

拒绝：直接复制 DSH 的 Registry/Pipeline 目录结构或源码。Isla 保留现有 `ToolRegistry` 与 `ToolRuntime`，只增加当前真实工具所需的最小组合层。

## 完成信号

1. 组合器测试证明默认能力与可选能力只在一个入口装配。
2. 两个发现工具通过离线真实 ripgrep 测试，并完成一次真实模型工具调用评估。
3. 提问工具分别通过 TTY 与 NDJSON 的请求、回答、取消测试，并完成一次真实模型交互评估。
4. typecheck、全量测试、build、pack dry-run 与 `git diff --check` 全部通过。
