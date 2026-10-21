# Isla 当前实现导航

本文用于从改动意图定位到源码、测试和必须同步的文档，不是历史执行计划。

## 启动与装配

1. `src/entrypoints/cli.ts` 分流远程 CLI、服务管理、显式本地模式和 NDJSON。
2. `src/client/` 提供快速提问、交互式 Host 客户端和参数解析。
3. `src/runtime/bootstrap.ts` 通过 `ConfigStore` 加载 Config/Profile，并创建 Provider 与 MCP Host。
4. `src/runtime/application.ts` 创建 Session Store、Memory Runtime 和诊断汇聚。
5. `src/runtime/session-factory.ts` 组装 workspace 级依赖并创建 `ChatSession`。
6. `src/entrypoints/host.ts` 启动正式 Resident Host，并绑定可选的独立 Worker Profile。
7. `src/config/local-runtime.ts` 生成仅限本机的 Host/Resource loopback 地址和令牌。

Resource 使用另一条启动路径：`src/entrypoints/resource.ts` 自动创建或加载只含用户目录设置的 `resource.json`，派生内部配置后装配 Resource Service。Resource 只通过 Resident Host HTTP 契约使用 Worker。

## 关键源码索引

| 改动 | 主要入口 | 重点测试 |
|---|---|---|
| CLI 参数或文本交互 | `src/entrypoints/cli.ts`、`src/client/`、`src/cli/` | `tests/cli*.test.ts`、`tests/cli/`、`tests/remote-cli.test.ts` |
| Config/Profile | `src/config/` | `tests/config*.test.ts`、`tests/profile-selection.test.ts`、`tests/cli/config-command.test.ts` |
| Session 创建和恢复 | `src/runtime/session-factory.ts`、`src/sessions/` | `tests/session-store*.test.ts`、`tests/session-query.test.ts` |
| Agent Loop/终态 | `src/core/session.ts`、`src/core/model-step.ts`、`src/core/completion-gate.ts` | `tests/core/agent-loop.test.ts`、`completion-gate.test.ts`、`session.test.ts` |
| 请求消息投影 | `src/core/request-message-projection.ts`、`src/core/context.ts` | `tests/core/request-message-projection.test.ts`、`context.test.ts`、`session.test.ts` |
| 回合取消与错误映射 | `src/core/turn-failure.ts`、`src/core/errors.ts` | `tests/core/turn-failure.test.ts`、`errors.test.ts`、`session.test.ts` |
| Session 持久化快照 | `src/core/session-persistence.ts` | `tests/core/session-persistence.test.ts`、`session.test.ts`、`journal-actions.test.ts` |
| Tool Result 消息整理 | `src/core/tool-result-message.ts`、`src/core/tool-result-pruner.ts` | `tests/core/tool-result-message.test.ts`、`tool-result-pruner.test.ts`、`session.test.ts` |
| Context/Token 预算 | `src/core/context.ts`、`token-budget.ts`、`tool-result-pruner.ts` | 对应 `tests/core/*` |
| Capability 路由 | `src/capabilities/` | `tests/capability-*.test.ts` |
| Tool | `src/tools/types.ts`、`composition.ts`、`runtime.ts`、具体 Tool 文件 | `tests/tools/`、`tests/core/tool-runtime.test.ts` |
| MCP | `src/mcp/` | `tests/mcp-*.test.ts`、`tests/smoke/mcp-interoperability.test.ts` |
| Browser | `src/browser/`、`src/tools/browser.ts` | `tests/browser-*.test.ts`、`tests/playwright-browser-adapter.test.ts` |
| Memory | `src/memory/` | `tests/memory/` |
| Approval/Sandbox | `src/approval/`、`src/sandbox/policy.ts` | `tests/approval/`、`tests/sandbox.test.ts` |
| NDJSON | `src/protocol/` | `tests/protocol*.test.ts`、`tests/protocol-*.e2e.test.ts` |
| Resident Host | `src/entrypoints/host.ts`、`src/host/`、`src/client/host-client.ts` | `tests/host.test.ts`、`tests/local-runtime-config.test.ts` |
| Worker Profile 与结构化推理 | `src/runtime/bootstrap.ts`、`src/host/server.ts`、`src/resource/inference.ts` | `tests/config-selection.test.ts`、`tests/resource/host-inference.test.ts` |
| Resource 启动与配置 | `src/entrypoints/resource.ts`、`src/resource/config.ts`、`src/resource/settings.ts` | `tests/resource/contracts.test.ts`、`tests/resource/settings.test.ts` |
| Resource API、Job 与 Web 工具台 | `src/resource/service.ts`、`src/resource/database-schema.ts`、`src/resource/web-ui.ts` | `tests/resource/service.test.ts`、`tests/resource/database-schema.test.ts` |
| Resource 调度、下载与归档 | `src/resource/scheduler.ts`、`baidu-download-runner.ts`、`archive-organizer.ts` | `tests/resource/scheduler.test.ts`、`baidu-download-runner.test.ts`、`archive-organizer.test.ts`、`mock-e2e.test.ts` |
| Resource Worker 客户端与窄任务 | `src/resource/inference-client.ts`、`title-worker.ts`、`content-worker.ts`、`naming.ts` | `tests/resource/inference-client.test.ts`、`title-worker.test.ts`、`content-worker.test.ts`、`worker-production-gap.test.ts` |

## 扩展 Provider

实现 `src/core/types.ts` 中的 Provider 契约，在 `src/providers/` 中完成请求/响应映射、取消、错误和能力声明，再在 `src/runtime/bootstrap.ts` 注册。

## 扩展 Capability 或 Tool

先在 `src/tools/` 实现最小 Tool，声明 schema、permission、取消与有界输出；由 `src/tools/composition.ts` 组合为 `ToolCapability`。若需要动态发现，通过 `createCapabilityProvider` 注册 manifest，明确稳定 ID、关键词、风险、生命周期和 requirements。

必须验证：Profile policy、Catalog availability、确定性预选、逐 Step Snapshot、Tool Runtime、Sandbox、Approval、Journal、协议事件和完成门禁。`capability_activate` 只能影响下一 Model Step，不能直接执行目标 Tool。

## 增加 MCP 能力

MCP Server 只能来自 Profile 的 `mcp.servers`。Capability policy schema 在 `src/capabilities/profile-schema.ts`，其余 MCP 行为集中在 `src/mcp/`。

## Session 与协议修改

Session schema 修改从 `src/sessions/store.ts` 开始，必须提供旧版本读取和迁移测试；模型输入投影修改同时检查 `src/core/session.ts`、`context.ts`、`request-snapshot.ts` 和 Journal。

## Browser、Memory 与 Approval

- Browser：运行状态在 `src/browser/runtime.ts`，平台适配在 `playwright-adapter.ts`，人工接管在 `console-server.ts`，凭据边界在 `vault.ts` 和 `credential-approval.ts`。
- Memory：`manager.ts` 负责策略编排，`store.ts` 负责 SQLite，`search.ts` 和 `embeddings.ts` 负责检索；Memory 失败应可降级。
- Approval：`src/approval/service.ts` 执行策略，`cli-approval.ts` 提供 TTY 交互，`src/protocol/approval.ts` 提供协议桥接；批准 ID、取消和拒绝必须可收敛。

## 修改 Resource 或 Worker

Resource Job、Scheduler、文件处理和 Web 工具台集中在 `src/resource/`，不应移入 `ChatSession` 或主 Agent Loop。新增 Resource 行为先确认其 Job stage、持久化、取消、人工决策、受管目录和真实文件验证边界。

Worker 只允许通过 `src/resource/contracts.ts` 中已定义的结构化任务扩展。修改时必须同时检查 Host 装配、Worker Profile 选择、请求/响应上限、事实一致性校验、规则优先级和失败降级。不得让 Worker 直接读取文件、执行 Tool、持有会话或调用 primary Profile 兜底。

Web 命名需要保持区分：`src/web/` 是主 Agent 的联网访问能力；`src/resource/web-ui.ts` 是 Resource 工具台页面。当前没有可承载主对话的 Web UI，不能把 Resource 页面当作通用前端入口。

## 常见同步清单

改动后按影响同步：

- 用户入口：根 `README.md`、`docs/operations.md`；
- 架构契约：`architecture.md`、`decisions.md`；
- 测试或脚本：`testing.md`、`package.json`、CI；
- 版本能力：`docs/roadmap.md` 和对应 proposal/evaluation；
- Session/Config schema：兼容测试和隐私说明；
- Tool/Capability：Catalog、路由、权限、协议与完成门禁测试。

不要从旧 proposal 复制实现步骤作为当前事实；先核对代码和测试。
