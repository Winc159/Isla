# Isla v0.2.9 测试计划：Runtime Consolidation

状态：已完成实现；真实 Provider 评测按凭据可用性执行
架构依据：`docs/current/architecture.md`
实施依据：`docs/current/implementation.md`

默认全部离线。真实 Provider 测试必须同时满足显式环境开关、有效凭据和用户授权。

## 1. 已完成：流协议与 Assembler

### STREAM-001 文本组装

多个 `text_delta` 按顺序组装为一个完整文本；空 delta 不改变结果。

### STREAM-002 交错 Tool Call

两个 Tool Call 的 arguments delta 交错出现，按 index 分别组装，最终顺序稳定。

### STREAM-003 Tool 完整性

缺少 id、name、终态或完整 arguments 时拒绝产生可执行 Tool Call。

### STREAM-004 原始参数

arguments 仅拼接字符串；Assembler 不修复、补全或提前 JSON parse。后续仍由 Tool Runtime schema 校验。

### STREAM-005 唯一终态

缺失 finish、重复 finish、finish 后继续产生 delta 均为稳定协议错误。

### STREAM-006 Usage

usage 在 finish 前被保留；未报告 usage 时字段缺省，不伪造零值。

### STREAM-007 非成功终态

`failed`、`cancelled`、`max_tokens` 均不返回成功 Yield，也不保存完整 assistant。

### STREAM-008 大小边界

文本、Tool arguments 和事件数量均设置有界预算；超限稳定失败，不无限缓存。

## 2. 已完成：OpenAI Adapter fixture

- `response.created → output_text.delta* → response.completed`；
- function call arguments delta/done；
- 多 output item 和不同 output_index；
- sequence_number 正常；
- `response.incomplete` 映射 max_tokens；
- `response.failed` 和顶层 error 映射稳定错误；
- SSE 中断；
- AbortSignal；
- usage/model 映射；
- Provider 私有字段不泄漏到 Runtime 通用类型。

Fixture 必须来自手写最小官方形状，不保存真实 Provider payload。

## 3. 已完成与限制：DeepSeek Adapter

- Responses API 文本 delta；
- Function Call arguments delta/done；
- completed/incomplete/failed 终态；
- 流结束不依赖 `[DONE]`；
- sequence_number 单调性；
- Tool Calls 和文本共存；
- thinking disabled 请求保持不变；
- Chat Completions one-shot fallback 不回归；
-现有 DSML 兼容不从未完成 delta 执行；
-AbortSignal、timeout、network、rate limit 错误归一化。

真实验证发现 DeepSeek Responses Tool 请求当前返回 HTTP 400，因此默认关闭该路径；默认 Tool Loop 继续使用已验证的 Chat Completions 一次性请求。

## 4. 已完成：Agent Loop 与回归

每个案例同时用 streaming FakeProvider 和 one-shot FakeProvider 运行，并断言最终结果等价：

1. 零 Tool 普通 Yield；
2. Search → Yield；
3. Search → Fetch → Yield；
4. 多 Tool Call 串行执行；
5. Tool 失败后下一 Step 降级；
6. Approval 拒绝；
7. required evidence 缺失 → completion rejection → Tool → Yield；
8. 重复 rejection → blocked；
9. Step 上限；
10. Session 恢复后的下一 Turn。

断言：

- 最终 `messages` 相同；
- Tool Call/Result 配对相同；
- final text、outcome、evidence 和 projectSources 相同；
- request snapshot 对相同逻辑请求一致；
- one-shot 路径没有 `model_delta`。

## 5. P0 原子提交

### COMMIT-001 成功 Yield

Gate 通过且 assistant 持久化成功后才发 `response_end`。

### COMMIT-002 Completion rejection

候选文本可以产生 provisional delta，但不得保存为最终 assistant，不得产生 `response_end`。

### COMMIT-003 Tool Step

带 Tool Call 的 assistant message 只在完整组装后保存；参数未完成时不请求 Approval、不执行 Tool。

### COMMIT-004 Persistence failure

最终 assistant 保存失败时报告持久化错误，不能先报告成功 `response_end`。

### COMMIT-005 Provider failure

已经显示 provisional delta 后 Provider 失败，Session 只保留 user 消息，不保存半截 assistant。

## 6. P0 Retry 与取消

- 第一次 attempt 输出部分 delta 后失败，第二次成功；最终文本不能混入第一次内容；
-每次 retry 生成独立 assembler 和 step attempt 记录；
-生成文本时取消；
-组装 Tool Call arguments 时取消；
-等待 Approval 时取消；
-Tool 执行时取消；
-取消后没有 delta、Tool 事件或 `response_end`；
-`response_cancelled` 仅一次且在 quiescence 后出现；
-空闲取消仍不影响下一 Turn。

## 7. P0 NDJSON

期望普通流式轨迹：

```text
ready(streaming=true)
response_start
model_step_start
model_delta*
model_step_end(candidate_yield)
response_end
```

期望 Tool 轨迹：

```text
response_start
model_step_start
model_delta*
model_step_end(capability_calls)
approval_request?
tool_start
tool_end
model_step_start
model_delta*
model_step_end(candidate_yield)
response_end
```

断言：

- 每行是完整 JSON；
- 同一请求事件顺序稳定；
- delta 明确 `provisional: true`；
- `response_end.text` 是完整权威文本；
-旧客户端仅消费既有事件仍可完成请求；
-one-shot Provider 报告 `streaming=false` 且没有假 delta；
-取消、失败和成功终态互斥；
-stdout 无诊断文本，stderr 无用户正文和凭据。

## 8. P0 CLI

- TTY 原生流逐步显示；
-非 TTY 无 ANSI/spinner 污染；
-中间 Tool Step 文本不显示为 Turn 已完成；
-Completion rejection 后给出明确继续状态；
-Provider 失败后光标和下一 prompt 正常；
-取消后不残留 loading 状态；
-one-shot Local 仍一次性显示，不做定时切片；
-中文、多字节字符和跨 chunk Unicode 不损坏。

## 9. P0 Session、Journal 与隐私

- delta 不进入 `StoredSession.messages`；
-delta 正文不进入 Journal、diagnostic 或 request snapshot；
-成功 Tool assistant 和结果仍成对；
-失败 attempt 只有安全错误和元数据；
-Journal 可还原 step/attempt/finish/usage 顺序；
-恢复时不重放未完成流；
-不记录 API Key、Authorization、完整 SSE、reasoning_content 或私人 prompt；
-Memory 只在最终提交后处理完整 assistant。

## 10. P1 性能与背压

- 10,000 个小 delta 不造成无界数组复制；
-慢 NDJSON sink 下事件保持顺序且内存有界；
-取消能打断等待中的 sink/stream；
-记录首 delta 延迟、完整响应耗时和 delta 数量，但不设与机器相关的硬毫秒门禁；
-streaming 相比 one-shot 不增加额外模型请求。

## 11. P1 真实 Provider 评估

默认 skip。每个 Provider 分开授权和报告：

### REAL-OPENAI-STREAM

- 至少两个非空原生文本 delta；
-唯一成功终态；
-最终 `response_end.text` 与组装文本一致；
-如当前 OpenAI Tool Calling 尚未接入 Isla，则不把 Tool stream 作为该 Provider 的完成门禁。

### REAL-DEEPSEEK-STREAM

-普通文本至少两个非空原生 delta；
-至少一个 Capability Call 经流式参数组装后执行；
-Tool Result 驱动下一 Step 并最终 Yield；
-终止依赖 semantic terminal event，不依赖 `[DONE]`。

### REAL-CANCEL

-在收到首个 delta 后取消；
-唯一 `response_cancelled`；
-无最终 assistant 和后台事件。

### REAL-LOCAL-CONTROL

-未声明 native streaming 时 `ready.streaming=false`；
-一次性回答正常；
-没有人工定时拆分的 delta。

真实日志只保留脱敏事件类型、step、delta 计数、usage、耗时和稳定错误码，不保存完整正文或 Provider payload。

## 12. 完整门禁

- TypeScript typecheck；
-全量离线测试；
-build；
-pack check；
-git diff check；
-协议 subprocess e2e；
-凭据和私人数据扫描；
-用户授权后的真实 OpenAI/DeepSeek 评估；
-文档状态与实际 Batch 状态一致。
