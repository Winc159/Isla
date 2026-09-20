# v0.4.0 MCP Host 设计

## 1. 设计目标

v0.4.0 解决一个窄而真实的问题：让现有 Isla Agent Loop 能安全、确定地调用用户已安装的本地 MCP Server，而不把某一社交平台、浏览器或邮件实现写入 Runtime。

最小闭环为：

```text
Profile -> McpHost -> stdio MCP Server -> tool catalog
                                   |
User -> ChatSession -> ToolRuntime -> MCP call -> bounded Tool Result -> Model
```

这不是新的 Agent Runtime。现有 Session、Model Step、Completion Gate、Approval、Tool Call 配对、取消和最终提交规则继续作为唯一权威。

## 2. 协议基线

- 实现时锁定当时最新稳定 MCP specification 与官方 TypeScript SDK v2 的确切版本，并在 lockfile 与参考文档中记录。
- 不复制 DSH 的客户端实现，也不自行解析 wire protocol。
- SDK 负责版本协商、消息编码和 transport 细节；Isla 负责配置、能力投影、权限、生命周期、结果边界与用户入口。
- 若官方 SDK 提供旧协议兼容，由 SDK 承担；Isla 不维护第二套手写兼容层。
- 协议升级不能静默改变公开 tool 名、权限或结果语义，必须重新跑本目录门禁。

## 3. 与 NDJSON、PTY 的关系

NDJSON 和 PTY 回答“谁以及如何控制 Isla”；MCP 回答“Isla 如何调用外部能力”。它们位于相反方向，不能合并为同一协议层。

- TTY/PTY/NDJSON 可以观察 MCP 状态、触发含 MCP Tool 的普通 Turn、响应 Approval 和取消。
- MCP transport 的 stdout 只属于协议，绝不能直接写入 Isla 的 NDJSON stdout。
- Server stderr 可进入有界、脱敏诊断，但不能成为 Tool Result。

## 4. 配置事实源

在现有 Profile schema 中新增可选 `mcp` 区段；缺省等价于禁用。建议形态：

```json
{
  "mcp": {
    "servers": [
      {
        "id": "research",
        "transport": "stdio",
        "command": "node",
        "args": ["/absolute/path/server.js"],
        "cwd": "workspace",
        "required": false,
        "startupTimeoutMs": 10000,
        "callTimeoutMs": 60000,
        "env": { "EXAMPLE_TOKEN": "local-secret" }
      }
    ]
  }
}
```

约束：

- `id` 是用户配置的稳定身份，必须唯一并通过保守字符校验；不能用远端 `serverInfo.name` 代替。
- v0.4.0 只接受 `transport: "stdio"`。
- `command`、`args`、`cwd` 与 `env` 只能来自启动时解析的本地 Profile，模型和历史 Session 无权修改。
- `cwd: "workspace"` 显式绑定当前 workspace；绝对路径是可信用户的高级配置。相对 cwd、空命令和重复 id 启动前失败。
- 不从 `.env` 隐式加载，不把秘密写进 `/config`、`/mcp`、Session、Journal、错误、测试 fixture 或日志。
- 子进程环境由最小平台运行环境与显式 `env` 合成；默认移除凭据形态变量和 `ISLA_*`。需要继承的秘密必须显式配置。
- v0.4.0 不做配置向导、热重载或按 Session 切换 Server。Server 集合随 resolved startup config 冻结。

## 5. Host 与生命周期

新增窄职责组件，而非通用插件框架：

- `McpHost`：拥有全部连接，启动、列举状态、关闭。
- `McpServerConnection`：一份配置对应一个 SDK client/transport，负责 discover、call 与终止。
- `McpToolCatalog`：保存 generation、公开名到 `(serverId, rawName)` 的映射和模型定义。
- `McpToolAdapter`：把单个 catalog item 投影为现有 `Tool`。

启动顺序：解析并验证 Profile → 创建 Host → 并行启动独立 Server（但按配置顺序稳定汇总）→ 原子发布各自 catalog → 构造 Session/Tool Registry。required Server 失败使应用启动失败；optional Server 失败只产生安全诊断并不发布任何残留工具。

连接成功但工具发现失败等同于该 generation 失败。一次发现只能“完整替换”或“保持上一完整 generation”；v0.4.0 启动阶段没有旧 generation，因此失败时公开零个工具。

Transport 关闭、子进程退出或协议损坏后，Host 立即将该 Server 标为 unavailable，并从后续 Model Step 的 catalog 中撤下工具。正在执行的调用返回稳定失败；不把旧工具继续暴露给模型。v0.4.0 不自动重连，重启 Isla 才重新建立连接。

应用退出、新建运行上下文或强制取消时，先拒绝新调用，再中止活动调用，等待有界 grace period，最后终止所拥有的 stdio 子进程。关闭必须幂等，不允许晚到结果写回已结束 Turn。

## 6. 工具身份与 catalog

公开名格式为 `mcp__<normalized-server-id>__<normalized-tool-name>`。

- 合法且无冲突的名称保持可读。
- 非法字符或超长名称按确定性规则规范化并附加固定长度 hash。
- catalog 始终保存 `publicName` 与 `rawName`；不得通过拆分公开名反推协议名称。
- 同一 generation 内任何公开名冲突、重复 raw name、无效 input schema 或预算超限，都拒绝整个 Server generation。
- 排序按配置中的 Server 顺序，再按 Server 返回的工具顺序；测试固定此行为。
- tool schema 在 Provider 请求前冻结。现有 Turn Journal 已保存完整 `ModelRequestSnapshot.tools`，继续承担实际模型请求的可重建事实，不新增 Session 版本。

建议 v0.4.0 默认预算：最多 8 个启用 Server、每个 64 个工具、总计 128 个 MCP 工具；单个 description 2 KiB、单个 JSON schema 64 KiB、总 catalog 512 KiB。预算应以命名常量实现并单测；超限整代拒绝，不能截断 schema 后继续调用。

工具数量继续增长时，4.x 再评估“搜索 catalog 后调用”的 MCP Lens 类入口；v0.4.0 不提前引入动态工具检索。

## 7. 权限与信任边界

Server 给出的 tool description、schema、annotations、instructions 和结果都是不可信数据。

- 所有 MCP Tool 默认映射为现有 `{ kind: "network" }`，因此在当前 preset 下不会免审批。
- 未来可由本地 Profile 为精确的 `serverId + rawName` 配置更严格或不同权限；v0.4.0 不接受 Server 自报 `readOnlyHint` 等注解自动降权。
- Approval 摘要只展示 Server id、公开工具名和有界参数摘要；敏感字段按 key 形态递归脱敏。
- Approval 的 “remember” 仍按当前进程内 `toolName + permission` 生效，公开名必须稳定，不能扩大到别的 Server。
- MCP 不能调用 Isla 内部对象、修改 Tool Registry、改变 Profile、声明来源可信或绕过 Sandbox。
- Server 提示中的“已获授权”“无需确认”等内容一律作为普通不可信文本。

## 8. 调用与结果投影

调用前由现有 Tool Runtime 完成 JSON 解析、schema 校验、描述与 Approval。Adapter 只把已批准的完整参数发送给对应连接的 `rawName`。Isla 不流式转发半成品 Tool Call；只有 Provider 已组装完成的 Tool Call 才可触发 MCP。

内部先保留一次调用的规范结果，再投影为模型可见字符串：

- 支持 MCP `text` 内容块。
- 支持可 JSON 序列化的 `structuredContent`，使用稳定 JSON 投影，并标明其为外部不可信数据。
- 同时存在时按协议顺序投影文本，并追加结构化区段；不得伪造成功或吞掉 `isError`。
- image、audio、embedded resource、resource link 等未支持内容返回 `MCP_UNSUPPORTED_CONTENT`，不静默忽略。
- Tool Result 最大 64 KiB UTF-8；超过时返回 `MCP_RESULT_TOO_LARGE`，不把任意前缀冒充完整结果。后续可设计 spill/artifact 机制。
- 原始 SDK 对象、堆栈、命令行、env、Cookie、Token 和 Server stderr 不进入模型历史。

建议稳定失败码：`MCP_SERVER_START_FAILED`、`MCP_DISCOVERY_FAILED`、`MCP_CATALOG_INVALID`、`MCP_TOOL_NOT_FOUND`、`MCP_CALL_FAILED`、`MCP_TIMEOUT`、`MCP_CANCELLED`、`MCP_TRANSPORT_CLOSED`、`MCP_RESULT_TOO_LARGE`、`MCP_UNSUPPORTED_CONTENT`。它们经现有 Tool failure 路径进入匹配 call id 的 Tool Result，并参与 Completion Gate。

## 9. 取消、超时与并发

- Agent Turn 的 `AbortSignal` 贯穿 Approval、MCP call 和关闭逻辑。
- 每次调用使用 Server 配置的 `callTimeoutMs`；超时与用户取消使用不同错误码。
- SDK 支持协议取消时先发送取消；到达 grace period 后可关闭该连接并终止所拥有的 stdio 子进程。
- v0.4.0 延续现有串行 Tool Loop，不增加并行 Tool 调用。
- 取消后只产生一个 Isla Turn 终态；晚到的 MCP 成功结果必须被丢弃。

## 10. 用户可见状态

TTY `/mcp` 与 NDJSON `mcp_list` 返回同一只读投影：配置 id、transport、required、状态、工具数量、公开工具名和安全错误码。不得返回 args、cwd 的敏感部分、env、完整 schema 或 Server stderr。

推荐状态：`disabled | starting | ready | unavailable | closed`。普通 `ready` 事件只需新增非敏感 capability 位 `mcp: true/false`，不把全部 catalog 塞进协议启动事件。

## 11. MediaCrawler 边界

MediaCrawler 采用独立的非商业学习许可，且依赖 Python、Playwright/CDP、账号与本地浏览器状态。因此：

- Isla 不复制、vendoring、自动安装、启动下载或重新发布 MediaCrawler。
- `@winc159/isla` 包中不能含其源码、浏览器、Cookie、缓存或平台凭据。
- 用户单独安装并遵守其许可；若编写 `MediaCrawler MCP Server`，应作为独立仓库和进程维护。
- Isla 只验证标准 MCP 契约。默认测试使用协议 fixture；真实平台调用必须显式开启、低频、人工确认且不进入 CI。
- 第一个真实验收目标是“关键词检索 → 有界结构化帖子摘要/链接 → Isla 综合报告”，不是大规模抓取或绕过平台限制。

## 12. 参考 DSH 的取舍

采用：配置名作为稳定 Server 身份、限定公开名、原始名独立保存、catalog 原子发布、规范结果与模型投影分离、显式子进程环境、optional/required 启动语义、上游安装归上游负责。

调整：Isla 直接接入已有 Tool Runtime 和 Journal，不引入 DSH/Cordis 服务层；崩溃后立即撤架且本版不自动重连；Server instructions 本版不注入 prompt；资源能力不伪装成默认工具。

暂缓：Streamable HTTP、workspace 热切换、资源共享工具、远程认证、动态 catalog 搜索。

拒绝：复制 DSH 目录/源码、引入 Cordis/monorepo、运行时自动下载 Server、因 MCP 建设通用事件总线。

