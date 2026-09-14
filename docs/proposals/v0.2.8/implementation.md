# Isla v0.2.8 实施顺序：Unified Agent Stream

状态：方案已确认，实施中  
架构依据：`docs/proposals/v0.2.8/architecture.md`

## 0. 前置停点

开始 v0.2.8 前必须先完成 v0.2.7.4：

- required evidence 具有明确的 Turn-local 状态来源；
- `step_start`、`model_result`、`completion_rejected` 诊断已按当前设计收口；
- `docs/current/` 状态与实际实现一致；
- typecheck、全量离线测试、build、pack 和 diff check 通过；
- 用户确认把当前基线切换到 v0.2.8。

未满足时不得把 0.2.7.4 遗留问题包装成 streaming 工作。

## 1. Batch A：冻结流协议

预计修改：

- `src/core/types.ts`
- 新增 `src/core/model-stream.ts`
- 新增 `tests/core/model-stream.test.ts`

步骤：

1. 定义 `ModelStreamEvent` 和唯一 finish 语义；
2. 定义 index、Tool Call id/name/arguments 完整性；
3. 定义 failed、cancelled、max_tokens 映射；
4. 为 `ModelProvider` 增加可选 `generateStream()`；
5. 保留 `generate()` 和 `generateWithTools()` 兼容路径。

停点：只增加类型和纯 Assembler，不修改 CLI、NDJSON 或真实 Provider。

## 2. Batch B：Assembler 离线实现

步骤：

1. 组装连续和交错文本 delta；
2. 按 index 组装一个或多个 Tool Call；
3. 完成后只使用完整 arguments；
4. 收集 usage 和 model；
5. 拒绝重复 finish、finish 后事件、缺失终态、重复 Tool id；
6. cancelled/failed/max_tokens 不返回成功 `ToolResponse`。

停点：Fake stream 全部通过，生产 Agent Loop 仍走 one-shot。

## 3. Batch C：OpenAI Responses Adapter

预计修改：

- `src/providers/openai.ts`
- `tests/providers/openai.test.ts`

步骤：

1. 使用 Responses API `stream: true`；
2. 映射 output text delta；
3. 映射 function-call arguments delta/done；
4. 使用官方 output/item 身份映射到内部 index；
5. 映射 completed/incomplete/failed/error；
6. 映射 usage、model 和 AbortSignal；
7. 使用 MSW/SSE fixture，不访问公网。

停点：OpenAI Adapter 可独立产出统一流，Agent Loop 尚不消费。

## 4. Batch D：DeepSeek Responses Adapter

预计修改：

- `src/providers/deepseek.ts`
- `tests/providers/deepseek.test.ts`

步骤：

1. 将流式路径迁移或新增为 DeepSeek Responses API；
2. 保留现有 Chat Completions one-shot fallback，直到真实回归通过；
3. 映射 `response.output_text.delta`；
4. 映射 `response.function_call_arguments.delta/done`；
5. 验证递增 sequence_number；
6. 以 completed/incomplete/failed 为终态，不等待 `[DONE]`；
7. 第一版保持 thinking disabled；
8. 保留当前 DSML 兼容路径，但不得从 delta 增量正则解析并执行 Tool。

停点：DeepSeek 官方 fixture 和旧 one-shot 测试均通过。

## 5. Batch E：Agent Loop 双路径

预计修改：

- `src/core/session.ts`
- `src/core/agent-loop.ts`
- 对应核心测试

步骤：

1. 若 Provider 明确启用 `generateStream()`，模型 Step 使用流路径；
2. 其他 Provider 原样使用现有 one-shot；
3. 两条路径都归一化为完整 `ToolResponse`；
4. Tool Calls 完整组装后才写 assistant Tool message；
5. 候选 Yield 仍经过 Completion Gate；
6. retry 为每个 attempt 创建独立 assembler；
7. 取消和错误继续沿用现有稳定 RuntimeError。

停点：相同 Fake 轨迹在 streaming/one-shot 下得到相同最终 Session、Journal 和 Tool 结果。

## 6. Batch F：内部 Step 观察事件

预计修改：

- `src/core/events.ts`
- `src/core/journal.ts`
- `src/session-factory.ts`

步骤：

1. 增加进程内 `model_step_start`、`model_delta`、`model_step_end` 回调；
2. delta 标记为 provisional；
3. Journal 只保存 step/attempt/终态/usage/耗时，不保存正文 delta；
4. 普通诊断不记录 prompt、reasoning、Tool arguments 或完整正文；
5. 持久化失败不得在已报告最终提交后被隐藏。

## 7. Batch G：NDJSON 协议

预计修改：

- `src/protocol/types.ts`
- `src/protocol/runner.ts`
- `src/protocol/writer.ts`
- 协议测试

新增事件候选：

```json
{"type":"model_step_start","id":"p1","step":1,"attempt":1}
{"type":"model_delta","id":"p1","step":1,"text":"...","provisional":true}
{"type":"model_step_end","id":"p1","step":1,"result":"candidate_yield"}
```

要求：

- 现有请求类型不变；
- `response_end` 仍携带完整最终文本；
-旧客户端忽略未知事件后仍可工作；
-取消后无新 delta；
-ProtocolWriter 保持串行和背压，不允许 JSON 行交错；
-`ready.capabilities.streaming` 来自 Provider 真实能力。

## 8. Batch H：CLI 暂态展示

预计修改：

- `src/cli.ts`
- CLI 输出测试

步骤：

1. TTY 下实时打印最终可见文本 delta；
2. 明确标记其处于生成中；
3. Tool Call 或 completion rejection 后正确换行并显示状态；
4. 非 TTY 输出保持稳定，不输出动画控制字符；
5. quiet/debug 与 spinner 不混写；
6. 不支持原生流时保持当前一次性输出，不做打字机效果。

## 9. Batch I：Local Provider 能力边界

第一版推荐只做显式配置，不做启动网络探测：

- 未配置：`nativeStreaming=false`；
- 配置并选择已验证的 OpenAI-compatible SSE：启用流 Adapter；
- 协议异常：本 Turn 稳定失败，不静默把半个流降级成新的 one-shot 请求；
- 下一 Turn 可以继续使用配置的 one-shot fallback，但必须有安全诊断。

是否增加 Local streaming 配置字段属于设计确认点；没有真实局域网模型服务样本前可以整批暂缓。

## 10. Batch J：真实评估与收口

真实 Provider 测试只在用户明确授权时运行：

1. OpenAI 普通文本 streaming；
2. DeepSeek 普通文本 streaming；
3. DeepSeek Tool Call streaming；
4. 生成中取消；
5. Tool 后下一 Step 最终 Yield；
6. 不支持流式的 Local one-shot 对照。

最终门禁：

```text
npm run typecheck
npm test
npm run build
npm run pack:check
git diff --check
git status --short
```

另执行凭据、Authorization、完整 Provider payload、reasoning 内容和私人数据扫描。

当前收口决策：DeepSeek 原生 streaming Tool 路径在真实评测中返回 HTTP 400，因此不作为默认能力开启；DeepSeek 默认 one-shot Tool Loop 的真实 NDJSON 评测已通过 3/3。后续只有完成独立 Tool schema 兼容性修复和真实回归，才允许打开 DeepSeek `streaming: true`。
