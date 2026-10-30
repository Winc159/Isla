# Isla Roadmap

Isla 的目标是成为长期运行、贴合个人习惯的完整 Agent 产品。个人定位不等于削减 Agent 基础设施；Web UI、Plan/Act、审批、MCP、后台任务、受管执行环境和可恢复协议属于产品基线。长期架构见 [agent-platform-baseline.md](./agent-platform-baseline.md)。

## 当前能力

- TypeScript + Node.js 24 单包 Runtime。
- OpenAI、DeepSeek、Bailian 和 OpenAI-compatible Local Provider。
- 持久 Session、Memory、Agent Loop、Tool、Capability、MCP、Browser 和 Web 能力。
- Resident Host 持有长期 Runtime；CLI 是 Host 客户端。
- `isla <问题>` 恢复当前 workspace 最近会话；`--new` 创建新会话。
- 远程交互 CLI 可实时显示模型文本、安全 Tool 阶段，执行远程 Approval/User Question，并按 `sessionId + turnId` 精确取消。
- `/sessions`、`/memory`、`/trace`、`/context` 由 Host 提供有界查询；CLI 不直接读取 Host 持久化数据。
- Resource Service 独立处理下载、归档、整理和可选 Worker 推理；Resident Host 通过六个受限 Tool 管理现有 Job，Resource SQLite 保持状态事实源。
- Linux systemd user service 管理 Host 与 Resource。

## 近期

1. v0.7.0：Runtime Kernel，建立 Service/Scope/Effect 和 Agent 生命周期。
2. v0.7.1：Event Session 与可恢复 App Server 协议。
3. v0.7.2：分类审批、长命令、受管依赖和执行环境（已完成；真实通用执行闭环 92/100）。
4. v0.7.3：真正的 Plan/Act 与 Workspace Checkpoint（已完成；实现和验收记录见版本计划）。
5. v0.7.4：Plan 步骤进度/证据、有界重规划、Checkpoint 差异与 Session 恢复闭环（已完成；自动验收 712 通过，真实对话 100/100）。
6. v0.8.0.0：主 Agent Web UI。
7. v0.8.1.0：评估、安全与发布门禁。
8. v0.8.2：完整 MCP Client（本地实现/自动验收及真实 Provider 复合任务已收口；stdio/Streamable HTTP、Tools/Resources/Prompts、list_changed、Form Elicitation、OAuth loopback/回调与私有凭据存储、独立 JSON-RPC peer、官方 Filesystem Server interop、Node 24 全量验证、npm pack，以及默认百炼 `qwen3.5-plus-2026-02-15` 三轮真实任务 `100/100/100` 均有通过证据。整体仍暂缓：公网 HTTPS OAuth 反向代理部署、当前未提交工作树的三平台 CI、Linux WSL 与 macOS ARM64 原生证据尚缺。不得标记版本完成）。
9. v0.8.3：Persistent Job 与受限 Subagent。

## 中期

- MCP HTTP/OAuth/resources/prompts/elicitation 和热重载。
- 通用持久 Job、一层受限 Subagent、通知订阅和后台执行。
- Memory 的个人偏好提取、修订、来源和可解释检索。
- Windows、macOS ARM64、Linux x64 的执行环境和发布门禁。

## 暂缓

- 多租户、公网 Host、通用 SaaS 控制台。
- 无边界 Agent Team、任意递归 Subagent、公共插件市场。
- Session 内未经记录的隐式 Provider/模型切换。
- 分布式多租户调度和公共 SaaS 控制面。
