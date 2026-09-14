# Isla v0.2.8 架构提案：Unified Agent Stream

状态：方案已确认，待实现收口  
前置基线：v0.2.7.4 Capability Action Loop 完整收口  
日期：2026-09-14

## 1. 现实问题

Isla 当前 Provider 只向 Runtime 返回完整 `ModelResponse` 或 `ToolResponse`。CLI 在整个模型请求结束前无法展示模型进展，NDJSON 只能观察 Turn 和 Tool 生命周期，不能观察模型 Step 的真实开始、增量与终止。

早期文本流式输出因无法和 Tool Loop 保持一致语义而关闭。v0.2.7.4 已把模型控制流收敛为：

```text
Capability Calls → Observation → 下一 Agent Step
无 Tool Call → 候选 Yield → Completion Gate → Yield To User
```

因此现在可以在不恢复旧分阶段 Agent、不引入事件溯源 Session 的前提下，统一一个模型 Step 内的文本、Tool Call、usage、终态和取消。

## 2. 官方接口事实

### 2.1 OpenAI

OpenAI Responses API 在 `stream: true` 时返回语义事件流。当前与 Isla 第一版直接相关的事件包括：

- `response.output_text.delta`：最终可见文本增量；
- `response.function_call_arguments.delta`：Function Call 参数增量；
- `response.function_call_arguments.done`：包含完整参数、名称和输出位置；
- `response.completed`：成功终态和完整 Response；
- `response.incomplete`：达到输出限制等非完整终态；
- `response.failed` 或 `error`：失败信息。

事件包含 `sequence_number`，Function Call 事件还包含 `item_id` 和 `output_index`。Isla Adapter 使用 Provider 原生标识完成关联，不假设事件只能按单一文本顺序出现。

官方参考：

- https://developers.openai.com/api/reference/typescript/resources/beta/subresources/responses/methods/create
- https://platform.openai.com/docs/api-reference/responses-streaming

### 2.2 DeepSeek

DeepSeek 当前同时支持 OpenAI Chat Completions 和 Responses API。最新 Responses API 支持 `stream: true` 的语义 SSE，包括文本增量、Function Call 参数增量以及 `response.completed | response.incomplete | response.failed` 终态；事件携带单调递增的 `sequence_number`，流末尾没有 `data: [DONE]`。

官方参考：

- https://api-docs.deepseek.com/guides/responses_api/
- https://api-docs.deepseek.com/guides/function_calling
- https://api-docs.deepseek.com/guides/tool_calls/
- https://api-docs.deepseek.com/guides/thinking_mode/

DeepSeek Thinking + Tool Calls 要求后续请求完整回传 `reasoning_content`。v0.2.8 第一版继续保持当前生产路径的 thinking disabled，不顺带改变推理内容持久化契约。

### 2.3 Local Provider

Local Provider 只保证 OpenAI-compatible Chat Completions，并不保证目标局域网服务支持 `stream: true`、Tool Call delta 或一致的终态格式。因此本版不推断本地流式能力，不做逐字播放式假流式。

OpenAI 云 Provider 默认启用原生流；DeepSeek 默认保持已验证的 Chat Completions one-shot Tool Loop，只有显式 `streaming: true` 时启用 Responses 流，因为当前 Tool schema 映射仍需独立兼容性验收。两者均可通过 `streaming: false` 回退到 one-shot。Local Provider 只有显式配置 `streaming: true` 且服务确实支持原生流时才报告 `streaming: true`，否则继续使用 one-shot `generate()`。

## 3. 目标与非目标

目标：

1. 定义 Provider-neutral 的模型 Step 流协议；
2. OpenAI Responses 和 DeepSeek Responses Adapter 把官方事件转换为统一事件；
3. 单一 Assembler 从统一事件产生现有 `ToolResponse`；
4. Agent Loop 在流式和 one-shot Provider 下保持相同 `capability_calls | yield` 语义；
5. CLI 和 NDJSON 能区分暂态模型增量与最终提交；
6. 取消、失败、重试、Completion Gate 和 Session 持久化保持原子边界；
7. Provider 能力准确报告，不支持流式时不伪装。

非目标：

- 不引入 Realtime API、WebSocket 或语音；
- 不展示或保存完整思维链；
- 不启用 DeepSeek thinking mode；
- 不新增并行 Tool、后台任务、steering、Inbox 或子 Agent；
- 不把 `StoredSession.messages` 改成事件溯源日志；
- 不持久化 token 级 delta；
- 不让 NDJSON/CLI 展示事件进入模型历史；
- 不删除现有 one-shot Provider 接口。

## 4. Provider 契约

第一版在现有接口上增加可选原生流能力：

```ts
interface ModelProvider {
  readonly id: string;
  readonly model: string;
  readonly streamingEnabled?: boolean;
  generate(request: ModelRequest, options?: ModelCallOptions): Promise<ModelResponse>;
  generateWithTools?(request: ModelRequest, options?: ModelCallOptions): Promise<ToolResponse>;
  generateStream?(
    request: ModelRequest,
    options?: ModelCallOptions,
  ): AsyncIterable<ModelStreamEvent>;
}
```

`generateStream()` 同时覆盖有 Tool 和无 Tool 请求，是否传 Tools 仍由 `ModelRequest.tools` 决定。旧 Provider 和测试替身无需立即实现它。

建议的最小事件：

```ts
type ModelStreamEvent =
  | { readonly type: "text_delta"; readonly index: number; readonly delta: string }
  | {
      readonly type: "tool_call_delta";
      readonly index: number;
      readonly id?: string;
      readonly name?: string;
      readonly argumentsDelta: string;
    }
  | { readonly type: "usage"; readonly usage: TokenUsage }
  | {
      readonly type: "finish";
      readonly reason: "stop" | "tool_calls" | "max_tokens" | "failed" | "cancelled";
      readonly model?: string;
      readonly error?: RuntimeErrorRecord;
    };
```

约束：

- `index` 是一次 Provider 响应内的稳定组装键，不跨 Step 使用；
- Adapter 可以使用 OpenAI/DeepSeek 的 `output_index`、`item_id` 或 Chat Completions 的 Tool Call index 映射；
- Tool arguments 在完成前只作为字符串累计，不增量解析或执行；
- 每次流必须恰好产生一个 `finish`，之后不得再产生事件；
- Adapter 将网络异常、官方 failed/incomplete、取消统一映射为稳定终态；
- 流创建前发生的同步配置错误允许直接抛出；
- `max_tokens` 不是成功 Yield，不能保存为完整 assistant。

## 5. Step Assembler

Runtime 只提供一个 Assembler，OpenAI、DeepSeek 和未来 Local Adapter 不各自实现业务组装。

Assembler 负责：

1. 验证事件顺序和唯一终态；
2. 按 index 累积文本；
3. 按 index 累积 Tool Call id、name 和 arguments；
4. 检查 Tool Call 完整性和 id 唯一性；
5. 保存最后一个有效 usage 快照；
6. 在成功 finish 后产生完整 `ToolResponse`；
7. 在 failed、cancelled、max_tokens 或协议无效时产生稳定 RuntimeError。

Assembler 不负责：

- 执行 Tool；
- 判断是否 Yield；
- 判断 Completion Gate；
- 写 Session；
- 向 CLI 或 NDJSON 直接输出。

## 6. Agent Loop 集成

每个模型 Step：

```text
step_start
→ Provider generateStream（若存在且启用）
→ ModelStreamEvent*
→ Assembler
→ 完整 ToolResponse
→ capability_calls 或候选 yield
```

没有原生流能力时继续：

```text
step_start
→ generateWithTools / generate
→ 完整 ToolResponse
→ capability_calls 或候选 yield
```

两条路径在 Assembler 之后必须等价。Runtime 不把完整 one-shot 结果拆成多条 `text_delta`。

## 7. 暂态展示与权威提交

模型 delta 是暂态观察，不是已提交 assistant 消息。为避免 Completion Gate 拒绝候选 Yield 后造成错误语义，对外事件使用 `model_delta`，不使用暗示最终回答的 `response_delta`。

```text
model_step_start
model_delta(provisional=true)*
model_step_end(result=capability_calls|candidate_yield|failed)
completion_rejected? / tool events?
response_end   ← 唯一权威用户交付
```

规则：

- CLI 可实时展示 `model_delta`，但必须以明确的生成中样式表示暂态；
- 若该 Step 后续产生 Tool Call，中间文本仍只是该 Step 的模型内容，不结束 Turn；
- 若 Completion Gate 拒绝候选 Yield，CLI 显示“完成条件未满足，继续处理”，不得发出 `response_end`；
- 只有最终 Gate 通过且 Session assistant 提交成功后，才能发出 `response_end`；
- NDJSON 客户端只应以 `response_end`、`response_cancelled` 或 `error` 判断 Turn 终态。

## 8. Session、Journal 与重建

- `StoredSession.messages` 继续是模型可见对话正文的唯一持久化事实源；
- token delta 不写入 `messages`；
- 成功组装的 Tool Call assistant message 和 Tool Result 继续成对保存；
- 最终 assistant 仍只在有效 Yield 后保存；
- Journal 记录 `step_start`、`model_result`、usage 摘要、终态和耗时，不记录完整 delta 正文；
- request snapshot 继续保存实际请求的安全投影与 hash；
- 进程崩溃后不尝试从 Journal delta 恢复半截 assistant，也不自动重放请求或 Tool。

## 9. 重试、取消与背压

- 同一 Turn AbortSignal 传给流创建和迭代；
- 取消后 Adapter 产生 cancelled 终态或抛出可归一化的 Abort，Runtime 最终只报告一次取消；
- retry 必须创建新的 assembler；失败 attempt 的 delta 不得进入新 attempt 的组装结果；
- CLI/NDJSON sink 过慢时写入必须有界等待，不能无限缓存模型 delta；
- v0.2.8 不为此引入通用事件总线；Session 回调和现有 ProtocolWriter 足以承载第一版；
- Tool Call 只有在完整 finish 和参数校验后才可进入 Approval/执行。

## 10. 能力报告

`ProtocolCapabilities.streaming` 表示当前实际 Provider 路由能产生原生模型增量，而不是 Isla 能把完整文本分段输出。

- OpenAI Responses Adapter 实现并启用原生流：`true`；
- DeepSeek Responses Adapter 实现并启用原生流：`true`；
- Local 未确认或关闭原生流：`false`；
- one-shot fallback 永远不能把该字段报告为 `true`。

必要时增加更精确的内部能力：

```ts
interface ProviderCapabilities {
  readonly toolCalling: boolean;
  readonly nativeStreaming: boolean;
  readonly streamingToolCalls: boolean;
}
```

本版不通过实际付费请求自动探测能力；能力由所选 Adapter 和显式配置决定。

## 11. DSH 参考取舍

采用：

- Provider-neutral 流事件；
- 单一共享 Assembler；
- 文本和多个 Tool Call 可交错并按稳定 index 组装；
- Tool arguments 保留原始 JSON；
- usage 先于唯一 finish；
- Provider 流与 Agent Loop、Tool 执行职责分离；
- 成功组装的 assistant message 才进入持久历史。

暂缓：

- ContentBlock 扩展体系；
- reasoning delta 的持久化和回传；
- token 级 Session Event；
-流式重放、Session fork 和 adapter-private replay state；
-通用 stream middleware。

拒绝：

- Cordis、完整 SessionEventMap、事件总线和 monorepo package seam；
- 为流式输出改变 Isla 的最小 ApplicationContext；
- 把 DSH 作为运行时依赖或复制其源码。

参考：

- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/llm-streaming.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/core.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/agent-lifecycle.md

## 12. 完成信号

只有同时满足以下条件才可宣布 v0.2.8 完成：

1. OpenAI 或 DeepSeek 至少一个真实 Provider 产生原生文本 delta；
2. OpenAI 和 DeepSeek 官方事件均有离线 Adapter fixture 测试；
3. 文本、多个 Tool Call、usage 和终态由同一 Assembler 组装；
4. one-shot Provider 不产生假 delta，Action Loop 语义不变；
5. Tool Call 参数未完成前绝不执行；
6. Completion Gate 拒绝不会生成权威 `response_end`；
7. failed、incomplete、cancelled 和 retry 不保存半截 assistant；
8. CLI 暂态展示与最终提交可区分；
9. NDJSON 新事件向后兼容，终态仍唯一；
10. Session、Memory、Approval、Web、取消和 Tool 配对无回归；
11. 默认测试完全离线；
12. typecheck、全量测试、build、pack、diff check 和隐私扫描通过。
