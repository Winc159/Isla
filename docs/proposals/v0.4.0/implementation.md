# v0.4.0 实施步骤

## 总原则

每个 Batch 必须独立可验证，完成一个再进入下一个。实现期间保持 Isla 可运行；不要顺手改造无关 Runtime。默认测试不得访问网络、启动真实浏览器或读取用户真实 Profile。

除非进入最终发布步骤，不提前修改 npm 版本、创建 tag、提交或推送。依赖选择前重新核对官方 MCP TypeScript SDK v2 的当前包名、Node 要求和稳定版本，并锁定精确版本。

## Batch A：官方 SDK 与 fixture 可行性尖峰

目标：只证明当前 Node/TypeScript/ESM 环境能完成 stdio discover、call、cancel、close。

1. 添加官方 SDK 的最小依赖，记录版本与选择依据。
2. 建立仓库内测试用 stdio MCP Server fixture，至少提供 echo、structured、slow、error、oversize 和 unsupported-content 工具。
3. 写 transport 级测试，验证 stdout 无杂讯、stderr 不混入协议、取消和关闭有界收敛。
4. 不接入 CLI、Profile 或 Agent Loop。

停点：如果 SDK、Node 版本或 ESM 方式不兼容，先更新设计并与用户确认，不能用自写 JSON-RPC 绕过。

## Batch B：Profile 与 resolved startup config

目标：把 MCP Server 集合纳入现有配置事实源。

1. 在 Profile schema 增加可选 `mcp.servers`，旧 Profile 保持兼容。
2. 实现 id、transport、command、args、cwd、timeout、required、env 的严格校验和安全默认值。
3. resolved config 冻结 Server 配置；配置摘要只显示安全字段。
4. 构造最小子进程环境并增加凭据 key 脱敏/剔除测试。
5. 不给 TTY 初次向导增加 MCP 问题；先支持用户手工编辑 Profile。

停点：旧 Profile、`--env` 开发入口和无 MCP 启动全部回归通过。

## Batch C：McpHost、连接与 catalog

目标：在应用上下文中拥有连接，原子产生稳定 tool catalog。

1. 实现 `McpHost`、`McpServerConnection`、状态投影和幂等 dispose。
2. required/optional Server 按设计处理；独立启动可并行，结果顺序确定。
3. 实现公开名规范化、hash、raw/public 映射、schema 校验、预算和整代回滚。
4. transport 关闭立即将工具撤架；不自动重连。
5. 在 Session Factory 构造前完成首次 catalog 冻结，避免一个 Model Step 中途变化。

停点：fixture 的成功、部分失败、冲突、超限、崩溃和关闭测试全部通过；尚不允许模型调用。

## Batch D：现有 Tool Runtime 桥接

目标：MCP Tool 像内置 Tool 一样经过 schema、Approval、取消和 Journal。

1. 实现 `McpToolAdapter`，默认 permission 为 `network`。
2. 参数校验使用现有 Tool path；不得发送不完整或未批准参数。
3. 将完整 `AbortSignal` 和 call timeout 传入连接。
4. 规范化 MCP 成功、`isError`、协议错误、transport 错误和稳定错误码。
5. 实现 text/structuredContent 投影、64 KiB 结果门禁和未支持内容失败。
6. 确认 `ModelRequestSnapshot.tools` 保存实际 MCP schema，Tool Call/Result 配对及 Completion Gate 不变。

停点：Fake Provider 能完成至少两步 Turn：选择 MCP Tool → 获得结果 → 输出最终回答；拒绝、取消和失败不产生伪成功。

## Batch E：TTY、NDJSON 与生命周期

目标：两个正式入口具有等价、可观察、可取消的 MCP 行为。

1. TTY 增加 `/mcp` 只读命令。
2. NDJSON 增加带请求 id 的 `mcp_list` 请求和对应结果事件；parser 对未知/非法字段稳定拒绝。
3. `ready.capabilities` 增加非敏感 `mcp` 位，保持旧消费者可忽略新增字段。
4. 普通退出、`exit`、EOF、第一次/第二次 Ctrl+C、启动失败都验证 Host 收敛。
5. `/new` 只新建 Session，不重启或更换 MCP Host。

停点：TTY 与 NDJSON 在相同配置下报告相同 Server 状态和工具身份；NDJSON stdout 仍保持纯协议。

## Batch F：安全、恢复与跨平台

目标：恶意或损坏 Server 不能扩大权限、泄密或挂住 Runtime。

1. 覆盖 prompt injection、虚假只读注解、敏感参数、stderr 秘密、恶意 schema、超长名称和超大结果。
2. 覆盖启动超时、call 超时、进程退出、半响应、取消不合作与晚到结果。
3. Windows 使用 `.cmd`/shell 解析时不得隐式启用 shell 字符串；命令和参数保持数组语义。
4. 在 Linux x64 与 macOS ARM64 跑 fixture stdio 验收，记录 Node/npm/架构与结果。
5. 运行既有全量门禁，证明无 MCP 配置时行为和 3.9 相同。

停点：`testing.md` 的 P0 全绿，evaluation 有可追溯证据。

## Batch G：MediaCrawler 互操作验收（显式、非默认）

前提：用户已在独立目录安装合法版本的 MediaCrawler 及独立 MCP wrapper，并确认平台账号、许可与网络行为。Isla 不负责下载安装。

1. 用隔离 Profile 配置该 stdio Server，不记录 env/凭据。
2. `/mcp` 确认 Server ready、公开名稳定、catalog 未超预算。
3. 执行一次低频关键词检索，验证结构化结果有界并保留帖子 URL/来源字段。
4. 让 Isla 基于结果生成一份带来源的简短情报摘要。
5. 测试取消一次慢调用；确认无孤儿子进程、无晚到结果写入 Session。

该 Batch 可在没有 MediaCrawler 的机器上跳过，不阻塞协议基座的离线 CI；但在宣称“MediaCrawler 可用”前必须完成并记录。

## 预期代码落点（供实现时校准）

建议新增 `src/mcp/`，将 config、host、connection、catalog、tool adapter、result projection 分开；测试对应放入 `tests/mcp/`。应用所有权应接入现有启动/Session Factory 边界，不能让 Provider 直接持有 MCP client，也不能让每个 Session 重复启动同一个 Server。

准确文件名可按当前职责调整，但若需要 Cordis、全局 event bus、动态插件系统、Session 大版本迁移或 Provider 接口重写，应视为设计偏离并先停下确认。

## 最终命令门禁

```bash
npm test
npm run typecheck
npm run build
npm run pack:check
git diff --check
```

还需运行 MCP 专项测试、fixture 进程泄漏检查，以及 Linux x64、macOS ARM64 的目标系统验收。任何真实网络/平台 smoke 必须显式开关，默认保持 skip。

