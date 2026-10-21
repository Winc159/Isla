# v0.5.3 实施计划

## 1. 执行规则

本计划供 Luna 顺序执行。每次只完成一个 Batch，并在停点运行定向测试。不得先改版本号，不得执行 Git commit 或 push。源码与设计不一致时，以源码为事实源，先报告并更新设计；不得为了符合文档删除更成熟的现有行为。

## 当前执行状态

- Batch A：已完成基线测试、生产 wiring 缺口观测测试和脱敏 trace fixture；未改变生产行为。
- Batch B：已完成 `TaskContractV1` 类型/校验、从 `TaskStateV1` 的保守迁移、Session persistence 可选字段与非法状态测试；主 Loop 尚未接入 Contract。
- Batch C：已完成独立 Decision Phase、`answer/clarify/execute` 解析、最多一次 JSON 修复和显式 `decisionPhase` wiring；默认关闭，旧 provider/tool 路径保持兼容。
- Batch D：已将 `CapabilityCatalog/Activator`、routing tools 和真实 `resolveCapabilities` 接入 `SessionFactory -> ChatSession`；每个 Model Step 生成能力快照，旧静态能力仍作为初始集合。
- Batch E：已增加只读 `ProgressEvaluator`，区分 evidence/mutation/verification/task update/observation/failure，并移除 `execution.ok -> changed=true` 的预算误判；预算支持 Profile 传入且默认仍为 12/28/40；硬上限/时间停止会写入 checkpoint 与明确 stop reason。
- Batch F：Completion Gate 已增加 active Contract 的 pending step、deliverable、evidence 检查；重复同因会 blocked；无 Contract 的普通 answer 仍快速通过。
- Batch G：已实现独立有界 Tool Scheduler，支持 1-8 并发、安全工具 predicate、wave barrier、结果按原调用顺序提交；加入 fail-closed safety classifier，`parallelism=1` 已验证串行等价，尚未替换 Session 默认执行器。
- Batch H：Web Search 配置已从主聊天 Provider 条件中解耦；Profile 可为 Search 单独提供 `apiKey/model`，仍复用现有 DeepSeek Search 协议与凭据脱敏边界。
- 真实评估修复 R1：Agent Loop 在估算上下文达到 82% 输入预算时主动触发已有 checkpoint 压缩，并重建当前请求上下文；避免等到 `CONTEXT_INPUT_TOO_LARGE` 才失败。
- 真实评估修复 R2：LoopBudget 将同一只读工具连续三次无变化观察判为 stalled，即使参数或结果文本略有变化，也不再自动延长预算。
- 真实评估修复 R3：运行时 Policy 增加环境类问题的 evidence-first 取证顺序，要求先查 Profile/配置、当前实现和测试证据，并限制连续无新增证据的重复扫描。
- 真实评估修复 R4：外部研究请求在 Agent Loop 预检 Search/Browser 能力；缺失时立即返回明确 blocked 结果，不把 Web Fetch 误当来源发现能力，也不浪费模型步数。
- 真实评估修复 R5：增加回合级只读观察上限；连续 6 次无新证据的普通观察会停止并提示用户缩小范围，Search/写入/验证/任务状态更新会重置观察计数。
- 真实评估修复 R6：硬预算和只读观察停止响应包含已记录证据数、项目来源数及 checkpoint 继续提示；不输出原始 Tool Result 或隐私内容。
- 真实评估修复 R7：`/trace` 增加 failedTools、capabilitySnapshots、checkpoints、budgetStops 等脱敏元数据，保留原有正文/参数不输出约束。
- 真实评估修复 R8：Tool Scheduler 使用 `allSettled` drain 当前 wave；异常在途调用完成后再返回，取消不会派发后续 wave，结果顺序契约保持不变。
- 重构 R9：新增 `agent-loop-preflight.ts` 作为 Agent Loop 的统一入口，集中处理研究意图/能力缺口和请求上下文预检；`research-policy.ts` 只负责研究策略，Session Loop 只负责执行状态机，不再散落维护正则、能力判断和裁剪算法。
  - 重构 R10：`JsonSessionStore` 将会话锁抽象为独立 `SessionLock`，在 Windows 锁文件创建返回 `EPERM` 且目标不存在时尝试原子目录锁，并保留 stale-lock 与并发版本校验。
  - 重构 R11：将 `Session` 中工具批次循环迁移到 `executeToolBatch` 边界，主循环只负责批次输入、下一轮上下文和终止结果；工具批准、取消、幂等写入、任务状态、journal、持久化和证据归因保持在执行器内。
- 验证：`node node_modules/vitest/vitest.mjs run tests/v0.5.3/batch-a-baseline.test.ts` 通过（3 passed、1 todo）；`node node_modules/typescript/bin/tsc --noEmit` 通过。
- 下一停点：进入 v0.5.3 集成验收，运行全量类型/测试、真实评估用例和回归评分；并行 Scheduler 仍保持默认关闭。

## 2. Batch A：基线、失败样本与观测

1. 增加 `SessionFactory -> ChatSession` 集成测试，确认动态 Resolver 当前是否生产生效；
2. 固定旧 12/28/40 边界、重复失败、Approval 拒绝和 Tool Result 闭合行为；
3. 执行 `real-evaluation.md` 的 baseline；
4. 增加脱敏 trace fixture；
5. 不改变生产行为。

停点：失败测试准确指向 Task Decision、路由、预算、完成误判和并行缺失。

## 3. Batch B：TaskContract 类型与迁移

1. 定义 `TaskContractV1`、validator、revision 和状态迁移；
2. 保守迁移旧 `TaskBrief`/`TaskStateV1`；
3. 更新 Session persistence/schema；
4. 扩展现有 task tools，不建立重复工具；
5. 限制字段、字符串、步骤和 evidence ref；
6. 验证不保存思维链、密钥和原始 Tool Result。

停点：旧 Session 可读；新 Contract 可保存、恢复和拒绝非法状态，主 Loop 尚不改变。

## 4. Batch C：Decision Phase

1. 升级并复用现有 `parseTurnDecision()`；
2. 建立独立 Prompt section 和 request snapshot phase；
3. answer 走快速路径，clarify 走 user question/needs_user，execute 创建 Contract；
4. JSON 最多一次格式修复；
5. 覆盖继续、修订、旁支和新任务；
6. 保证所有模型消息可由 Session 重建。

停点：简单问答不过度规划；复杂任务具有 deliverables/success criteria；多义请求不静默缩小。

## 5. Batch D：动态 Capability Routing 生产接线

1. SessionFactory 为每个 Session 创建 Catalog/Activator；
2. 恢复 activation state；
3. 将真实 Resolver 传入 ChatSession；
4. 注册最小 routing capability；
5. Resolver 使用 active Task Step；
6. 每 Step 生成不可变 Snapshot；
7. 激活在下一 Step 生效；
8. 统一 Profile policy、schema bytes、maxTools；
9. 覆盖中英文查询与 MCP/Skill 不可用状态。

停点：生产会话确实调用 Resolver；Schema 明显减少；初始漏选能力可以找回。

## 6. Batch E：Progress 与预算

1. 新建小型 `ProgressEvaluator`，只读 Contract、Tool details、Journal、Verification；
2. 区分新证据、任务推进、能力扩展、写入、验证、问题解决和重复观察；
3. 将 Loop Budget 加入 Profile 并限制范围；
4. 删除 `execution.ok -> changed=true`；
5. soft budget 有进展自动继续；
6. 无进展先换策略、再 blocked；
7. 硬预算保存 checkpoint 并 paused；
8. “继续”恢复且不重复成功写入；
9. 取消、拒绝、超时、失败分别映射稳定 outcome。

停点：超过旧 40 Step 的 Fake 任务能完成或恢复；重复空搜索不无限延长。

## 7. Batch F：Completion Gate V2

1. Gate 输入增加 Contract、evidence index、最后失败链和 scheduler state；
2. 校验 deliverables、required evidence 和 pending steps；
3. 首次拒绝给具体缺口，同因第二次转非完成终态；
4. 保留既有调用、Approval、取消和 Verification Gate；
5. 失败后成功恢复允许 completed，未恢复则 blocked/failed；
6. 所有 Surface 使用统一 outcome。

停点：模型文字不能覆盖 active/pending 状态；简单 answer 不被误拦。

## 8. Batch G：有界并行 Tool Scheduler

1. 增加 fail-closed argument classifier；
2. 实现 rolling pool 与 exclusive barrier；
3. 按原 Tool Call 顺序提交结果；
4. 调度失败 drain 在途并补齐 Result；
5. 取消为未派发调用生成 `ABORTED_BEFORE_DISPATCH`；
6. 只给明确验证的工具标记 parallel-safe；
7. Profile 默认 4、范围 1-8；
8. cap=1 保持串行等价。

停点：并发开始、乱序完成/顺序提交、barrier、取消、异常和部分失败全部通过。

## 9. Batch H：Provider-independent Web Search

1. 移除 Search 对主聊天 Provider 的强耦合；
2. 定义独立 search provider config；
3. 复用现有 DeepSeek 官方实现；
4. 保持凭据归属和脱敏；
5. status 报告 ready/unavailable/misconfigured；
6. Search/Fetch evidence 语义不变。

停点：Fake Bailian + Fake Search 完成 search -> fetch；未配置时明确能力缺失。

## 10. Batch I：只读 Git Capability

使用 argv-only subprocess 实现 status/diff/log/show；固定参数和输出上限；限制 workspace repo；覆盖非 Git、取消、超时、大输出和参数注入；不增加 Git 写操作。

停点：临时仓库真实测试通过，无法注入 reset/clean/checkout/push。

## 11. Batch J：安全 System Inspection

定义允许字段与平台 adapter；默认只返回 presence/status；脱敏 proxy、环境变量、进程参数和服务配置；缺少系统命令时安全降级；深入调查仍走需 Approval 的 `run_command`。

停点：Windows/Linux/macOS fixture、秘密扫描、输出边界通过。

## 12. Batch K：真实评估与调优

先执行 baseline，再执行 candidate；每个非破坏场景至少三次独立 Session；主验收使用真实 Bailian/Qwen Profile；原始材料仅放 `.isla-local/evaluations/v0.5.3/`；自动提取工具、步骤、outcome、时间、tokens、拒绝与评分证据；人工只评语义项。

停点：满足 `real-evaluation.md`，失败和波动如实记录。

## 13. Batch L：文档与发布收口

更新 current 文档、README、roadmap、references、bugs、DSH review；修正把 v0.4.8 路由描述为已完整生产接线的旧表述；版本修改前获得用户确认；运行 typecheck、定向测试、全量测试、build、pack dry-run；检查无配置、Session、秘密和真实评估原文；不提交、不推送。

## 14. Luna 报告格式

每个 Batch 报告：实际行为、修改文件、测试结果、契约变化、设计偏差/风险、未完成项、下一 Batch和是否触及停止条件。最终分开报告离线自动化、真实 Qwen、对照模型、Windows、Linux/N100、macOS 和未执行项。
