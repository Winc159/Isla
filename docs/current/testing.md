# Isla v0.3.0 测试计划：Bailian Provider and Model Discovery

> v0.3.2 新增门禁：覆盖 `edit_text_file` 单次/全部替换、未读取、陈旧版本、零/多匹配、沙箱、审批、取消、临时文件清理，以及 Tool Result 驱动下一 Model Step。完整契约见 [editing-v0.3.2.md](./editing-v0.3.2.md)。

> v0.3.2 有界读取门禁：覆盖默认/指定窗口、行号、总行数、continuation footer、单行与总字节截断、空文件、CRLF、超范围、大文件流式扫描，以及窗口读取后的编辑新鲜度。完整契约见 [bounded-reading-v0.3.2.md](./bounded-reading-v0.3.2.md)。

状态：离线矩阵已执行；授权真实 Bailian 文本、Tool Calling、模型目录和 NDJSON 多轮场景已验证

默认全部离线。真实百炼测试仍必须同时具备显式开关、有效本地 Profile 和用户授权；已完成的真实验证不改变这一默认门禁。

## 1. Batch A：配置

### CONFIG-BAILIAN-001 Profile 解析

接受 `provider=bailian`、非空 model/API Key 和合法 Base URL，生成不可变启动快照。

### CONFIG-BAILIAN-002 必填字段

缺少 model、API Key、Base URL 或 URL 非法时，在创建 Runtime 和网络请求前失败。

### CONFIG-BAILIAN-003 地域中立

北京、新加坡及其他合法专属/共享地址均可配置；实现不替换 host、不补 Workspace ID、不跨地域回退。

### CONFIG-BAILIAN-004 配置事实源

正常 Profile 启动不从 env 隐式覆盖字段；只有显式 `--env` 才使用开发兼容配置。

### CONFIG-BAILIAN-005 兼容

OpenAI、DeepSeek、Local Profile 和现有 `--env` smoke 编排无回归。

### CONFIG-BAILIAN-006 脱敏

配置摘要、错误、debug、CLI、NDJSON 和测试快照不包含 API Key 或 Authorization。

## 2. Batch A：普通文本 Provider

### BAILIAN-TEXT-001 请求形状

断言 POST `${baseURL}/chat/completions`，model、有序 messages 和 `stream:false` 正确；不包含 tools、Responses 参数或平台内置能力。

### BAILIAN-TEXT-002 响应映射

文本、model、prompt/completion/total usage 映射到现有 `ModelResponse`。

### BAILIAN-TEXT-003 多轮重建

第二 Turn 请求可完全从 `StoredSession.messages` 和当前启动配置重建，不依赖 Provider 隐藏会话。

### BAILIAN-TEXT-004 空响应

空 choices、缺少 message、空文本且无 Tool Call 均为稳定 Provider 错误，不保存 assistant。

### BAILIAN-TEXT-005 错误与取消

覆盖 400、401、403、429、5xx、网络失败、timeout 和 AbortSignal；取消终态唯一，失败保留 user message。

### BAILIAN-TEXT-006 能力

最终实现报告 `toolCalling=true`、`nativeStreaming=config.streaming===true`、`streamingToolCalls=false`；one-shot 不产生 `model_delta`，普通文本 streaming 才产生 provisional `model_delta`。

## 3. Batch B：模型目录客户端

### CATALOG-001 地址派生

从合法 Bailian Profile 的 host 构造 `/api/v1/models`，不得生成 `/compatible-mode/v1/api/v1/models`。

### CATALOG-002 分页

按 `page_no` 获取直到 total，保持确定性顺序，拒绝无限分页和超过本地上限的响应。

### CATALOG-003 搜索与过滤

覆盖 name、model、providers、capabilities、features 等实际纳入的官方参数；Query String 重复参数编码正确。

### CATALOG-004 投影

只保留 model、name、provider、inference provider、capabilities、features、上下文和 token 上限等已定义字段；忽略未知附加字段。

### CATALOG-005 不完整响应

缺少 output/models、分页字段非法、模型缺少 ID 时稳定失败；不得把协议错误伪装为空列表。

### CATALOG-006 错误、超时与取消

覆盖认证、限流、服务错误、网络中断、timeout 和 AbortSignal。

### CATALOG-007 隐私

不得保存 Authorization、完整响应、账号信息或 Workspace ID；fixture 使用虚构 host 和测试密钥。

## 4. Batch B：入口与缓存

### CATALOG-CLI-001 TTY

`/models`、搜索和 refresh 输出稳定、分页或截断明确，不输出密钥和完整价格对象。

### CATALOG-AUTO-001 无 TTY

单 Agent 可通过命令或 NDJSON 完成 refresh、search、读取结果与错误判断，不依赖交互菜单。

### CATALOG-CACHE-001 成功缓存

只有完整成功响应原子替换缓存，缓存包含更新时间和地域/endpoint 的安全身份。

### CATALOG-CACHE-002 失败保留

刷新失败不破坏已有缓存；可以明确展示 stale 状态。

### CATALOG-CACHE-003 启动独立

目录服务不可用、缓存损坏或无缓存时，已配置模型的普通启动仍可继续。

### CATALOG-CONFIG-001 显式选择

查看和搜索不修改 Profile；保存模型是独立显式动作，只影响下次启动，不切换当前 Session。

## 5. Batch C：Tool Calling

### BAILIAN-TOOL-001 Tool schema

ToolDefinition 映射为标准 function tool，name、description 和 parameters 不被丢失。

### BAILIAN-TOOL-002 Tool choice

覆盖 `auto`、`required` 和指定函数；未验证模型不发送 Tool 参数。

### BAILIAN-TOOL-003 单 Tool Call

完整保留 call ID、name 和原始 arguments 字符串；参数只在完整响应后交给 Tool Runtime 校验。

### BAILIAN-TOOL-004 多 Tool Call

多个调用顺序稳定，继续使用现有串行 Tool Runtime，不提前增加并行执行。

### BAILIAN-TOOL-005 Tool Result 后续请求

第二次请求包含原 user、assistant tool_calls、匹配的 tool_call_id 与 Tool Result；请求可从 Session 重建。

### BAILIAN-TOOL-006 无效调用

缺少 ID、name、arguments、重复 ID 或配对缺失时稳定失败，不请求 Approval、不执行 Tool。

### BAILIAN-TOOL-007 Agent Loop

覆盖 Read Tool → Observation → 下一 Step → Yield、Approval 拒绝、Tool 失败、Completion Gate rejection、Step 上限和取消。

### BAILIAN-TOOL-008 能力隔离

只有已验证模型/策略声明 `toolCalling=true`；未知模型仍为 false。一个模型成功不得自动扩大整个 Bailian Provider 的能力。

## 6. 回归矩阵

每批至少覆盖：

- OpenAI 原生 streaming 保持现状；
- DeepSeek 默认 one-shot Tool Loop 保持现状；
- Local 默认 one-shot 保持现状；
- Session v1/v2/v3 恢复；
- Memory、Project Search、Web、Approval、Sandbox；
- Model Step、retry、取消和唯一终态；
- CLI/NDJSON 输出与能力报告；
- 配置向导、Profile 管理和竞争保护。

## 7. 真实百炼评估

默认 skip。建议使用独立开关：

```text
ISLA_RUN_REAL_BAILIAN_SMOKE=1
```

真实凭据只从用户已创建的本地 Profile 读取，不要求用户在对话中提供。

### REAL-BAILIAN-CATALOG

-模型目录至少返回一个条目；
-精确搜索命中当前配置 model；
-记录条目数、分页数和耗时，不保存完整目录。

### REAL-BAILIAN-TEXT

-两个独立普通提示；
-一轮多轮上下文；
-非空回答和唯一终态；
-仅在 Profile 显式启用且实际收到原生 delta 时声称 streaming。

### REAL-BAILIAN-TOOL

-目标 Qwen 模型产生一个结构化只读 Tool Call；
-Tool Result 驱动下一 Step；
-最终只保存完整 assistant；
-不依赖文本正则或平台私有展示格式。

### REAL-BAILIAN-CANCEL

-请求期间取消；
-唯一 cancelled 终态；
-无最终 assistant 和后台事件。

真实日志仅保留测试名称、通过状态、稳定错误码、step/tool 数量、usage 与耗时。

## 8. Batch D streaming 前置测试

在设计确认前只记录候选，不实现：

-官方 SSE 文本 fixture；
-Tool arguments delta 与唯一 finish；
-usage、错误、incomplete 和取消；
-与 `ModelStreamAssembler` 的一致性；
-真实文本流与真实 Tool stream 分别授权验证。

## 9. 完整门禁

- TypeScript typecheck；
-全量离线测试；
- build；
- pack check；
- `git diff --check`；
- CLI 与 NDJSON subprocess e2e；
-配置、缓存、日志和构建产物隐私扫描；
-未授权时所有真实 smoke 保持 skip；
-文档状态与实际 Batch 一致。

## 10. 2026-09-15 基线结果

- TypeScript typecheck：通过；
- 全量离线测试：71 个测试文件通过，4 个真实 smoke 文件跳过；312 passed，6 skipped；
- build：通过；
- 真实 Bailian 普通请求、one-shot Tool Calling、模型目录和 NDJSON 多轮会话：此前已在用户授权和本地 Profile 下通过；
- 本次收口未重新发起任何真实 Provider 请求；
- `pack:check`：通过；发布包为 `@winc159/isla@0.2.9`，共 179 个文件；

当前覆盖缺口：TTY `/models` 的输出和 stale cache 组合主要由组件测试与真实操作覆盖，尚无完整 CLI subprocess 专项测试；Bailian 的 Tool 能力也尚未按模型 ID 收窄验证。
