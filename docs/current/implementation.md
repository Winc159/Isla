# Isla v0.2.7.4 实施顺序：Capability Action Loop

状态：待实施
架构依据：`docs/current/architecture.md`

## 0. 实施纪律

- 每批先补或调整失败测试，再修改生产代码；
- 每批结束保持可构建、可运行；
- 保留 v0.2.7.3 已完成的 Web、Approval、取消和诊断改动；
- 不用关键词正则替代模型行为；
- 不执行 Git add、commit、push 或发布；
- 真实 Provider 测试只在用户明确授权下运行；
- 不把真实凭据、完整私人对话或 Provider payload 写入仓库。

## 1. Batch A：冻结新 Loop 契约

修改：

- `src/core/agent-loop.ts`
- `tests/core/agent-loop.test.ts`
- 新增或调整 Loop 单元测试

工作：

1. 定义 `capability_calls | yield` 两类 StepResult；
2. 明确文本与 Tool Call 同时出现时属于中间 Step；
3. 定义 Completion Gate 输入、拒绝原因和有界 repair；
4. 保留旧 `TurnDecision` 仅作为迁移期间内部类型，禁止新增调用点；
5. 写失败测试证明首个 Step 能看到 Tools。

验收：测试不依赖旅行词汇，至少覆盖问候、研究和项目操作三种任务形态。

## 2. Batch B：把 Tool Loop 提升为主路径

修改：

- `src/core/session.ts`
- `src/core/types.ts`
- `src/tools/runtime.ts`
- 对应 Session 测试

工作：

1. `runAgentLoop()` 首次请求直接调用带 Tool 的模型接口；
2. 每个 Step 重新投影完整可见历史和 Tool Results；
3. 有 Tool Call 时执行并继续；
4. 无 Tool Call 时产生候选 Yield；
5. 保留最大 Step、取消、Approval 和 Tool Result 配对；
6. 不再先调用 `parseTurnDecision()`。

验收：复杂任务的第一个模型请求含 Tool schemas；简单回复仍可无 Tool 结束。

## 3. Batch C：删除前置 Decision Gate

修改：

- `src/core/session.ts`
- `src/prompts/base.ts`
- `src/core/agent-loop.ts`
- `src/core/request-snapshot.ts`
- `src/core/journal.ts`

删除：

- understand 请求；
- decision JSON parser 的生产调用；
- answer/clarify/execute 分流；
- submit_decision；
- decision fallback/repair；
- 固定 synthesize 调用。

迁移：

- `parseTurnDecision()` 可先保留给旧测试，再在无生产引用后删除；
- promptVersion 更新为 `v0.2.7.4`；
- phase 更新为 `agent_step | completion_repair`；
- Journal 旧记录继续可读，不要求重写旧 Session。

## 4. Batch D：Hard Completion Gate

新增候选：

- `src/core/completion-gate.ts`
- `tests/core/completion-gate.test.ts`

第一版只实现确定性检查：

1. required Web evidence 是否存在；
2. Tool Call/Result 是否配对；
3. Tool 成功声明是否有成功事实；
4. 当前是否已取消或仍有活动调用；
5. 相同 rejection 是否超过一次。

拒绝时追加 Runtime Observation 并进入下一 Step。不得调用独立 Reviewer 模型，不评判主观质量。

## 5. Batch E：TaskBrief 迁移

目标：TaskBrief 不再决定是否允许执行。

步骤：

1. 保留现有 Session 字段读取兼容；
2. 删除依赖 decision 输出更新 TaskBrief 的路径；
3. 将 confirmed constraints、assumptions 和 blockers 作为可选状态投影给模型；
4. 第一版允许 TaskBrief 仅在用户新 Turn 或显式 state update 时更新；
5. 若需要模型更新，增加无副作用的 `update_task_state` capability，而不是恢复前置决策请求；
6. 只有出现真实跨 Turn恢复失败时才升级 Session schema。

## 6. Batch F：Web Tool 指导与多查询

修改：

- `src/tools/web-search.ts`
- `src/web/types.ts`
- Search Provider adapter
- 对应测试

步骤：

1. Tool prompt 明确发现来源、必要时 Fetch、引用 URL；
2. 参数支持 `queries: string[]`，设置小型上限；
3. 多查询可先串行实现，避免本版顺带增加并发语义；
4. 合并结果时 URL 去重、稳定排序、总结果有界；
5. 单 query 旧调用在迁移期兼容或明确升级测试；
6. Provider 仍归一化为通用 WebSearchResult。

## 7. Batch G：NDJSON 与诊断迁移

修改：

- `src/protocol/types.ts`
- `src/protocol/runner.ts`
- `src/cli.ts`
- Journal/diagnostic 测试

要求：

- 保留 `tool_start/tool_end`；
- 增加或内部记录 step 序号；
- `response_end` 表示 Yield；
- completion rejection 有稳定日志码；
- 移除 understand/decision/synthesize phase 断言；
- debug 不启用 spinner；
- query、URL 只在显式真实 trace 中脱敏输出。

## 8. Batch H：离线端到端回归

至少覆盖：

1. 问候：首 Step 无 Tool，直接 Yield；
2. 当前事实：Search → Yield；
3. 深入研究：Search → Fetch → Search → Yield；
4. 项目操作：read → write Approval → Yield；
5. Tool 失败：Observation → 换方案或 blocked Yield；
6. required evidence 缺失：completion rejected → Search → Yield；
7. completion rejection 重复：有界 blocked；
8. 用户取消 Provider、Approval、Search、Fetch；
9. Session 恢复后继续下一 Turn；
10. 无任何领域关键词仍能进入 Tool Call。

## 9. Batch I：真实评估

使用自然输入：

```text
国庆 10 月 1 日从重庆渝北提车，3 个人自驾回广州天河，
10 月 6 日到即可，想在湘西多玩，其他路线和景点由你推荐。
请直接给一版可修改的完整方案。
```

必须观察到：

```text
agent_step
→ web_search approval/start/end
→ optional additional web_search
→ web_fetch approval/start/end when source detail is needed
→ final agent_step without tool calls
→ response_end
```

测试驱动自动审批任意数量的显式网络 Approval，但不绕过权限系统。日志输出实际 query、URL、ok/code、最终文本和 Step 顺序，不记录凭据。

## 10. Batch J：门禁与收口

```text
npm run typecheck
npm test
npm run build
npm run pack:check
git diff --check
git status --short
```

完成后更新 README、roadmap、bugs、references、DSH 评审和 evaluation 文档。只有真实闭环及全部门禁通过后才把架构状态改为已完成。
