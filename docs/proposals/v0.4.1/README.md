# v0.4.1：MCP Usability and Interoperability

状态：核心验收通过并已收口，跨平台环境验收后置
日期：2026-09-21
主题：让个人用户能够配置、诊断并真实使用本地 MCP Server

## 为什么继续做

v0.4.0 已建立本地 stdio MCP Host、工具发现、Tool Runtime 桥接、Approval、取消和生命周期边界。仓库中也已有 `/mcp config`、`/mcp check`、`/mcp setup`、安全诊断投影和 Profile MCP 配置辅助函数的初版，但它们尚未满足本提案的完整交互、并发、安全和验收契约。

v0.4.1 的工作不是重新建设 MCP Host，也不是立即扩展具体 Connector，而是收敛已有实现，证明普通用户能安全完成“添加 Server → 检查 → 重启生效 → 在对话中调用”的完整路径。

v0.4.1 不扩展 MCP 协议面，而是补齐配置和诊断体验，并使用一个独立发布、无需账号的第三方 stdio MCP Server 完成真实互操作验收。MediaCrawler 仍是后续专项，不作为本版完成条件。

## 完成范围

1. `/mcp` 保留当前运行态摘要，并增加安全、可理解的诊断信息。
2. `/mcp config` 显示当前 Profile 的 MCP 配置摘要，不显示 env 值或其他秘密。
3. `/mcp setup` 通过交互向导添加、修改或删除本地 stdio Server；以向导开始时的 revision 为并发基线，写入 Config/Profile 后统一标记为下次启动生效。
4. `/mcp check [server-id]` 检查当前启动 generation 的连接、catalog 和错误状态，不另起探测进程。
5. TTY 与 NDJSON 保持相同的只读诊断事实；NDJSON 不提供配置写入口。
6. 使用独立发布的第三方 stdio MCP Server 和隔离临时目录完成 discover、call、cancel、close 验收；仓库 fixture 只承担离线回归，不能作为第三方互操作证据。
7. 更新 README、示例配置、故障排查和目标系统验收记录。

## 明确不在 v0.4.1

- Streamable HTTP、SSE、OAuth、远程 Server 或注册中心。
- MCP resources、prompts、tasks、sampling、elicitation 或 apps。
- 运行中热重载、自动重连、后台健康轮询或 watcher。
- 自动下载、自动执行 `npx -y`、自动安装 Python/npm 依赖或自动升级 Server。
- 把命令和参数合并为 shell 字符串；继续保持 executable + argv 数组语义。
- Isla 作为 MCP Server、并行 Tool、子 Agent 或通用插件市场。
- MediaCrawler、浏览器登录、Cookie 管理、手机模拟或真实社交平台抓取。

## 用户完成路径

```text
/mcp setup
  -> 选择 add/edit/remove
  -> 预览脱敏配置
  -> 确认并原子保存
  -> 提示“下次启动生效”
重启 Isla
/mcp check
  -> 确认 Server ready 与公开工具
普通对话
  -> Approval
  -> MCP Tool
  -> 最终回答
```

日常使用不要求用户记测试命令。开发验收统一运行 `npm run verify`；真实第三方互操作由单独脚本显式运行，默认测试不联网、不下载包。

## 当前实现审计基线

截至 2026-09-21：

- 已有：MCP Host、stdio client、能力目录、Approval、结果限制、安全诊断投影、`/mcp`、`/mcp check`、`/mcp config` 和 `/mcp setup` 初版。
- 已验证：Profile MCP 配置摘要、配置保存、诊断测试、PTY setup、真实 Filesystem MCP smoke 测试。
- 已收敛：完整 setup 字段、敏感 env 分类、向导开始 revision 的并发保护、启动配置指纹，以及显式外部 Server smoke 入口。
- 核心验收已闭合：Windows 用户路径、PTY setup、配置诊断和官方 Filesystem Server 互操作均已验证。
- 外部环境验收：Linux x64、macOS ARM64 和特定第三方 Server cancel 行为需要对应实机、CI 或具备可取消长调用的 Server，作为后续发布环境验收，不阻塞本地核心 4.1。
- 版本事实：`package.json` 当前仍为 `0.3.9`；本提案完成前不修改版本。

## 文档入口

- [设计与契约](design.md)
- [实施步骤](implementation.md)
- [测试矩阵](testing.md)
- [验收记录](evaluation.md)
