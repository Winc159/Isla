# Isla 当前实现导航

本文用于从改动意图定位到源码、测试和必须同步的文档，不是历史执行计划。

## 启动与装配

1. `src/cli.ts` 是可执行入口和 TTY/NDJSON 分流点。
2. `src/cli-args.ts` 解析 `--profile`、`--config`、`--env`、`--protocol`、`--workspace` 和 `--models`。
3. `src/main.ts` 通过 `ConfigStore` 加载 Config/Profile；只有显式 `--env` 才走兼容环境变量配置，并创建 Provider 与 MCP Host。
4. `src/application.ts` 创建 Session Store、Memory Runtime 和诊断汇聚。
5. `src/session-factory.ts` 组装 workspace 级依赖并为当前 StoredSession 创建 `ChatSession`。

## 关键源码索引

| 改动 | 主要入口 | 重点测试 |
|---|---|---|
| CLI 参数或文本交互 | `src/cli.ts`、`src/cli-args.ts`、`src/cli/` | `tests/cli*.test.ts`、`tests/cli/`、`tests/pty/` |
| Config/Profile | `src/config.ts`、`src/config-store.ts` | `tests/config*.test.ts`、`tests/cli/config-command.test.ts` |
| Session 创建和恢复 | `src/session-factory.ts`、`src/session-store.ts`、`src/session-query.ts` | `tests/session-store*.test.ts`、`tests/session-query.test.ts` |
| Agent Loop/终态 | `src/core/session.ts`、`src/core/model-step.ts`、`src/core/completion-gate.ts` | `tests/core/agent-loop.test.ts`、`completion-gate.test.ts`、`session.test.ts` |
| Context/Token 预算 | `src/core/context.ts`、`token-budget.ts`、`tool-result-pruner.ts` | 对应 `tests/core/*` |
| Capability 路由 | `src/capability-catalog.ts`、`src/capability-routing.ts`、`src/capabilities.ts` | `tests/capability-*.test.ts` |
| Tool | `src/tools/types.ts`、`composition.ts`、`runtime.ts`、具体 Tool 文件 | `tests/tools/`、`tests/core/tool-runtime.test.ts` |
| MCP | `src/mcp/` | `tests/mcp-*.test.ts`、`tests/smoke/mcp-interoperability.test.ts` |
| Browser | `src/browser/`、`src/tools/browser.ts` | `tests/browser-*.test.ts`、`tests/playwright-browser-adapter.test.ts` |
| Memory | `src/memory/` | `tests/memory/` |
| Approval/Sandbox | `src/approval/`、`src/sandbox/policy.ts` | `tests/approval/`、`tests/sandbox.test.ts` |
| NDJSON | `src/protocol/` | `tests/protocol*.test.ts`、`tests/protocol-*.e2e.test.ts` |
| Resident Host | `src/host.ts`、`src/host-client.ts` | `tests/host.test.ts` |

## 扩展 Provider

实现 `src/core/types.ts` 中的 Provider 契约，在 `src/providers/` 中完成请求/响应映射、取消、错误和能力声明，再在 `src/main.ts` 注册。Provider 不应读取 CLI 状态或直接持久化 Session。至少同步 fixture 单测、Runtime 能力测试、Config/Profile 校验和本文档；真实网络测试必须显式开启。

## 扩展 Capability 或 Tool

先在 `src/tools/` 实现最小 Tool，声明 schema、permission、取消与有界输出；由 `src/tools/composition.ts` 组合为 `ToolCapability`。若需要动态发现，通过 `createCapabilityProvider` 注册 manifest，明确稳定 ID、关键词、风险、生命周期和 requirements。

必须验证：Profile policy、Catalog availability、确定性预选、逐 Step Snapshot、Tool Runtime、Sandbox、Approval、Journal、协议事件和完成门禁。`capability_activate` 只能影响下一 Model Step，不能直接执行目标 Tool。

## 增加 MCP 能力

MCP Server 只能来自 Profile 的 `mcp.servers`。配置解析在 `src/config.ts` 和 `src/mcp/profile-config.ts`，进程与协议在 `src/mcp/stdio-client.ts`，目录与 Tool 投影在 `src/mcp/catalog.ts`、`src/mcp/tool.ts`、`src/mcp/host.ts`。新行为必须保留稳定限定名、原子目录、schema/输出预算、取消、子进程关闭和不可信内容边界。

## Session 与协议修改

Session schema 修改从 `src/session-store.ts` 开始，必须提供旧版本读取和迁移测试；模型输入投影修改同时检查 `src/core/session.ts`、`context.ts`、`request-snapshot.ts` 和 Journal。协议修改集中在 `src/protocol/types.ts`、`parser.ts`、`runner.ts`、`writer.ts`，需要验证每个请求只有一个明确终态，stdout 只含 NDJSON，诊断只写 stderr。

## Browser、Memory 与 Approval

- Browser：运行状态在 `src/browser/runtime.ts`，平台适配在 `playwright-adapter.ts`，人工接管在 `console-server.ts`，凭据边界在 `vault.ts` 和 `credential-approval.ts`。
- Memory：`manager.ts` 负责策略编排，`store.ts` 负责 SQLite，`search.ts` 和 `embeddings.ts` 负责检索；Memory 失败应可降级。
- Approval：`src/approval/service.ts` 执行策略，`cli-approval.ts` 提供 TTY 交互，`src/protocol/approval.ts` 提供协议桥接；批准 ID、取消和拒绝必须可收敛。

## 常见同步清单

改动后按影响同步：

- 用户入口：根 `README.md`、`docs/current/README.md`；
- 架构契约：`architecture.md`、`decisions.md`；
- 测试或脚本：`testing.md`、`package.json`、CI；
- 版本能力：`docs/roadmap.md` 和对应 proposal/evaluation；
- Session/Config schema：兼容测试和隐私说明；
- Tool/Capability：Catalog、路由、权限、协议与完成门禁测试。

不要从旧 proposal 复制实现步骤作为当前事实；先核对代码和测试。
