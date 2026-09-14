# Luna：Isla v0.2.2 可靠会话与可观测性实施清单

本文件是 v0.2.2 的严格执行任务书。架构依据为 `docs/architecture-v0.2.2.md`。

开始前必须完整读取：

```text
AGENTS.md
docs/architecture-v0.2.2.md
docs/architecture-v0.2.1.md
docs/architecture-v0.1.9.md
docs/dsh-reference-review.md
docs/testing-v0.2.1.md
```

## 0. 执行边界

- 基线是已经通过收口的 v0.2.1；先记录 `git status --short`，不得覆盖用户修改。
- `StoredSession.messages` 始终是唯一对话正文事实源。
- Journal 只记录生命周期、索引引用、请求快照和安全错误，不参与模型历史投影。
- 不复制 DSH 源码、目录、事件框架、Surface 或 Cordis 生命周期。
- 不恢复 IntentClassifier、Planner、CompletionChecker、execution phase 或文本流式接口。
- 不增加 Shell、网络、MCP、子 Agent、后台任务或生产依赖。
- 不执行 `git add`、`git commit`、`git push`、npm 发布或未经授权的真实 API 测试。
- 默认测试不得读取 `.env`、`~/.isla`、真实 Session、真实 Memory DB 或私人日志。
- NDJSON 是 Codex/外部控制方的正式集成边界；任何可靠性能力必须有协议层测试，不能只验证交互式 CLI。
- 测试文件和数据库使用临时目录并在 `finally` 清理。
- 每批只实现一个可独立验证的能力；当前批失败时停止，不进入下一批。
- 若需要新增三个以上未列出的生产模块、改变 `ModelProvider` 基本职责或改变 Tool/Approval/Sandbox 边界，先停止并与用户确认。

## 1. 批次顺序

```text
Batch A  基线审计、契约和失败测试
Batch B  稳定 Runtime/Provider 错误模型
Batch C  Session v3 与 Turn Journal 持久化
Batch D  Turn/Attempt 编排与中断恢复
Batch E  ModelRequest 快照与重建验证
Batch F  Tool、Approval、Memory 与 Checkpoint 关联
Batch G  /trace 只读检查入口
Batch H  CLI、NDJSON 与可见状态统一
Batch I  记忆召回评测集
Batch J  全量门禁、真实验收和文档收口
```

每批结束必须报告：修改文件、定向测试结果、typecheck 结果、尚存风险和下一批是否可进入。

## 2. Batch A：基线审计、契约和失败测试

目标：冻结 v0.2.2 行为，不先修改生产逻辑。

任务：

1. 记录当前 `git status --short`、Node/npm 版本和测试基线。
2. 审查 `ChatSession.runTurn()`、Tool Loop、`SessionStore.save()`、CLI 和 NDJSON 的实际持久化顺序。
3. 定义最小类型草案：
   - `StoredSessionV3`；
   - `SessionJournal`；
   - `TurnRecord`；
   - `ModelAttemptRecord`；
   - `ModelRequestSnapshot`；
   - `TurnActionRecord`；
   - `RuntimeErrorCode` 与 `SafeErrorRecord`。
4. 先加入失败测试，覆盖：
   - version 2 升级后 messages 完全相等；
   - completed Turn 必须引用非空 assistant；
   - failed Turn 不得引用 assistant；
   - running Turn 恢复为 interrupted；
   - Provider 空响应形成稳定 code；
   - 请求 snapshot 与实际 request 相同；
   - NDJSON 错误后没有空 `response_end`；
   - `/trace` 不输出用户正文、记忆正文或 Tool Result。
5. 测试应因能力未实现失败，不得通过 mock 绕过实际边界。

建议文件：

```text
src/core/errors.ts
src/core/journal.ts
tests/core/errors.test.ts
tests/core/journal.test.ts
tests/session-store-v3.test.ts
tests/core/request-snapshot.test.ts
tests/cli/trace-command.test.ts
```

停点：

```text
npm run typecheck
npm test -- tests/core/errors.test.ts tests/core/journal.test.ts tests/session-store-v3.test.ts
```

完成信号：所有契约有明确测试归属，失败点与尚未实现的生产能力一一对应。

## 3. Batch B：稳定 Runtime/Provider 错误模型

目标：让错误语义不再依赖字符串猜测。

任务：

1. 在 `src/core/errors.ts` 实现带 `code`、`recoverable`、安全 message 和可选 cause 的错误类型。
2. DeepSeek/OpenAI/Local Provider 在 adapter 边界转换：
   - timeout；
   - network；
   - rate limit；
   - auth；
   - empty response；
   - invalid response。
3. 不把 SDK 原始错误 message 直接写入 NDJSON 或 Journal。
4. `ChatSession` 保持 user 已保存、失败无 assistant 的语义。
5. 增加 `ISLA_MODEL_RETRIES` 配置解析，默认 0，只允许 0 或 1。
6. 实现独立 `generateWithRetry()` 边界：
   - 仅 timeout/network/rate-limit 可重试；
   - 同一 step 最多重试一次；
   - 每次尝试独立记录；
   - Tool/Approval/Persistence 错误不重试；
   - Provider 已返回 Tool Call 后不得由 retry 重复调用。
7. Provider 测试继续由 MSW 截获，不访问公网。

测试：

```text
tests/core/errors.test.ts
tests/core/retry.test.ts
tests/providers/openai.test.ts
tests/providers/deepseek.test.ts
tests/providers/local.test.ts
```

停点：

```text
npm test -- tests/core/errors.test.ts tests/core/retry.test.ts tests/providers
npm run typecheck
```

完成信号：同类错误跨 Provider 产生相同 code；不可重试错误没有第二次请求。

## 4. Batch C：Session v3 与 Turn Journal 持久化

目标：在不改变 messages 事实源的前提下持久化 Journal。

任务：

1. 在 `session-store.ts` 增加 `StoredSessionV3`。
2. `SessionState` 增加 `journal`。
3. version 1/2 读取时在内存中补空 journal；不要立即写盘。
4. 下一次成功 save 输出 version 3。
5. version 3 parser 严格验证：
   - journal version；
   - Turn sequence；
   - message indexes；
   - status/endedAt；
   - completed/failed 与 assistantMessageIndex 不变量；
   - attempt 编号与状态。
6. messages、context、journal 继续由同一次临时文件 rename 原子保存。
7. 冲突检测继续使用 `updatedAt`，不得静默合并两个进程的 journal。
8. `/sessions` 与历史回放行为保持不变。

测试：

```text
tests/session-store.test.ts
tests/session-store-v3.test.ts
tests/cli.test.ts
```

必须验证：

- v1/v2 fixture 原消息逐项相等；
- v3 round-trip；
- 损坏 journal 被拒绝；
- 未知 required 字段/状态被拒绝；
- 并发保存仍失败；
- package 不包含测试 Session。

停点：

```text
npm test -- tests/session-store.test.ts tests/session-store-v3.test.ts tests/cli.test.ts
npm run typecheck
```

## 5. Batch D：Turn/Attempt 编排与中断恢复

目标：每轮请求都产生真实且唯一的生命周期。

任务：

1. 在进入 Provider 前：
   - append user；
   - 创建 running Turn；
   - 同一次状态保存持久化 user 与 Turn start。
2. 每次模型调用前创建 running attempt 和 request snapshot 占位。
3. 成功返回时先完成 attempt，再提交 assistant，最后完成 Turn。
4. Provider 失败时：
   - 完成 failed attempt；
   - Turn 进入 failed；
   - user 保留；
   - 不追加 assistant。
5. blocked/needs_user 使用现有真实 outcome，不由字符串推断。
6. loading 的开始和停止绑定 Turn 生命周期；异常路径必须在 finally 停止。
7. Session 加载时恢复最后一个 running Turn/attempt 为 interrupted，并持久化后再接收输入。
8. 不自动重放中断请求或 Tool。

测试：

```text
tests/core/journal.test.ts
tests/core/session.test.ts
tests/core/retry.test.ts
tests/cli.test.ts
```

关键断言：

- Provider 失败后 user 存在且 assistant 不存在；
- retry 产生两个 attempts、一个 Turn；
- successful Turn 恰好一个终态；
- process restore 后 running 变 interrupted；
- persistence failure 不伪造 completed。

## 6. Batch E：ModelRequest 快照与重建验证

目标：证明某次模型请求实际看到了什么。

任务：

1. 在调用 Provider 前，从最终 `ModelRequest` 创建 snapshot。
2. Snapshot 必须包含：
   - provider/model；
   - promptVersion；
   - 最终 messages；
   - Tool definitions；
   - toolChoice；
   - retrieved source IDs；
   - SHA-256 requestHash。
3. 实现稳定 JSON 序列化：对象 key 稳定，数组顺序保留，undefined 字段省略。
4. Tool definitions 从 Registry 按稳定顺序导出。
5. PromptRegistry 暴露显式版本，不使用当前时间或随机值。
6. 实现只读 `verifyRequestSnapshot(snapshot)`：
   - 重新计算 hash；
   - 验证 schema；
   - 不调用 Provider。
7. Snapshot 只写 Session，不写默认 stderr/NDJSON/log。
8. Tool Loop 每个 step 各有独立 snapshot。

测试：

```text
tests/core/request-snapshot.test.ts
tests/prompts/registry.test.ts
tests/core/tools.test.ts
tests/core/session.test.ts
```

完成信号：FakeProvider 捕获的每个实际 request 与对应 snapshot 深度相等，hash 稳定。

## 7. Batch F：Tool、Approval、Memory 与 Checkpoint 关联

目标：把已有能力关联到 Turn，而不是复制正文。

任务：

1. ToolRuntime 回调携带 turnId、step、callId、tool、结果 code。
2. Approval 回调携带同一 callId；批准、拒绝和 remember 只记录当次 decision。
3. Tool action 不保存原始 arguments、目标文件内容或完整 Tool Result。
4. Memory retrieval 返回 `{ rendered, sourceIds }`，Session 将 sourceIds 写入 snapshot/action。
5. Working Memory 压缩成功后记录 checkpoint action；失败不记录成功 action。
6. 当前文件状态仍必须重读；Journal 不能作为 Tool 事实替代品。
7. Approval、Permission 和 Sandbox 行为不得因 Journal 改动发生变化。

测试：

```text
tests/core/tool-runtime.test.ts
tests/protocol-approval.test.ts
tests/memory/runtime.test.ts
tests/core/context.test.ts
tests/core/journal.test.ts
```

完成信号：一个真实 FakeProvider 写入场景中，callId 能关联 Tool、Approval、Turn 和 Step，且 Journal 不包含文件正文。

## 8. Batch G：`/trace` 只读检查入口

目标：用户无需手工读取 JSON 即可确认 Session 健康状态。

任务：

1. 新增 `src/cli/trace-command.ts` 并注册 `/trace`。
2. `/trace` 默认显示最近 10 个 Turn。
3. `/trace <sequence>` 显示单 Turn 安全详情。
4. 输出字段严格限制为架构文档第 11 节内容。
5. 对 version 1/2 无 Journal 会话显示“无历史运行记录”，不报错。
6. 检测并显示：
   - interrupted Turn；
   - request hash 验证失败；
   - message index 不一致；
   - 最近错误 code。
7. 不提供 raw snapshot 输出。
8. `/help` 增加命令说明。

测试：

```text
tests/cli/commands.test.ts
tests/cli/trace-command.test.ts
tests/cli.test.ts
```

安全断言：输出不包含固定测试中的 user secret、assistant private text、Tool Result body 和 memory content。

## 9. Batch H：CLI、NDJSON 与可见状态统一

目标：两个入口共享同一 Turn 终态。

任务：

1. CLI loading 从提交输入持续到 Turn 终态；Tool 不创建第二个 spinner。
2. CLI 成功、失败、blocked、needs_user 使用统一 outcome 和错误 code。
3. NDJSON `response_start` 与 Turn ID 建立内部关联，不改变现有公开字段。
4. 成功时输出一个非空 `response_end`。
5. 失败时只输出 `error`，不得追加空 `response_end`。
6. `error.code` 直接来自稳定 RuntimeErrorCode 映射。
7. BUSY、Approval、new_session、exit、EOF 和 writer backpressure 行为保持不变。
8. 真实日志仍由 `ISLA_NDJSON_LOG` 显式启用。
9. 测试驱动对每个业务 prompt 断言 response 非空；失败场景断言无 response_end。

测试：

```text
tests/cli.test.ts
tests/protocol.test.ts
tests/protocol-approval.test.ts
tests/protocol.e2e.test.ts
tests/smoke/real-ndjson.test.ts
```

停点：

```text
npm run build
npm test -- tests/cli.test.ts tests/protocol.test.ts tests/protocol-approval.test.ts tests/protocol.e2e.test.ts
```

## 10. Batch I：记忆召回评测集

目标：把“保存成功但召回失败”变成稳定可检测的回归。

任务：

1. 新增纯虚构 fixture，不使用用户真实记忆。
2. 每条 fixture 包含：memory、query、workspace、status、expected IDs 和不应命中的 IDs。
3. 覆盖中文二字片段、不同句式、英文、中英文混合和标点差异。
4. 覆盖 global/workspace、active/candidate/disabled/superseded。
5. 覆盖 keyword-only、FakeEmbedding hybrid、Embedding failure fallback。
6. 输出机器可断言统计：case count、hit count、false positive count、fallback count。
7. 不调用真实模型，不把评测实现成 LLM judge。
8. 为 `npm test` 保持完全离线。

建议文件：

```text
tests/fixtures/memory-recall-cases.ts
tests/memory/recall-evaluation.test.ts
```

完成阈值：所有明确 expected ID 命中，所有明确 forbidden ID 不命中，降级场景结果确定。

## 11. Batch J：全量门禁、真实验收和文档收口

目标：证明 v0.2.2 可以结束，而不是只证明新单元测试通过。

任务：

1. 更新 README：Session v3、错误 code、`/trace`、retry 配置、隐私。
2. 更新 roadmap、references、bugs 和 testing 文档。
3. 建立 `docs/evaluation-v0.2.2.md`，记录命令、数量、跳过项和真实结果。
4. 连续运行协议定向测试两次。
5. 检查 Session v1/v2/v3 fixture、请求 snapshot 和 interrupted 恢复。
6. 检查 npm pack 内容不包含 Session、日志、SQLite、fixture 私人数据或 `.env`。
7. 只有用户明确授权且 DeepSeek 配置存在时运行真实 NDJSON。
8. 真实 NDJSON 连续两轮必须验证：
   - 普通回答非空；
   - 明确记忆；
   - new_session 后召回；
   - inspect；
   - discuss；
   - Approval 拒绝；
   - Approval 批准与文件落盘；
   - `/trace` 安全输出（交互 CLI 可用离线等价测试）；
   - exit/bye；
   - 无 PROMPT_FAILED、空 response_end 或秘密泄漏。

最终门禁：

```text
npm run typecheck
npm test
npm run build
npm run pack:check
git diff --check
```

## 12. 硬失败

出现任意一项不得宣布 v0.2.2 完成：

- version 1/2 升级丢失或重排 messages；
- failed/interrupted Turn 被标为 completed；
- Provider 失败生成 assistant message；
- 请求 snapshot 与实际 ModelRequest 不一致；
- Journal 进入模型历史；
- Tool/Approval callId 无法关联或错配；
- 自动 retry 重复执行 Tool；
- NDJSON 失败后输出空 response_end；
- `/trace` 或 debug 输出用户正文、Tool Result、记忆正文或密钥；
- 默认测试访问公网或真实用户数据；
- 真实 smoke 任一业务回答为空；
- 全量门禁失败。

## 13. Luna 每批汇报格式

```text
完成批次：Batch X
修改文件：
实现能力：
定向测试：
typecheck/build：
未解决风险：
是否进入下一批：
```

最终汇报：

```text
完成批次：A-J
Session 兼容：
Turn/Attempt 恢复：
Request snapshot/hash：
稳定错误与 retry：
Tool/Approval/Memory 关联：
/trace 安全检查：
记忆召回评测：
离线门禁：
真实 NDJSON：
pack 内容：
未完成项：
是否满足 v0.2.2 完成标准：
Git 状态（不提交、不推送）：
```
