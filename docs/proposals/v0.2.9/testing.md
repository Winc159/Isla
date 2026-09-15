# Isla v0.2.9 测试计划：Runtime Consolidation

状态：待确认  
架构依据：`docs/proposals/v0.2.9/architecture.md`  
实施依据：`docs/proposals/v0.2.9/implementation.md`

默认测试全部离线。真实 Provider 测试必须同时满足显式环境开关、有效凭据和用户授权。

## 1. Provider 能力

### CAP-001 能力快照

每个 Provider 和配置组合产生稳定、只读的 `ProviderCapabilities`。

### CAP-002 OpenAI streaming

默认启用时 `nativeStreaming=true`；显式关闭后为 false，Runtime 走 one-shot。

### CAP-003 DeepSeek 默认路径

默认 `toolCalling=true`、`nativeStreaming=false`、`streamingToolCalls=false`，继续使用已验证 Chat Completions Tool Loop。

### CAP-004 Local 现状

不新增能力；未实现 Tool Calling 或原生流的配置不得报告支持。

### CAP-005 协议一致性

`ready.capabilities`、启动摘要和 Runtime 实际分支来自同一能力快照。

### CAP-006 无网络探测

构造 Runtime 和读取能力不会发送付费或局域网请求。

## 2. ModelStepRunner

### STEP-001 one-shot 成功

产生 start/end，无 delta，返回与提取前相同的完整响应。

### STEP-002 streaming 文本

按顺序传播真实非空文本 delta，assembler 返回完整文本。

### STEP-003 streaming Tool Calls

参数完整组装后才返回 Tool Calls；observer 不暴露参数 delta。

### STEP-004 retry 隔离

第一次 attempt 的 delta、assembler 和错误不进入第二次结果；两次 attempt 分别 settlement。

### STEP-005 取消

AbortSignal 贯穿创建与迭代；取消后无新 delta，最终只报告一次取消。

### STEP-006 非成功终态

failed、incomplete、max tokens 和协议错误均不返回成功响应。

### STEP-007 observer 失败

按冻结策略稳定处理 observer/sink 错误，不产生无界缓存或半提交 assistant。

### STEP-008 snapshot 等价

提取前后相同逻辑请求具有相同消息、Tool schema、choice 和安全 hash。

## 3. RequestContextBuilder

### CTX-001 legacy 请求

历史、system prompt 和 checkpoint 装配与当前行为一致。

### CTX-002 agent step 请求

TaskBrief、Memory、capability prompt 和 Tool schemas 顺序稳定。

### CTX-003 可重建

相同 Session 状态、启动配置和检索结果生成相同 `ModelRequest`。

### CTX-004 信任边界

checkpoint、Memory 和 TaskBrief 保留明确来源提示，不伪装成当前用户消息或授权。

### CTX-005 只读

builder 不修改 Session、TaskBrief、Memory 结果或输入消息数组。

### CTX-006 既有投影

本版继续遵守 `maxContextTurns`、`maxContextChars` 和完整 Conversation Unit；不引入 token 预算行为。

## 4. 进程内事件

### EVT-001 普通 streaming Yield

```text
model_step_start
model_delta+
model_step_end(candidate_yield)
```

### EVT-002 Tool Step

```text
model_step_start
model_delta*
model_step_end(capability_calls)
tool_call
tool_result
下一 model_step_start
```

### EVT-003 completion rejection

候选文本可以产生 provisional delta，但不得产生权威 Turn 完成事件；继续下一 Step。

### EVT-004 retry

失败 attempt 以 retry 或 failed settlement 结束，新 attempt 使用递增 attempt 编号。

### EVT-005 取消

取消后 model step 结束，等待 quiescence，再产生唯一 Turn cancelled。

### EVT-006 one-shot

允许 model step start/end，不允许 `model_delta`。

### EVT-007 不持久化正文

delta 正文不进入 messages、Journal、Memory、checkpoint 或 diagnostic。

## 5. NDJSON

### NDJSON-001 普通流式轨迹

```text
ready(streaming=true)
response_start
model_step_start
model_delta+
model_step_end(candidate_yield)
response_end
```

### NDJSON-002 Tool Loop

多个 model step 与 Tool 事件顺序稳定，只有最终 Gate 通过后产生 `response_end`。

### NDJSON-003 向后兼容

忽略未知 model events 的旧消费者仍能通过既有终态完成请求。

### NDJSON-004 串行与背压

每行是完整 JSON；慢 sink 下不交错、不乱序、不无限缓存。

### NDJSON-005 失败互斥

`response_end`、`response_cancelled` 和 `error` 互斥。

### NDJSON-006 取消无迟到事件

取消进入 quiescence 后不再输出 model/tool 事件。

### NDJSON-007 stdout 纯净

stdout 无日志、spinner、诊断或非 JSON 文本。

## 6. CLI

### CLI-001 TTY 原生流

真实 delta 逐步展示，最终结果不重复或遗漏正文。

### CLI-002 非 TTY

保持一次性输出，无 ANSI、spinner 或暂态事件污染。

### CLI-003 one-shot

完整响应到达后一次性输出，不做定时切片。

### CLI-004 Tool Step

中间文本不显示为 Turn 已完成；Tool 状态与下一 Step 边界清楚。

### CLI-005 completion rejection

正确结束暂态显示并提示继续处理，不提交候选文本。

### CLI-006 retry

失败 attempt 的暂态文本不会与成功 attempt 拼接为一个权威答案。

### CLI-007 失败与取消

光标、换行和下一 prompt 恢复正常，无残留 loading 状态。

### CLI-008 Unicode

中文、emoji、组合字符和跨 chunk UTF-8 不损坏。

## 7. Session 原子性与恢复

### SESSION-001 user 先提交

Provider 调用前 user 消息已经持久化；调用失败后仍可重建用户意图。

### SESSION-002 assistant 后提交

只有成功 Yield、Gate 通过且持久化成功后保存最终 assistant。

### SESSION-003 Tool 配对

Tool Call assistant 与每个 Tool Result 完整配对；未完成流不得执行 Tool。

### SESSION-004 persistence failure

assistant 持久化失败时不先报告 `response_end`。

### SESSION-005 resume

恢复后的下一 Turn 不重放 provisional delta、失败 attempt 或旧 observer 状态。

### SESSION-006 checkpoint

现有 checkpoint 行为不回归；v0.2.9 不改变其触发和内容契约。

## 8. Agent Loop 与安全回归

同一 Fake 轨迹在 streaming/one-shot 下断言最终状态等价：

1. 普通 Yield；
2. Search → Yield；
3. Search → Fetch → Yield；
4. 多 Tool Call 串行执行；
5. Tool 失败后继续；
6. Approval 拒绝；
7. Approval 通过后的写入；
8. required evidence rejection → Tool → Yield；
9. 重复 rejection → blocked；
10. Tool round 上限；
11. Session 恢复后的下一 Turn；
12. Web 安全失败；
13. 生成、Approval 和 Tool 执行阶段取消。

断言：

- 最终 messages 相同；
- Tool Call/Result 配对相同；
- final text、outcome、evidence 和 projectSources 相同；
- Approval 与 sandbox 决策相同；
- provisional 事件不改变 Completion Gate。

## 9. 错误与诊断

### ERR-001 领域分类

已有稳定错误码能够映射到定义的最小领域，未知码仍安全回退。

### ERR-002 兼容性

协议和用户可见错误码不因内部提取被无意改变。

### ERR-003 retry 判定

只有既有明确 recoverable 错误触发 retry；取消、安全和配置错误不重试。

### ERR-004 安全字段

诊断可以包含 provider/model、step/attempt、usage、耗时和 delta count。

### ERR-005 隐私

诊断、Journal、snapshot、CLI stderr 和 NDJSON 不包含：

- API Key 或 Authorization；
- 完整 Provider payload；
- reasoning；
- 完整 Tool arguments；
- provisional 正文；
- 私人会话正文。

## 10. v0.2 最终能力矩阵

| 维度 | 离线门禁 |
|---|---|
| Provider | OpenAI fixture、DeepSeek fixture、Local 现状回归 |
| 模型路径 | native streaming、one-shot |
| Step | candidate yield、capability calls、retry、failed、cancelled |
| Turn | completed、blocked、cancelled、error |
| Tool | success、failure、Approval allow/deny、配对 |
| 状态 | new、resume、switch、persistence failure |
| Surface | CLI TTY、CLI non-TTY、NDJSON |
| 数据 | Session、Journal、Memory、TaskBrief、checkpoint |
| 安全 | workspace、Web SSRF、凭据和正文泄漏 |

## 11. 性能与资源边界

- 10,000 个小 delta 不造成无界数组复制；
- 慢 NDJSON sink 保持顺序并受背压约束；
- delta observer 不复制完整累计正文；
- streaming 不增加额外 Provider 请求；
- retry 每次只持有当前 attempt 的 assembler；
- 记录首 delta、完整响应耗时和 delta 数量，但不设置机器相关硬毫秒门禁。

## 12. 真实 Provider 评估

默认 skip，必须用户明确授权。

### REAL-OPENAI-STREAM

- 至少两个非空原生文本 delta；
- 唯一成功终态；
- NDJSON delta 组装后与 `response_end.text` 一致；
- CLI TTY 展示与最终返回一致。

### REAL-DEEPSEEK-ONESHOT

- 默认 Chat Completions Tool Loop 不回归；
- ready 正确报告 streaming=false；
- Tool Result 驱动下一 Step 并最终 Yield。

### REAL-DEEPSEEK-STREAM

仅测试已验证的普通文本流。Responses Tool streaming 在 HTTP 400 兼容问题解决前不作为 v0.2.9 门禁。

### REAL-CANCEL

- 首个 delta 后取消；
- 唯一 cancelled 终态；
- 无最终 assistant 和迟到事件。

日志只保存脱敏事件类型、step、attempt、delta count、usage、耗时和稳定错误码，不保存完整正文或 Provider payload。

## 13. 完整发布门禁

```text
npm run typecheck
npm test
npm run build
npm run pack:check
git diff --check
git status --short
```

并确认：

- Protocol subprocess e2e 通过；
- CLI TTY/非 TTY 测试通过；
- 默认测试没有公网依赖；
- 隐私扫描通过；
- package、README、`docs/current/` 和实际能力一致；
- 暂缓能力没有混入实现；
- 未经用户明确要求没有 Git add、commit 或 push。
