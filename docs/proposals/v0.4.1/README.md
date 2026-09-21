# v0.4.1：MCP Usability and Interoperability

状态：设计完成，待确认后实施
日期：2026-09-21
主题：让个人用户能够配置、诊断并真实使用本地 MCP Server

## 为什么继续做

v0.4.0 已建立本地 stdio MCP Host、工具发现、Tool Runtime 桥接、Approval、取消和生命周期边界，但配置仍主要依赖手工编辑 JSON，状态输出也偏向开发者。协议基座已经存在，下一步应证明普通用户能安全完成“添加 Server → 检查 → 重启生效 → 在对话中调用”的完整路径。

v0.4.1 不扩展 MCP 协议面，而是补齐配置和诊断体验，并使用一个独立发布、无需账号的第三方 stdio MCP Server 完成真实互操作验收。MediaCrawler 仍是后续专项，不作为本版完成条件。

## 完成范围

1. `/mcp` 保留当前运行态摘要，并增加安全、可理解的诊断信息。
2. `/mcp config` 显示当前 Profile 的 MCP 配置摘要，不显示 env 值或其他秘密。
3. `/mcp setup` 通过交互向导添加、修改或删除本地 stdio Server；写入 Config/Profile，统一标记为下次启动生效。
4. `/mcp check [server-id]` 检查当前启动 generation 的连接、catalog 和错误状态，不另起探测进程。
5. TTY 与 NDJSON 保持相同的只读诊断事实；NDJSON 不提供配置写入口。
6. 使用独立第三方 stdio MCP Server 和隔离临时目录完成 discover、call、cancel、close 验收。
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

## 文档入口

- [设计与契约](design.md)
- [实施步骤](implementation.md)
- [测试矩阵](testing.md)
- [验收记录](evaluation.md)

