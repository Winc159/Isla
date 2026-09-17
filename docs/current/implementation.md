# Isla v0.3.0 实施顺序：Bailian Provider and Model Discovery

> v0.3.2 当前实施 Batch：按 [editing-v0.3.2.md](./editing-v0.3.2.md) 增加安全精确编辑。只修改文件 Tool、共享观察状态、对应测试与文档；不改变 Runtime 核心契约。

> v0.3.2 后续 Batch：按 [bounded-reading-v0.3.2.md](./bounded-reading-v0.3.2.md) 把 `read_text_file` 升级为有界行窗口和大文件流式扫描；继续使用完整文件摘要保护编辑。

> v0.3.4 已按 [command-execution-v0.3.4.md](./command-execution-v0.3.4.md) 完成一次性前台 `run_command` 的契约、实现、接入和真实闭环评估。

状态：v0.3.4 已实现并完成基线收口

架构依据：`docs/current/architecture.md`

以下内容保留原实施顺序，作为 v0.3.0 的实现记录。后续新增能力仍须每次只实施一个可独立验证的 Batch；未经用户再次确认，不扩大范围或发起真实 Provider 请求。

## 当前落地摘要

- Batch A：Bailian Profile、普通文本 Provider 和配置入口已实现；
- Batch B：模型目录客户端、TTY `/models`、`--models`、NDJSON、成功缓存和 stale cache 回退已实现；
- Batch C：标准 Chat Completions one-shot Tool Loop 已实现并完成真实只读 Tool 验证；
- Batch D：可选普通文本 streaming 已实现；Tool 请求仍按能力声明回退 one-shot；
- 模型保存只影响下次启动；`--env` 没有 Profile 存储上下文，因此不支持持久化模型切换；
- 当前未实现按模型收窄 Bailian Tool Calling 能力，这是下一阶段需要重新设计确认的已知偏差。

## 0. 前置检查

- 当前代码仍为 v0.2.9 可运行基线；
- 工作区无意外改动；
- 阅读现有 OpenAI、DeepSeek、Local Provider 与配置测试；
- 不修改 Session、Model Step、Request Context 或 Tool Runtime 核心契约；
- 不执行 Git add、commit、push。

## 1. Batch A1：冻结 Bailian 配置契约

预计涉及：

- `src/config.ts`
- `src/config-store.ts`
- 配置向导与配置命令
- `src/main.ts`
- 对应配置测试

步骤：

1. 增加 `BailianConfig` 和 `provider: "bailian"` Profile；
2. `apiKey`、`baseURL`、`model` 均为 Profile 必填字段；
3. Base URL 只校验为合法 URL，不硬编码地域；
4. 正常启动只读取完整 Profile，不与 env 字段级合并；
5. 保留 `--env` 作为显式开发/CI兼容入口；
6. 配置摘要继续脱敏；
7. 配置向导只收集本批所需字段，不提前加入协议、thinking 或 streaming 选项。

停点：配置可以解析和选择，但尚未注册 Bailian Provider，也不访问网络。

## 2. Batch A2：普通文本 Provider

预计新增/修改：

- 新增 `src/providers/bailian.ts`
- `src/main.ts`
- 新增 `tests/providers/bailian.test.ts`
- Application/Protocol capability 测试

步骤：

1. 使用 OpenAI-compatible Chat Completions；
2. endpoint 为 `${baseURL without trailing slash}/chat/completions`；
3. 发送有序完整消息、model 与 `stream: false`；
4. 映射文本、model 和 usage；
5. 传播 AbortSignal，复用现有 Provider 错误归一化；
6. 空响应稳定失败；
7. 初始 capabilities 全部保守关闭；
8. one-shot 路径不产生 `model_delta`。

停点：只完成普通文本，多轮 Session 可重建；不发送 Tool schema，不查询模型目录。

## 3. Batch A3：配置入口收口

步骤：

1. README 和 CLI 帮助把 Profile 写为正常用户入口；
2. `--env` 明确标记为开发/CI/迁移兼容入口；
3. 保留现有 env 测试，防止旧 smoke 脚本立即损坏；
4. 不在本批删除环境变量字段；
5. 增加 Profile 与 env 不隐式合并的回归测试。

停点：Bailian 文本路径与配置收敛均可独立发布；真实 smoke 尚未运行。

## 4. Batch B1：模型目录客户端

预计新增：

- `src/models/catalog.ts`
- `src/models/bailian-catalog.ts`
- `tests/models/bailian-catalog.test.ts`

步骤：

1. 从 Chat `baseURL` 派生同 host 的 `/api/v1/models`，不复用 `/compatible-mode/v1` 路径；
2. 使用同一 Profile API Key；
3. 实现 `page_no`、`page_size`、名称与官方筛选参数；
4. 逐页读取到官方 total，设置页数和条目上限；
5. 只投影 Isla 需要的非敏感字段；
6. 未知字段向前兼容，关键结构缺失稳定失败；
7. timeout、取消、401、429、5xx 和网络错误归一化；
8. 不把目录结果注册成 Runtime Provider capability。

停点：纯客户端 fixture 通过，尚未接 CLI。

## 5. Batch B2：模型目录入口与缓存

要求同时提供：

- 交互式 `/models`、`/models search <text>`、`/models refresh`；
- 无 TTY 等价命令或 NDJSON 请求；
- 不含凭据的最近成功缓存。

行为：

1. 普通启动不刷新；
2. 首次模型选择或用户显式命令才请求；
3. 网络失败时可以展示带时间戳的旧缓存；
4. 缓存缺失时明确报告不可用，不伪造空列表；
5. 列表只读，不自动改 Profile；
6. 选择并保存模型必须是独立的显式配置动作，并沿用配置竞争保护；
7. 当前运行中的 Session 不切换模型，新配置下次启动生效。

停点：单 Agent 可用无 TTY 路径完成刷新、搜索和结果验证。

## 6. Batch C1：Qwen Function Calling fixture

开始前由用户从模型目录选择一个可用且官方明确支持 Function Calling 的 Qwen 模型。

步骤：

1. 映射 ToolDefinition 到 Chat Completions `tools`；
2. 映射 `auto`、`required` 与指定函数 tool choice；
3. 读取一个或多个结构化 `tool_calls`；
4. 保留原始 call id、name 与 arguments 字符串；
5. 构造后续 assistant Tool Call 与 tool result messages；
6. 不增量解析、不修复参数、不执行不完整调用；
7. 与现有 Approval、取消、配对、Completion Gate 集成；
8. 不加入 Qwen 专属 Provider。

停点：MSW fixture 下完整 one-shot Tool Loop 通过，capabilities 暂不因 fixture 自动扩大到所有 Bailian 模型。

## 7. Batch C2：窄模型能力策略

先实现封闭、保守的已验证路由判断。输入至少包含 model ID、目录元数据和本地验证记录；输出只覆盖现有 `ProviderCapabilities`。

规则：

- 普通文本是 Bailian Provider 的基础能力；
- Tool Calling 只对明确支持且经过验证的模型/模型族开启；
- 未知模型保持 `toolCalling=false`；
- GLM、Kimi、thinking 等额外字段不在没有真实需求前实现；
- 不建立在线能力协商中心或每模型类层次。

停点：能力报告与实际请求路径一致，未知模型不会收到不兼容 Tool 参数。

## 8. Batch C3：授权真实评估

只有用户明确授权并已在本地完成配置后运行：

1. 两个独立普通提示；
2. 多轮文本对话；
3. 一个只读 Tool Call；
4. Tool Result 驱动下一 Step 最终 Yield；
5. NDJSON one-shot 对照；
6. 生成中取消或请求取消；
7. 模型目录查询与所选 model 精确命中。

日志只保存场景、事件类型、step/tool 数量、usage、耗时与稳定错误码。

## 9. Batch D：候选 streaming

Batch D 必须重新设计确认。不得因为 OpenAI SDK 能返回流就直接声明可用；必须先取得目标模型的官方事件 fixture，再验证文本和 Tool streaming 是否分别成立。

## 10. 每批门禁

```text
npm run typecheck
npm test
npm run build
npm run pack:check
git diff --check
git status --short
```

另执行：

- API Key、Authorization、Workspace ID、完整 payload 和私人正文扫描；
- OpenAI、DeepSeek、Local 回归；
- 文档状态核对；
- 未授权时确认全部真实 smoke 仍为 skip。

## 11. 用户配置协作

离线实现不要求用户提供真实配置。进入 Batch B/C 真实验证前，必须明确告知用户：

1. 需要复制哪个本地模板；
2. 需要填写 API Key、地域 Base URL、Workspace ID 和 model 的哪些字段；
3. 文件保存位置与 Git 排除状态；
4. 不要把 API Key 粘贴到对话；
5. 将执行哪些真实请求及其可能产生的费用。

## 12. v0.3.3 第一梯队工具

已按独立停点完成：

1. Batch A：`createToolCapabilities` 集中装配静态 Capability，协议错误码复用 Tool 错误码事实源；
2. Batch B：使用打包的 `@vscode/ripgrep` 实现 `glob_project` 与 `grep_project`，不经过 Shell；
3. Batch C：实现 `ask_user_question`，TTY 与 NDJSON 共用 User Question seam，并与 Approval 分离；
4. 未引入动态 Tool 加载、DI 容器、Pipeline、PTC、MCP、后台 Job 或按 Agent 裁剪。

## 13. v0.3.4 安全命令执行

Batch A-D 已完成。离线门禁和授权真实闭环均已执行：

1. Batch B：subprocess runner、Shell Adapter、Workspace workdir 校验、环境过滤、超时/取消和有界输出；
2. Batch C：`command-execution` Capability、`command-execute` Approval、TTY/NDJSON 接入；
3. Batch D：79 个测试文件通过，352 passed、6 skipped；typecheck、build、pack dry-run、audit 和 diff check 通过；Qwen 真实“读取→修改→run_command 检查”闭环通过。

本阶段不实现后台 Job、PTY、持久 Shell、stdin/custom env、spill 文件或 OS 级命令文件沙箱。
