# v0.4.0 测试设计

## 1. 分层策略

- 单元测试：配置、命名、catalog、预算、权限、结果投影和错误映射。
- transport 集成：仓库内 stdio fixture，真实 SDK、真实子进程、无网络。
- Runtime 集成：Fake Provider + 真 MCP fixture，覆盖完整 Agent Tool Loop。
- Surface 集成：TTY/NDJSON 状态、Approval、取消与退出。
- 目标系统验收：Linux x64、macOS ARM64。
- 外部互操作：MediaCrawler MCP，显式开启、默认跳过。

所有 fixture 使用合成数据，不读取用户 Profile、home 浏览器数据或真实凭据。测试结束必须确认子进程全部退出。

## 2. P0 配置与安全

| ID | 场景 | 预期 |
|---|---|---|
| MCP-CFG-01 | 旧 Profile 没有 `mcp` | 正常启动，MCP disabled |
| MCP-CFG-02 | 空 servers | 正常启动，无额外工具 |
| MCP-CFG-03 | 重复/非法 id、空 command、相对 cwd、非 stdio transport | 启动前明确拒绝 |
| MCP-CFG-04 | required Server 启动失败 | 应用启动失败，错误脱敏 |
| MCP-CFG-05 | optional Server 启动失败 | 应用继续，Server unavailable，零残留工具 |
| MCP-CFG-06 | env 含 token/password/key/cookie | `/config`、`/mcp`、Journal、stderr 摘要均不泄露 |
| MCP-CFG-07 | 进程环境含云厂商/API 凭据 | 未显式配置时不传给 Server |
| MCP-CFG-08 | 模型或历史文本要求新增 Server | 配置与 catalog 不变化 |

## 3. P0 transport 与生命周期

| ID | 场景 | 预期 |
|---|---|---|
| MCP-LIFE-01 | fixture 正常启动/discover/close | 状态 `starting -> ready -> closed` |
| MCP-LIFE-02 | 启动超时 | 稳定 `MCP_SERVER_START_FAILED`，无孤儿进程 |
| MCP-LIFE-03 | discover 期间退出 | 整代不发布 |
| MCP-LIFE-04 | ready 后崩溃 | 立即 unavailable，后续请求不暴露旧工具 |
| MCP-LIFE-05 | call 超时 | `MCP_TIMEOUT`，Turn 有界收敛 |
| MCP-LIFE-06 | 用户取消 slow call | `MCP_CANCELLED`/Turn cancelled，唯一终态 |
| MCP-LIFE-07 | Server 忽略取消 | grace 后终止连接/子进程，无晚到提交 |
| MCP-LIFE-08 | dispose 调用两次 | 幂等，无异常和进程泄漏 |
| MCP-LIFE-09 | Server stderr 输出垃圾/秘密 | 不污染协议和模型历史，诊断有界脱敏 |
| MCP-LIFE-10 | `/new` | 只换 Session，Host 不重复启动 |

## 4. P0 catalog 与身份

| ID | 场景 | 预期 |
|---|---|---|
| MCP-CAT-01 | 两个 Server 都有 `search` | 公开名按 server id 隔离 |
| MCP-CAT-02 | 远端 serverInfo.name 改变 | 公开名不变 |
| MCP-CAT-03 | 非法/超长 tool 名 | 确定性规范化并带 hash |
| MCP-CAT-04 | 名称规范化后冲突 | 整个 Server generation 拒绝 |
| MCP-CAT-05 | 调用规范化工具 | wire 上发送保存的 raw name |
| MCP-CAT-06 | 任一 schema 无效 | 整代拒绝，不发布部分工具 |
| MCP-CAT-07 | 工具数/schema/catalog 超预算 | 整代拒绝，稳定错误 |
| MCP-CAT-08 | 多 Server 启动完成顺序随机 | 最终排序按配置与远端顺序确定 |
| MCP-CAT-09 | Model Step 已开始后 Server 崩溃 | 当前请求 snapshot 不突变，下一步撤架 |
| MCP-CAT-10 | Journal request snapshot | 保存当次实际 MCP tool definitions |

## 5. P0 Tool Runtime 与权限

| ID | 场景 | 预期 |
|---|---|---|
| MCP-TOOL-01 | 完整合法参数 | 只调用一次，call id 正确配对 |
| MCP-TOOL-02 | 空/残缺 streaming 参数 | 不调用 Server；只接受组装完成的 Tool Call |
| MCP-TOOL-03 | schema 校验失败 | 在 transport 前失败 |
| MCP-TOOL-04 | 默认权限 | 映射为 `network` 并进入 Approval |
| MCP-TOOL-05 | Server 标记 readOnly | 不自动免审批 |
| MCP-TOOL-06 | 用户拒绝 Approval | wire 调用次数为零，返回匹配 Tool failure |
| MCP-TOOL-07 | Approval remember | 只对相同公开名和 permission 生效 |
| MCP-TOOL-08 | Tool description/result 注入“跳过审批” | 后续动作仍走正常权限 |
| MCP-TOOL-09 | Server 返回 `isError` | 不包装成成功；模型收到明确失败 |
| MCP-TOOL-10 | transport/协议异常 | 稳定错误码，无原始堆栈/秘密 |
| MCP-TOOL-11 | Tool 后模型最终回答 | Completion Gate 正常完成且历史配对完整 |
| MCP-TOOL-12 | Tool 后模型错误/取消 | 不追加无效 assistant 消息 |

## 6. P0 结果与上下文预算

| ID | 场景 | 预期 |
|---|---|---|
| MCP-RES-01 | 单/多 text block | 按顺序稳定投影 |
| MCP-RES-02 | structuredContent | 稳定 JSON 投影并标注外部不可信 |
| MCP-RES-03 | text + structuredContent | 两部分均保留，格式确定 |
| MCP-RES-04 | image/audio/resource block | `MCP_UNSUPPORTED_CONTENT`，不静默丢弃 |
| MCP-RES-05 | 超过 64 KiB | `MCP_RESULT_TOO_LARGE`，不把截断前缀当成功 |
| MCP-RES-06 | 循环/不可序列化结构 | 稳定失败，不崩溃 |
| MCP-RES-07 | 结果含 secret-like key | 诊断不回显；Tool 业务结果按明确契约处理 |
| MCP-RES-08 | catalog 达默认上限 | ModelRequest 大小受控，排序稳定 |

## 7. P0 Surface 与协议

| ID | 场景 | 预期 |
|---|---|---|
| MCP-SURF-01 | TTY `/mcp` | 只显示安全状态和公开工具名 |
| MCP-SURF-02 | NDJSON `mcp_list` | 带匹配 id 的确定性结果 |
| MCP-SURF-03 | 非法 `mcp_list` | 可恢复协议错误，不影响活动 Session |
| MCP-SURF-04 | `ready.capabilities.mcp` | 有 ready Server 时 true，否则 false |
| MCP-SURF-05 | MCP Server stdout/stderr | 不污染 NDJSON stdout |
| MCP-SURF-06 | NDJSON Approval 批准/拒绝 | 与内置 Tool 语义一致 |
| MCP-SURF-07 | NDJSON cancel | ack 与唯一 Turn 终态保持 3.9 契约 |
| MCP-SURF-08 | TTY/NDJSON 相同配置 | Server 状态、工具名和错误码等价 |

## 8. P1 兼容、包装与目标系统

| ID | 场景 | 预期 |
|---|---|---|
| MCP-COMP-01 | 全量旧测试 | 无 MCP 配置时全部通过 |
| MCP-COMP-02 | OpenAI/DeepSeek/Bailian/local | Provider tool 投影契约不退化 |
| MCP-COMP-03 | `npm pack --dry-run` | 不含 fixture 运行产物、MediaCrawler、Profile、secret |
| MCP-COMP-04 | Windows | 参数数组安全启动，无 shell 拼接 |
| MCP-COMP-05 | Linux x64 | 安装 tgz 后 stdio fixture 全链路通过 |
| MCP-COMP-06 | macOS ARM64 | 安装 tgz 后 stdio fixture 全链路通过 |
| MCP-COMP-07 | Node 最低支持版本 | SDK 与 Isla engines 一致或文档明确升级 |
| MCP-COMP-08 | 路径含空格/Unicode | command args、cwd 与公开状态正确 |

## 9. P2 显式真实互操作

### 9.1 首选：官方 SDK 独立 Server 评估

这是 4.0 基座的首个真实评估，不依赖 MediaCrawler：运行 `npm run test:smoke:mcp`。fixture Server 作为独立子进程启动，使用官方 MCP Server SDK；Isla 通过官方 Client SDK 连接。该评估覆盖 discover、call、structuredContent、结果限额、未支持内容、进程退出和陈旧 catalog 撤架。

默认不运行，避免普通测试启动子进程；它不访问网络，也不需要账号或下载仓库。

MediaCrawler 测试必须使用独立环境变量开关，默认 `skip`。记录版本、平台、MCP wrapper commit、工具列表、调用耗时、结果大小和清理状态，但不记录 Cookie、帖子私人正文、账号标识或完整 Profile。

最低场景：Server 启动和 discover；关键词检索一次；结果包含可定位 URL/来源字段；Isla 输出有来源摘要；取消一次慢请求；退出后无孤儿浏览器/Server 进程。

没有完成该项时，可以宣布“通用本地 stdio MCP 基座通过”，不能宣布“MediaCrawler 已支持”。

## 10. 发布阻断条件

以下任一项失败即阻断 v0.4.0：权限可被 Server 注解绕过；秘密进入日志/Session/包；catalog 部分发布；崩溃后继续暴露陈旧工具；取消产生双终态或晚到提交；存在孤儿子进程；默认测试访问网络；目标系统未验收；文档与实际支持的 MCP 能力不一致。
