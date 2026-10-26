# Isla v0.8.1：完整 MCP Client

## 设计目标

将 MCP 从“本地 stdio tools”扩展为可管理、可认证、可审计的完整客户端，同时保持 MCP 不是信任边界。

## 范围

- Transport：stdio、Streamable HTTP；SSE 仅兼容旧 Server。
- Primitive：tools、resources、resource templates、prompts、elicitation。
- Auth：OAuth discovery、PKCE、token refresh、credential vault。
- Lifecycle：lazy start、health、retry/backoff、hot reload、graceful shutdown。
- Policy：server/tool/resource allow/deny、每类调用 Approval、结果预算和 secret redaction。

## 实施步骤

1. 升级 MCP 配置 schema 和迁移器。
2. 抽象 Transport，保留现有 stdio Adapter。
3. 实现 HTTP/SSE Adapter 和取消。
4. 实现 OAuth 状态机与 loopback callback。
5. 接入 resources/prompts/elicitation。
6. Catalog 缓存、懒启动、健康状态和热重载。
7. CLI/Web 管理和诊断。

## 自动测试

- 各 Transport fake server 合同测试。
- OAuth state/PKCE/refresh/过期/拒绝/重启恢复。
- 恶意 schema、超大结果、提示注入和重定向。
- 配置热重载期间的在途调用、关闭和回滚。
- MCP Approval 与 Sandbox 独立，不得因一个 auto-approve 绕过另一个。

## 真实验收

- 连接一个 stdio Server 和一个 HTTP OAuth Server。
- 列出并读取 Resource、使用 Prompt、执行 Tool、处理 elicitation。
- 重启 Host 后凭据安全恢复；撤销连接后立即失效。
- Server 故障只降级对应 Capability。

## 完成条件

- stdio 与 Streamable HTTP 通过同一 MCP 合同测试。
- tools、resources、prompts 和 elicitation 可在 CLI/Web 中使用。
- OAuth 凭据可刷新、撤销且不会进入 Session 或普通日志。
- MCP 调用不能绕过 Isla Approval、Sandbox 和结果预算。
