# Isla v0.2.7.1 架构基线：Agent Loop 澄清与规划修复

状态：设计已确认，待实现  
日期：2026-09-13  
目标名称：Agent Loop Clarification and Planning Repair

## 1. 唯一目标

v0.2.7.1 只修复一类已经在真实旅行规划中复现的问题：当用户给出复杂但约束不足的任务时，Runtime 必须先完成受控决策，必要时等待用户澄清；约束足够后才进入 Tool 执行，并在 Tool 结束后单独综合完整交付。

本版保留 v0.2.7 的 Provider、Session、ToolRuntime、Approval、Web Tool、Context、Memory、Journal、CLI 与 NDJSON 边界，不建设通用任务平台。

目标流程：

```text
用户输入
  → understand（无 Tool）
      ├─ answer → complete
      ├─ clarify → needs_user
      └─ execute
           → execute_tools（有 Tool）
           → synthesize（无 Tool）
           → complete / blocked
```

## 2. 问题定义

v0.2.7 启用 capability 后，`ChatSession` 直接调用 `generateWithTools()`。模型在同一次生成中同时承担：

- 理解任务；
- 判断缺失条件；
- 猜测未提供条件；
- 决定是否使用 Tool；
- 生成 Tool Call；
- 判断何时停止 Tool Loop；
- 输出最终答案。

Runtime Policy 可以提醒模型谨慎，但不能形成可验证的控制边界。因此真实场景出现了未确认天数被写成 `D1–D5`、未经查证的里程和耗时、虚构“此前条件”、只交付路线骨架以及过早停止等行为。

这不是 Web Tool、Session 污染或单条用户 Prompt 的问题，而是 Agent Loop 缺少阶段和终态约束。

## 3. 设计原则

1. **阶段由 Runtime 控制。** 模型提出意图，Runtime 决定下一次请求是否携带 Tool schema。
2. **澄清与执行物理隔离。** `understand` 和 `clarify` 请求不包含 Tool definitions；模型即使输出 Tool Call 也不能被执行。
3. **先保存用户输入。** 继续保持 user 消息在任何 Provider 调用前进入 Session 的不变量。
4. **澄清是正常终态。** `needs_user` 不是失败或后台暂停；问题作为 assistant 消息提交，下一条用户消息开始新 Turn 并延续当前任务。
5. **工具结果不是最终答案。** `execute_tools` 只收集证据；完成工具执行后必须进入无 Tool 的 `synthesize`。
6. **来源类别显式。** 用户约束、Agent 假设、外部事实和估算不得混写成同一类事实。
7. **取消贯穿单个活动 Turn。** 同一个 `AbortSignal` 覆盖 understand、Tool、Approval、网络等待与 synthesize。
8. **最小增量。** 不引入 Agent Registry、Inbox、Cordis、后台任务、子 Agent、工作流 DSL 或通用生命周期框架。

## 4. 阶段与状态机

### 4.1 阶段

```ts
type AgentPhase =
  | "understand"
  | "clarify"
  | "execute_tools"
  | "synthesize";
```

`clarify` 是决策结果对应的可观察阶段，不需要单独再调用一次模型。一次 `understand` 请求返回澄清问题后，Runtime 校验并直接提交这些问题。

### 4.2 合法转换

| 当前阶段 | 结果 | 下一步/终态 |
|---|---|---|
| understand | `answer` | 提交回答，`completed` |
| understand | `clarify` | 提交问题，`needs_user` |
| understand | `execute` | `execute_tools` |
| execute_tools | 获得足够结果或模型停止调用 | `synthesize` |
| execute_tools | Approval 拒绝、重复失败或达到上限 | `synthesize`，由综合说明受限结果；无法提供有用交付时 `blocked` |
| execute_tools | Turn 取消 | `cancelled`，不进入 synthesize |
| synthesize | 有效完整回答 | `completed` |
| synthesize | 明确无法继续 | `blocked` |

禁止的转换：

- `understand → ToolRuntime`，除非决策是 `execute`；
- `clarify → execute_tools`；
- `execute_tools → completed`，不经过 synthesize；
- `synthesize → ToolRuntime`；
- 任一取消状态继续发起 Provider 或 Tool 调用。

## 5. 决策契约

### 5.1 最小联合类型

```ts
type TurnDecision =
  | {
      readonly kind: "answer";
      readonly text: string;
      readonly task: TaskBrief;
    }
  | {
      readonly kind: "clarify";
      readonly questions: readonly string[];
      readonly task: TaskBrief;
    }
  | {
      readonly kind: "execute";
      readonly objective: string;
      readonly task: TaskBrief;
    };
```

`execute` 不包含 `ToolCall[]`。具体 Tool Call 继续由现有 `generateWithTools()` 和 Provider Tool Calling 协议生成，避免在决策阶段重新实现一套工具参数协议。

### 5.2 TaskBrief

```ts
interface TaskBrief {
  readonly goal: string;
  readonly confirmedConstraints: readonly ConfirmedConstraint[];
  readonly openQuestions: readonly string[];
  readonly assumptions: readonly string[];
}

interface ConfirmedConstraint {
  readonly text: string;
  readonly sourceMessageIndex: number;
}
```

规则：

- `sourceMessageIndex` 必须指向当前 Session 中真实存在的 user 消息；Runtime 校验角色和范围；
- Runtime 不宣称能从语义上证明模型的转述完全等价，但来源索引使错误可审计，并阻止引用不存在的“此前对话”；
- `confirmedConstraints` 只能记录用户明确给出的条件；
- 推测、默认值和为推进方案采用的临时选择进入 `assumptions`；
- `openQuestions` 只保留会显著改变结果的问题；
- 外部事实和数值不进入 TaskBrief，必须来自当前或历史可见 Tool Result；
- TaskBrief 不保存思维链。

### 5.3 决策传输

v0.2.7.1 不扩大 `ModelProvider` 契约去支持厂商专用 Structured Outputs。`understand` 使用普通 `generate()`，要求模型返回一个封闭 JSON envelope；Runtime 使用本地解析与结构校验得到 `TurnDecision`。

解析规则：

- 只接受一个 JSON object，不接受 Markdown fence 或前后解释；
- `kind` 之外的字段按对应分支做严格校验；
- `questions` 数量默认 `1..4`，每项必须为非空短文本；
- `answer.text` 和 `execute.objective` 必须非空；
- TaskBrief 数组设置明确项目数和字符上限；
- 引用非 user 消息或不存在索引的 confirmed constraint 视为非法；
- 首次结构非法时允许一次无 Tool 的格式修复请求；第二次仍非法则以稳定 Runtime 错误结束，不执行 Tool、不把原始输出写成 assistant 回答。

格式修复不是模型网络错误重试，不受 `modelRetries` 控制；每个 Turn 最多一次，并记录为真实 Model Attempt。

## 6. 澄清策略

`clarify` 用于缺少会显著改变方案的约束，而不是追求信息完美。旅行规划至少评估：

- 时间范围或总天数；
- 日期或季节性要求；
- 起终点与取还车条件；
- 人数、驾驶员或驾驶强度；
- 预算级别；
- 住宿、路线和兴趣偏好。

模型只询问当前确实关键且尚未回答的问题，最多四项；可把紧密相关的小项合并为一个问题。不得在澄清回答中同时提供带具体天数、站点、价格、里程或时长的行程骨架。

下一条用户消息不需要特殊命令。Session 历史包含原目标、assistant 澄清问题和用户补充；新的 `understand` 决策据此继续同一任务。若用户明确切换目标，模型生成新的 TaskBrief，旧任务不成为新任务约束。

## 7. 执行与综合

### 7.1 execute_tools

只有 `execute` 决策通过校验后才组装 Tool definitions。执行请求包含：

- 可见 Session 历史；
- 已校验 TaskBrief；
- 当前执行 objective；
- capability instructions；
- 明确的 `execute_tools` phase policy。

继续复用 v0.2.7：

- `ToolRegistry` 与 `ToolRuntime`；
- Permission 和 Approval；
- Tool Call/Result 消息持久化；
- `DEFAULT_MAX_TOOL_ROUNDS`；
- 重复写入与重复失败保护；
- Web Tool 的 SSRF、timeout、取消和不可信内容边界。

`execute_tools` 可以多轮调用工具，但模型第一次不再产生 Tool Call 时只表示证据收集结束，不表示 Turn 已交付。

### 7.2 synthesize

Runtime 随后调用 `generate()`，请求不含 Tool definitions。综合输入包含 TaskBrief、execution objective、已执行 Tool Call/Result 和执行限制。

综合输出必须：

- 直接完成用户目标，而不是只列地点或研究笔记；
- 对旅行规划给出与确认天数一致的每日方案；
- 明确标注仍存在的假设；
- 把外部事实归因于 Tool 结果，不把推测说成已查证事实；
- 对里程、时间、价格等派生数字标记为估算，并说明主要依据或不确定性；
- 在证据不足、Tool 被拒绝或失败时清楚缩小结论范围；
- 不声称存在 Session 中没有的历史条件。

现有 `projectSources` 引用清理继续在最终综合文本上执行。v0.2.7.1 不新增通用 Web citation 格式；网页 provenance 的进一步投影留给后续版本。

## 8. 简单问答兼容

不启用 Tool 的 Session 保留现有单次 `generate()` 路径，避免把 v0 的最小对话强制变成两次模型调用。

启用 Tool capability 的 Session 使用阶段决策：

- 简单知识、改写、解释等无需 Tool 的请求返回 `answer`；
- 缺少关键约束的复杂任务返回 `clarify`；
- 需要当前项目或外部事实的任务返回 `execute`。

这是 v0.2.7.1 的有意边界：阶段控制只作用于具备 Tool Calling 的 Agent 路径，不改变纯聊天 Provider 的现有行为。未来若现实测试证明纯聊天也需要统一 planner，再单独设计。

## 9. Session 与持久化

### 9.1 消息事实源

继续满足：任何实际发送给模型的对话消息都能由 Session 状态重建。

- user 输入先保存；
- `clarify` 问题作为 assistant 消息保存；
- Tool Call/Result 按实际顺序保存；
- 只有通过校验的 `answer` 或有效 synthesize 输出作为最终 assistant 文本保存；
- 决策 JSON 是控制记录，不伪装成用户可见 assistant 对话。

### 9.2 任务状态

ChatSession 只保存一个可选的当前 `TaskBrief`，用于下一 Turn 延续澄清任务。它通过现有 `onSessionStateChanged` 路径持久化，并作为 Session state 的可选向后兼容字段；旧 Session 缺失时按 `undefined` 处理。

每次有效 decision 原子替换当前 TaskBrief。新任务、`/new` 或新 Session 不继承旧 TaskBrief。Context compaction 必须保留当前 goal、confirmed constraints、open questions 和 assumptions 的类别，不把假设升级为用户事实。

### 9.3 Journal

Journal 增加最小可审计记录：

```ts
type TurnActionRecord =
  | ExistingActions
  | { readonly type: "phase"; readonly phase: AgentPhase }
  | {
      readonly type: "decision";
      readonly kind: TurnDecision["kind"];
      readonly repairAttempted: boolean;
    };
```

Journal 不保存决策原始文本或思维链。Model Attempt snapshot 继续保存实际请求；`promptVersion` 必须更新，不再固定为 `v0`。

现有校验需要兼容：

- `completed` 可以引用最终 assistant；
- `needs_user` 必须引用非空的 clarify assistant；
- `blocked` 可以引用向用户解释阻断原因的 assistant；
- `cancelled`、`failed` 不得引用新提交的 assistant；
- 所有终态仍必须有 `endedAt`；取消仍必须记录 `TURN_CANCELLED`。

这修复了当前“只有 completed Turn 才能引用 assistant”与 `ModelResponse.outcome = needs_user | blocked` 之间的契约冲突。

## 10. Prompt 组成

`PromptPhase` 从 `legacy | tool-loop` 演化为：

```ts
type PromptPhase = "legacy" | "understand" | "execute_tools" | "synthesize";
```

建议模块：

- identity：所有阶段；
- runtime-policy：所有阶段；
- decision-policy：仅 understand；
- task-brief：execute_tools、synthesize；
- capabilities：仅 execute_tools；
- synthesis-policy：仅 synthesize。

不得只靠 Prompt 声明“不能调用 Tool”。真正隔离来自请求中不传 `tools`；不得只靠 Prompt 声明 JSON 有效，Runtime 必须解析和校验。

Memory 是不可信 Host context，不能直接变成 confirmed constraints。只有当前 Session 中 user 消息可作为 `sourceMessageIndex`；Memory 可以帮助理解背景，但若会显著改变方案，必须向用户确认。

## 11. 取消与 quiescence

一次 `send()` 创建一个 AbortController，并把同一 signal 传到：

- understand 首次请求；
- decision 格式修复请求；
- Tool Loop 的每次 Provider 调用；
- Approval 与 Tool execute；
- synthesize 请求；
- 相关 Session 持久化边界前的取消检查。

取消后：

1. 不进入下一个阶段；
2. 不发起 decision repair、下一 Tool round 或 synthesize；
3. 不提交 assistant；
4. user 消息保留；
5. Turn=`cancelled`，当前 Attempt=`aborted`；
6. `whenIdle()` 只在已启动资源和持久化全部结算后返回；
7. 下一 Turn 使用新 controller，可以开始新任务或继续表达，不重放已取消阶段。

`clarify` 已经以 `needs_user` 正常结束，不保持活动 promise、timer 或后台工作。

## 12. 错误和受限执行

- decision JSON 无效且修复失败：稳定的决策协议错误，Turn=`failed`，不执行 Tool；
- Approval 拒绝：保留实际 Tool Result，进入 synthesize 说明受限结果；若没有可用交付则 `blocked`；
- Tool 连续失败或达到轮数上限：不直接返回固定骨架，进入 synthesize 汇总已知信息和限制；
- Tool/Provider 取消：Turn=`cancelled`，不 synthesize；
- synthesize 空文本或 Provider 失败：沿用 Provider/Runtime 错误语义，不提交 assistant；
- 不自动扩大 allowlist、不切换 Provider、不绕过 Approval、不把失败工具结果写成事实。

## 13. 组件变化

建议只增加现实职责对应的文件：

```text
src/core/
  agent-loop.ts       # decision 类型、解析校验、阶段推进纯逻辑
  session.ts          # 编排阶段并复用现有 Tool Loop
  journal.ts          # phase/decision action 与 needs_user 校验
src/prompts/
  decision.ts         # understand JSON 契约
  synthesis.ts        # 完整交付和来源分类规则
  registry.ts         # 新 phase
  compose.ts          # 按 phase 组合
```

若实现中发现 `agent-loop.ts` 只剩类型声明且没有独立可测逻辑，可合并进 `session.ts`，不得为了目录整齐保留空抽象。

## 14. 明确不做

- 通用 Planner、Workflow Engine、状态机框架或 DSL；
- 多任务队列、Agent Registry、Inbox、Cordis、后台任务；
- 子 Agent、并行 Agent 或任务委派；
- 跨 Session 的长期任务恢复；
- 任意数量的澄清问题或无限 decision repair；
- 动态切换 Provider、模型或 capability；
- 自动修改 Profile、网络 allowlist 或 Approval 策略；
- 为旅行领域建立专用路线算法、预算引擎或 schema；
- Web Search、地图 API、订票、支付或写入外部服务；
- 保存或展示模型思维链；
- 用更多 Runtime Policy 文本代替阶段隔离和结构校验。

## 15. 完成标准

v0.2.7.1 只有同时满足以下条件才完成：

1. 模糊旅行请求只产生最多四个关键澄清问题，零 Tool Call；
2. 用户补充条件后继续原任务，不要求重述完整请求；
3. 只有有效 `execute` 决策后才把 Tool definitions 发给 Provider；
4. 支持多轮受控 Tool 调用，并在结束后强制 synthesize；
5. 最终输出与确认天数一致的完整每日方案，而不是地点骨架；
6. 用户条件、Agent 假设、Tool 外部事实和估算保持可辨别；
7. 不声称不存在的历史条件，confirmed constraint 可追溯到 user 消息；
8. understand、Tool/Approval、synthesize 都能取消且满足唯一终态和 quiescence；
9. 取消后可以开始新任务，不重放旧阶段；
10. 现有简单问答、文件 Tool、Memory/Context、CLI/NDJSON 和 v0.2.7 Web Tool 回归通过；
11. 默认验证完全离线，真实联网只在用户明确授权后执行；
12. 文档、类型检查、自动测试、构建、pack 和 diff check 全部通过。

