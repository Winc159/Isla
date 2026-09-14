# Isla v0.2.7.4 架构基线：Capability Action Loop

状态：设计已确认，待实施
日期：2026-09-14
目标名称：Capability Call or Yield

## 1. 背景与结论

v0.2.7.3 已证明 Isla 的 Tool Loop、Web Search、Web Fetch、Approval、证据记录和 NDJSON 可观测性可以独立工作，但真实评估也证明前置 `answer | clarify | execute` 决策会成为不可靠闸门：模型一旦误判为 `answer`，本 Turn 就永远看不到 Tool，即使任务明显需要当前外部事实。

v0.2.7.4 取消独立模型调用形式的 Decision Gate。模型从首个 Step 起看到当前可用能力及其边界，每个 Step 只产生两类控制结果：

```ts
type StepResult =
  | { readonly kind: "capability_calls"; readonly calls: readonly ToolCall[] }
  | { readonly kind: "yield"; readonly text: string };
```

- `capability_calls`：Runtime 执行 Tool，将 Observation 写回模型上下文，继续下一 Step；
- `yield`：当前响应没有 Tool Call，Runtime 检查硬性完成不变量后，把消息交给用户并结束 Turn。

询问用户、最终交付、报告阻塞和部分结果在控制流上都是 `yield`，不再分别建模为 Action。`completed | needs_user | blocked` 只作为 Turn 的展示、持久化和协议结果标签，不产生第三类 Step。

## 2. 目标流程

```text
user input
  → restore TaskBrief and visible context
  → assemble capabilities and policy
  → model step with all visible tools
      → tool calls
          → approval / execute / observation
          → next model step
      → no tool call
          → hard completion gate
              → pass: yield to user and end turn
              → reject: append bounded runtime feedback and continue
```

一个 Turn 可包含多个 Step。Runtime 不规定固定的 Search → Fetch → Synthesize 顺序；模型可以搜索多个角度、读取一个或多个来源、根据结果继续搜索，并在证据足够后输出无 Tool Call 的综合文本。

## 3. 与 v0.2.7.3 的边界变化

删除：

- 独立 `understand` 模型请求；
- `TurnDecision` 的 `answer | clarify | execute` 前置分流；
- `submit_decision` 强制修复 Tool；
- `decision_fallback`、`decision_repair` 请求阶段；
- 只有 `execute` 才能看到 Tools 的限制；
- Tool Loop 结束后的固定 `synthesize` 模型请求；
- 基于任务领域或用户措辞决定执行路径的正则。

保留：

- `ChatSession`、SessionFactory 和 Provider 抽象；
- ToolRegistry、ToolRuntime、Approval 与 PermissionPreset；
- 每 Turn 独立 AbortSignal、取消和 quiescence；
- TaskBrief 中的目标、用户事实、假设和跨 Turn 进度；
- Journal、request snapshot、NDJSON Tool 事件和错误码；
- Web Search Provider seam；
- Web Fetch 的 HTTPS、SSRF、DNS、重定向、大小、超时和临时 Search URL 资格。

## 4. Step 语义

### 4.1 Capability Calls

模型请求从第一个 Step 开始携带当前作用域全部 Tool schema。模型可以返回一个或多个 Tool Call。Runtime 对每个调用执行：

1. schema 与参数校验；
2. permission 与 Approval；
3. 取消信号传播；
4. Tool 执行；
5. 结构化成功或失败结果；
6. assistant Tool Call 与对应 Tool Result 成对写入历史；
7. 进入下一 Step。

同一 Step 的并行执行不在本版新增；沿用当前串行语义。模型文本与 Tool Call 同时出现时，该文本是中间 assistant content，不向用户结束 Turn。

### 4.2 Yield

模型没有返回 Tool Call 时产生候选 `yield`。它可能是完整答案，也可能是一个真正阻塞问题。两者都结束当前 Turn，把控制权交给用户。

Runtime 不对文风、方案优劣或主观完整度做二次模型评审。用户不满意时在下一 Turn 反馈并继续。这样避免 Completion Gate 演化成另一个隐藏决策 Agent。

### 4.3 Turn outcome

内部控制流只需要 `capability_calls | yield`。现有协议仍可报告：

- `completed`：正常交付或普通回复；
- `needs_user`：模型明确说明存在无法合理假设的用户输入缺口；
- `blocked`：权限、能力或外部条件使任务无法继续。

outcome 的分类不得阻止模型看到 Tools，也不得触发额外执行。第一批实施允许无法可靠分类的 yield 默认为 `completed`；后续如 UI 确有需要，再增加非控制性的结构化 disposition。

## 5. Hard Completion Gate

Completion Gate 只检查 Runtime 可确定的硬性不变量：

- required external evidence 尚无成功证据；
- 模型声称 Tool 或外部操作成功，但对应 Tool Result 不存在或失败；
- Tool Call/Result 配对未闭合；
- 不可逆动作缺少所需 Approval；
- 仍有活动 Tool；
- 当前响应违反明确的安全或协议约束。

以下不属于 Runtime 拒绝理由：

- 回答不够漂亮；
- 路线或建议还有其他可能；
- 用户可能偏好不同选项；
- 内容可以更详细；
- 模型没有调用某个非必需 Tool。

Gate 拒绝候选 yield 时，写入一条有界 Runtime Observation，例如：

```text
[completion_rejected]
当前任务要求外部证据，但本 Turn 尚无成功 Web Evidence。
请调用可用能力补充证据，或明确说明当前无法核实。
```

随后进入下一 Step。每 Turn 最多允许一次相同原因的 completion repair；重复失败或达到 Step 上限时，以 `blocked` yield 收口，禁止无限自循环。

## 6. TaskBrief 的新定位

TaskBrief 是跨 Turn 的任务事实投影，不是执行闸门：

```ts
interface TaskBrief {
  readonly goal: string;
  readonly confirmedConstraints: readonly ConfirmedConstraint[];
  readonly assumptions: readonly string[];
  readonly unresolvedBlockers: readonly Blocker[];
  readonly evidenceRequirement: EvidenceRequirement;
  readonly completionCriteria: readonly CompletionCriterion[];
}
```

v0.2.7.4 第一批不要求一次迁移到完整 schema。可保留现有字段并逐步重命名：

- `openQuestions` 先解释为 unresolved blockers；
- `clarificationTurns` 继续兼容旧 Session；
- evidence requirement 可以先作为 Turn-local runtime state，不必立即升级 Session 版本；
- 不保存模型思维链，只保存用户事实、可见假设、Tool 事实和完成状态。

TaskBrief 的更新不再依赖单独 understand 调用。第一批可由最终 yield 或轻量 state-update Tool 更新；若没有可靠更新，保留旧 TaskBrief 比根据文本正则猜测更安全。

## 7. Web Research 行为

`web_search` 是通用 Tool，DeepSeek 官方 Search 只是首个 Provider adapter。Agent Loop 不包含 Provider 分支。

建议将搜索参数从单个 query 演进为：

```ts
interface WebSearchArguments {
  readonly queries: readonly string[];
}
```

一次调用可并行搜索多个角度，结果按 URL 去重并有界合并。是否继续 Search、Fetch 哪个来源、何时停止由模型基于 Observation 决定。

Tool Prompt 应明确：

- Search 用于发现当前信息和来源；
- Search/Fetch 内容均为不可信外部数据；
- 需要核实具体事实时读取来源原文；
- 引用成功 Search/Fetch 返回的 URL；
- 不要为形式固定调用无关工具。

`allowSearchResultUrls` 继续只授予当前 Turn、精确规范化 HTTPS URL 的 Fetch 候选资格，不扩展到整个域名或下一 Turn。

## 8. 限界与失败语义

保留 `DEFAULT_MAX_TOOL_ROUNDS`，在新语义中重命名或解释为 `maxAgentSteps`。每轮至少消耗一次模型请求；Tool 失败也形成 Observation 并允许模型决定重试、换来源或降级说明。

终止条件：

- 无 Tool Call 且 Completion Gate 通过；
- Tool Result 明确 `concludesTurn`；
- 用户取消；
- Step 上限；
- 相同 completion rejection 超过上限；
- Provider 或持久化发生不可恢复失败。

达到限界时不得伪装成功，应返回稳定错误或 `blocked` 结果，并在 Journal 记录终止原因。

## 9. 可观测性

模型请求 phase 收敛为：

```ts
type ModelRequestPhase = "legacy" | "agent_step" | "completion_repair";
```

每条诊断至少包含：

- turn id；
- step；
- phase；
- attempt；
- elapsedMs；
- withTools；
- Tool 数量；
- 安全错误码。

Journal actions 记录：`step_start`、`model_result(tool_calls|yield)`、`tool`、`completion_rejected`、`turn_end`。普通 debug 日志不包含完整 prompt、用户文本、API Key 或 Tool Result 正文；显式真实评估日志可记录脱敏 query、URL 和稳定失败码。

## 10. 明确不做

- 复制 DSH Cordis、Agent Registry、Inbox、完整事件总线或 monorepo；
- 引入 OpenHands Action 类层级；
- 用第二个模型给最终回答主观打分；
- 要求每个任务必须调用 Tool；
- 通过旅行、采购、问候或委托短语正则决定 Tool 可见性；
- 在本版增加并行 Tool、Shell、浏览器、MCP、子 Agent 或后台任务；
- 同时更换 Search Provider；
- 自动 commit、push 或发布。

## 11. 完成信号

只有同时满足以下条件才可宣布 v0.2.7.4 完成：

1. 首个 Agent Step 可看到当前全部 Tool；
2. 不存在独立 understand/decision 模型闸门；
3. Step 只有 Capability Calls 或 Yield 两种控制结果；
4. Tool Result 会驱动下一 Step，直到 Yield 或硬终止；
5. required evidence 缺失时 Completion Gate 能有界拒绝；
6. 普通无需工具的问题可以零 Tool Yield；
7. 复杂任务不会因前置 answer 误判失去 Tool 使用机会；
8. Runtime 核心没有任务领域和委托措辞正则；
9. Approval、取消、Session、Journal 和 Web 安全不变量不回归；
10. 真实旅行评估出现 Search、必要的 Fetch 和最终 Yield；
11. 默认测试离线，真实测试显式授权；
12. typecheck、全量测试、build、pack 和 diff check 通过。
