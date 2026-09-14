# Isla v0.2.7.1 Luna 实施顺序：Agent Loop 澄清与规划修复

## 1. 唯一基线

实施必须同时遵守：

- `docs/architecture-v0.md` 的长期核心不变量；
- `docs/architecture-v0.2.7.md` 的 Web Tool、安全与取消边界；
- `docs/architecture-v0.2.7.1-agent-loop.md` 的阶段和决策契约；
- `docs/testing-v0.2.7.1-agent-loop.md` 的 P0 验收矩阵。

本版只修复具备 Tool Calling 的 Agent 路径。不得顺手加入 Web Search、地图 API、后台任务、子 Agent、通用 Planner 或跨 Session 工作流。

## 2. 全程规则

- 每个 Batch 只增加一个可独立验证的能力；完成相应测试后再进入下一 Batch；
- 默认测试完全离线，使用 FakeProvider、deferred/barrier、临时 Session 与现有 Tool seam；
- 不通过放宽 Web 安全策略或 Approval 来让场景测试通过；
- 不把 decision JSON、Tool Result 或 synthesize 文本当成隐式内部协议互相解析；
- 不改变“user 先保存、有效 assistant 后保存”的会话不变量；
- 所有实际 Provider 请求必须记录真实 request snapshot；
- 不记录思维链、原始异常、私人对话或秘密到诊断和测试产物；
- 未经用户明确要求，不执行 commit、push 或其他 Git 写操作。

## 3. Batch A：锁定现状与失败用例

目标：用离线测试稳定复现 v0.2.7 的结构缺口，不先改 Prompt。

实施：

1. 增加模糊旅行 fixture：重庆取车、自驾回广州，未给天数等关键约束；
2. FakeProvider 模拟当前模型直接返回具体 `D1–D5` 路线；
3. 记录启用 Tool 时首个请求当前携带 Tool definitions；
4. 增加 Journal `needs_user` + assistant index 的现有契约冲突测试；
5. 固定现有简单问答、Tool Loop、Web Tool、取消和 Session 恢复回归基线。

完成条件：新增失败测试准确指向阶段缺失，不依赖真实模型措辞或联网。

停止条件：若复现显示旧 Session、Memory 或 Context 确实注入了错误条件，应先修复事实来源问题，不用 Agent Loop 掩盖。

## 4. Batch B：决策类型与严格解析

目标：建立不依赖厂商扩展的 `TurnDecision` 和 `TaskBrief` 纯逻辑。

实施：

1. 定义 `answer | clarify | execute` 封闭联合；
2. 定义 TaskBrief、confirmed constraint 与上限；
3. 实现严格 JSON object 解析；
4. 校验分支字段、问题数量、空文本、数组/字符上限；
5. 校验 `sourceMessageIndex` 存在且指向 user 消息；
6. 拒绝 Markdown fence、额外正文、未知 kind 和分支混用字段；
7. 返回稳定、安全、无原始输出泄露的解析错误。

完成条件：纯单元测试覆盖所有合法分支、非法结构和来源索引；不调用 Provider 或 Tool。

停止条件：若必须引入 Zod 或厂商 Structured Outputs 才能表达该小型结构，先讨论依赖和 Provider 契约扩大，不自行决定。

## 5. Batch C：Prompt phase 与无 Tool understand

目标：在 Runtime 层形成真正的阶段隔离。

实施：

1. 扩展 `PromptPhase` 为 legacy、understand、execute_tools、synthesize；
2. 将 identity/runtime policy 注册到适用阶段；
3. 新增 decision policy，要求单个 JSON envelope；
4. 只在 execute_tools 注册 capability instructions；
5. 新增 synthesis policy；
6. 启用 Tool 的 Session 首先调用 `generate()`，请求不含 `tools`；
7. 保存真实 phase action 和 prompt version；
8. 保留未启用 Tool Session 的 legacy 单次生成路径。

完成条件：测试从 Provider 捕获的 understand request 证明不存在 Tool definitions，简单 Agent 请求可以返回 answer。

停止条件：若某 Provider 的 `generate()` 隐式携带 Tool schema，应先修复 Provider 映射，不能靠 Prompt 禁止调用。

## 6. Batch D：澄清终态与任务延续

目标：让复杂缺约束任务稳定结束为 `needs_user`，下一 Turn 自然继续。

实施：

1. `clarify` 只接受 1–4 个问题；
2. Runtime 渲染问题并提交为 assistant 消息；
3. Turn 标记 `needs_user` 并保存 assistantMessageIndex；
4. 更新 Journal 校验，使 needs_user/blocked 可引用用户可见 assistant；
5. 保存当前 TaskBrief 到可选 Session state；
6. 下一 user 输入进入新 Turn，understand 同时看到原目标、澄清问题、补充信息与 TaskBrief；
7. 新 Session 和明确新任务替换/清空旧 TaskBrief；
8. Memory 资料不得直接升级为 confirmed constraint。

完成条件：模糊旅行请求零 Tool，只问关键问题；用户补充天数和预算后不必重述目标即可得到 execute 决策。

停止条件：若持久化 TaskBrief 需要破坏旧 Session 读取，先设计向后兼容迁移，不提高现有 Session version 后静默失败。

## 7. Batch E：decision repair 与失败边界

目标：处理普通模型偶发的结构输出错误，但不形成开放重试循环。

实施：

1. 首次 decision 解析失败时发起一次无 Tool 格式修复；
2. 修复请求只包含结构错误摘要和原任务上下文，不回显潜在秘密诊断；
3. 修复 Attempt 使用同一 Turn signal，并记录真实 snapshot；
4. 修复成功后按普通 decision 推进；
5. 第二次失败时 Turn=`failed`，不执行 Tool、不提交原始模型正文；
6. decision repair 与网络错误 `modelRetries` 分开计数。

完成条件：零次或一次修复的调用数确定；取消发生时不会启动修复或后续阶段。

停止条件：若真实 Provider 需要超过一次修复才能稳定工作，应重新评估协议或 Structured Outputs，不提高重试上限。

## 8. Batch F：execute_tools 接入现有 Tool Loop

目标：只有有效 execute 决策可以启动现有 Tool Loop。

实施：

1. 将 TaskBrief 和 objective 以受控 Host context 注入 execute_tools 请求；
2. 仅该阶段传递 Tool definitions；
3. 复用 ToolRegistry、ToolRuntime、Approval、失败去重和轮数上限；
4. 继续保存所有实际 Tool Call/Result 消息；
5. 模型停止产生 Tool Call 时返回内部执行结果，不直接提交最终 assistant；
6. 将 Tool 拒绝、失败、轮数耗尽整理为 synthesize 可见的执行限制；
7. 保留 projectSources 与 web details 的现有权威来源边界。

完成条件：多轮 Tool Call 可执行；没有 execute 决策时 ToolRuntime 调用计数严格为零。

停止条件：若需要修改具体 Web Tool 安全策略、允许列表或 Approval 才能推进，停止并将其作为独立版本讨论。

## 9. Batch G：强制 synthesize

目标：Tool 执行结束后始终经过无 Tool 综合并形成完整交付。

实施：

1. execute_tools 结束后调用 `generate()`；
2. synthesize 请求不含 Tool definitions；
3. 输入包含 TaskBrief、objective、实际 Tool Call/Result 与执行限制；
4. Prompt 要求完成目标、显式假设、事实来源和估算性质；
5. 对旅行 fixture 要求与确认天数一致的每日安排；
6. 在 Tool 被拒或失败时输出受限但诚实的交付，必要时 outcome=`blocked`；
7. 对最终文本执行现有 citation 校验和 assistant commit；
8. 空文本或 Provider 失败不提交 assistant。

完成条件：Tool Loop 中间文本不能绕过 synthesize；最终结果不再只是一组地点或研究笔记。

停止条件：若需要通用结果评分器或第二个模型批判循环才能通过，应记录评估差距，不能把 v0.2.7.1 扩成开放式规划框架。

## 10. Batch H：Session、Journal、Context 与恢复

目标：阶段状态可审计、可恢复，并保持模型所见可重建。

实施：

1. Session state 增加可选当前 TaskBrief；
2. phase/decision action 不保存思维链和原始 decision 正文；
3. Model Attempt snapshot 使用真实 prompt version；
4. 更新 completed/needs_user/blocked/cancelled/failed 的 assistant index 校验；
5. Session 恢复后可以继续待澄清任务；
6. interrupted/cancelled Turn 不自动重放 decision、Tool 或 synthesize；
7. Context compaction 保留事实类别，不把 assumption 变成 confirmed；
8. 旧 Session 没有 TaskBrief 时继续正常读取。

完成条件：保存—关闭—恢复后，用户补充澄清信息能继续原目标；所有 Provider 请求可由状态和 prompt 规则重建。

停止条件：若 compaction 无法保持来源索引有效，先规定索引与原 messages 的稳定映射或降级规则，不允许引用被重排后的错误消息。

## 11. Batch I：全阶段取消与 quiescence

目标：同一取消语义覆盖 understand、repair、execute_tools 和 synthesize。

实施：

1. 用 deferred/barrier 分别卡住四个 Provider/Tool 阶段；
2. 每个阶段触发 cancel 并断言唯一终态；
3. 取消后不进入下一 phase；
4. user 保留，未完成 assistant 不提交；
5. Attempt/Turn/Tool action 状态准确；
6. `whenIdle()` 等待已启动清理和状态保存；
7. 下一 Turn 使用新 signal，可开始简单新任务；
8. CLI 与 NDJSON 不出现迟到输出或重复 response_end。

完成条件：所有取消测试不用固定 sleep，且下一任务不受污染。

停止条件：若某 Provider 无法响应 AbortSignal，沿用 v0.2.6 的 provider 取消边界处理，不为单一 Provider 引入后台线程。

## 12. Batch J：离线旅行场景与全量回归

目标：用确定性 FakeProvider 脚本验证完整闭环。

脚本：

1. 用户提出“去重庆取车，然后自驾回广州，按照这个路线自驾游”；
2. understand 返回 clarify，问题覆盖天数、日期/预算和取还车/驾驶约束；
3. 用户补充确定条件；
4. understand 返回 execute 与带来源索引的 TaskBrief；
5. execute_tools 获取多份受控官方路线/景点 fixture；
6. synthesize 返回与天数一致的逐日方案；
7. 验证 confirmed、assumption、external fact、estimate 的标签和措辞；
8. 验证不存在“此前国庆/5天/3000元”等未提供条件；
9. 分别覆盖 Tool 拒绝、Tool 失败和证据不足；
10. 执行全部既有测试、build、pack 与 diff check。

完成条件：`docs/testing-v0.2.7.1-agent-loop.md` 的全部 P0 通过，v0.2.7 Web Tool 和简单问答无回归。

## 13. Batch K：用户授权的真实评估

只在用户明确授权后执行，不属于默认测试：

1. 使用临时专用 Profile 和最小 Web allowlist；
2. 不在 Prompt、Profile、Session 名或报告中写真实秘密；
3. 首轮只验证澄清且零联网；
4. 用户补充后允许真实只读 Web Tool；
5. 观察多轮 Tool 与 synthesize；
6. 分别在 understand、fetch 和 synthesize 做取消 smoke（若真实调用成本和端点允许）；
7. 清理临时 Profile/Session；
8. 只记录必要的结构性结果，不复制私人会话正文。

完成条件：真实模型行为与离线控制边界一致；结果写入单独 evaluation 文档。

## 14. 全局停止条件

出现任一情况应停止扩大实现并与用户讨论：

- 需要改变 `ModelProvider` 核心契约或采用厂商专用 Structured Outputs；
- 需要通用 Workflow Engine、任务队列、后台运行或多 Agent；
- 需要 Web Search、地图/订票 API 或写入外部服务；
- 需要修改 v0.2.7 SSRF、Approval、网络权限或隐私边界；
- 需要保存思维链或无法脱敏的 decision 原文；
- 需要破坏旧 Session/Profile/NDJSON 的向后兼容；
- 需要无限澄清、无限 Tool round、无限 decision repair 或自动 Provider 切换；
- 默认测试必须访问公网或真实 DNS；
- 为通过场景测试而写死“旅行”“重庆”“广州”或固定天数规则。

## 15. 收口命令与报告

```text
npm run typecheck
npm test
npm run build
npm run pack:check
git diff --check
```

收口报告至少记录：

- 新增/修改文件；
- 总测试通过、跳过、失败数；
- P0 决策、澄清、阶段隔离和综合结果；
- 各阶段取消与 quiescence 证据；
- Session/Journal/Context 向后兼容；
- 简单问答、Provider、Tool、Web、CLI 与 NDJSON 回归；
- 是否进行用户授权的真实评估；
- Git 状态和已知限制。

