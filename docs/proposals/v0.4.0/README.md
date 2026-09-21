# v0.4.0：MCP Host Foundation

状态：已实现，进入目标系统验收与 v0.4.1 规划
日期：2026-09-21
主题：让 Isla 以 MCP Host 身份安全消费外部能力

## 为什么现在做

3.x 已完成 CLI、Session、Tool Loop、Approval、Sandbox、取消、NDJSON 与 PTY 的稳定收口。现实需求也已出现：通过 MediaCrawler 一类外部程序检索小红书、抖音等平台，后续还要接入邮件、下载与其他用户自建能力。继续为每个来源编写 Isla 私有适配器，会重复建设发现、schema、调用、取消、错误和权限边界。

MCP 因而成为 4.x 的第一个主题，但 4.0 不等于一次实现协议全部能力。v0.4.0 交付可独立验收的 Host 基座：配置本地 stdio Server、发现 tools、稳定命名、经过现有 Approval/Tool Runtime 调用、约束结果并正确管理子进程。后续 4.x 在同一边界上增加远程传输、认证、resources、prompts 和 tasks。

## 方向定义

- NDJSON/PTY 是外部程序控制 Isla 的入站协议。
- MCP 是 Isla 调用外部能力的出站协议。
- Isla 在 v0.4.0 只作为 MCP Host/Client，不作为 MCP Server。
- MCP Server 是不可信能力提供者；其描述、schema、注解、instructions 和结果都不能成为授权来源。
- 使用官方 TypeScript SDK，不自行实现 JSON-RPC/MCP wire protocol。
- MediaCrawler 是第一个互操作目标，不是 Isla 的依赖、内置爬虫或 npm 包内容。

## v0.4.0 完成范围

1. Profile 中声明零个或多个本地 stdio MCP Server；启动后配置冻结。
2. 每个 Server 建立独立连接，完成工具发现并生成原子 catalog generation。
3. 公开工具名采用 `mcp__<server-id>__<tool-name>`；协议调用始终使用单独保存的原始名称。
4. MCP Tool 通过现有 `ToolRegistry`、`ToolRuntime`、Approval、取消和 Journal 路径执行。
5. 默认将 MCP Tool 视为 `network` 权限；只有用户本地 Profile 的显式策略可以调整，Server 注解不能降权。
6. 支持有界文本和 JSON `structuredContent`；其他内容块明确报不支持，不静默丢失。
7. required/optional Server 启动语义、超时、崩溃撤架、关闭收敛和安全诊断完整可测。
8. TTY `/mcp` 与 NDJSON `mcp_list` 提供只读状态和 catalog 检查，不支持运行中增删 Server。
9. 默认测试全部离线，使用仓库内受控 stdio fixture；真实 MediaCrawler 验证为显式、可跳过验收。

## 明确不在 v0.4.0

- Streamable HTTP、OAuth、远程 Server 和公网注册中心。
- MCP resources、resource templates、prompts、tasks、sampling、elicitation 或 apps。
- Isla 作为 MCP Server。
- 自动下载、`npx -y` 安装、自动升级或自动信任第三方 Server。
- 动态配置、热重载、自动重连、后台常驻 Job、并行 Tool 或子 Agent。
- 把 Server instructions 自动拼入 system prompt。
- 在 Isla 仓库或 npm 包中捆绑 MediaCrawler、浏览器数据、Cookie 或账号状态。

## 文档入口

- [设计与契约](design.md)
- [实施步骤](implementation.md)
- [测试矩阵](testing.md)
- [验收记录模板](evaluation.md)

实现前先读 `AGENTS.md`、`docs/current/`、`docs/dsh-reference-review.md` 和本目录全部文档。若实现需要改变这里的核心边界，应先停下与用户确认并同步文档。
