# Isla v0.1.8 分阶段对话与 Agent Loop

## 目标

v0.1.8 在 v0.1.6 的 Tool Runtime、Approval 和文件沙盒之上，补齐一次用户请求从理解意图到确认完成的最小闭环。

本版本解决以下已出现的真实问题：

- 用户输入未经独立解析就直接进入工具循环，讨论意图可能被误判为执行意图；
- 每轮固定携带最近历史，模型难以区分当前工具事实、历史信息和推断；
- 当前 Agent Loop 把“模型没有调用 Tool”直接视为完成，可能过早结束；
- Tool 失败后缺少统一的恢复判断；
- 所有阶段复用同一组 Prompt，身份和性格说明会干扰分类与工具决策。

v0.1.8 仍保持单 package、CLI 优先、单 Agent 和最多 8 个工具步骤。Shell、网络、向量数据库、子 Agent 和通用工作流引擎不在本版本范围内。

## 一次请求的阶段

```text
用户输入
→ IntentClassifier
→ 必要时询问用户
→ ContextResolver
→ AgentLoop
   → 决定下一动作
   → 执行 Tool
   → 评估结果或失败
   → 继续、完成、询问用户或阻塞
→ FinalResponse
→ TurnSummary
```

各阶段由 Runtime 编排。模型只返回当前阶段规定的结构化结果，不能自行跳过需要用户确认、Approval 或 Sandbox 的边界。

## IntentClassifier

每次普通用户输入先执行一次意图解析，再决定是否进入主对话或工具循环。CLI 命令仍由 CLI 命令路由直接处理，不调用分类模型。

```ts
type IntentKind =
  | "answer"
  | "inspect"
  | "discuss"
  | "execute"
  | "unknown";

interface IntentResult {
  readonly kind: IntentKind;
  readonly goal: string;
  readonly needsHistory: boolean;
  readonly needsTools: boolean;
  readonly requiresUserConfirmation: boolean;
  readonly missingInformation: readonly string[];
}
```

语义固定为：

- `answer`：可直接回答，不需要改变外部状态；
- `inspect`：需要读取当前环境或文件，但不改变外部状态；
- `discuss`：分析、解释、比较或制定方案，不执行写入；
- `execute`：用户已明确要求执行会改变状态的工作；
- `unknown`：分类失败或意图不足以安全决定下一阶段。

讨论中的“怎么修改”“如果删除”“设计一个写入流程”仍属于 `discuss`，不能因为出现写入关键词而强制调用写工具。现有 `requiresWriteTool()` 正则由结构化意图代替。

### 执行确认

Isla 遵守“先讨论并确认设计，再开始实现”：

- `discuss` 只输出分析或方案；
- 从讨论转入会改变状态的 `execute` 前，必须得到用户明确确认；
- 用户在当前消息中已经明确批准已讨论方案时，不重复询问；
- `inspect` 使用只读 Tool，不需要执行确认；
- 执行确认不代替具体 Tool 的 Approval。确认目标后，写入仍按权限策略审批。

Runtime 保存最小的待确认状态，不能仅靠模型从自然语言历史猜测用户是否已经确认。

## ContextResolver 与历史信息

不再默认把固定最近 20 轮全部交给每个模型阶段。Runtime 持有原始会话消息和派生的轮次摘要，ContextResolver 根据当前意图选择最小上下文。

```ts
interface TurnSummary {
  readonly turn: number;
  readonly category: string;
  readonly summary: string;
  readonly decisions: readonly string[];
  readonly pending: readonly string[];
}

interface ContextSelection {
  readonly recentTurns: number;
  readonly summaryTurns: readonly number[];
  readonly reason: string;
}
```

`category` 是短标签，用于快速定位，不限制为两个汉字，也不承担事实恢复；`summary` 和结构化决定才是可供模型使用的信息。

上下文选择规则：

- 当前用户输入始终存在；
- 默认只提供少量最近原始轮次；
- `needsHistory` 为真时，ContextResolver 从摘要中选择相关轮次；
- 只有选中的摘要或原始消息进入后续阶段；
- 当前文件状态必须重新通过 Tool 确认，历史只能说明过去发生过什么；
- ContextResolver 不执行业务 Tool，也不回答用户问题。

v0.1.8 只在当前会话的摘要列表上做选择，不引入 SQLite、Embedding、向量数据库或跨会话全文检索。历史选择效果不足时，再评估 DSH 式 Session Query。

### 摘要的状态归属

每轮最终回答成功后生成一份 `TurnSummary`。摘要是可丢弃、可重建的派生状态，不替代原始 user/assistant 消息。

所有实际发送给模型的内容必须可由以下会话状态重建：

```text
原始消息 + 已持久化摘要 + 当前阶段 Prompt + 当前 Tool 事件
```

若摘要生成失败，主回答仍然有效；Runtime 记录该轮无摘要，后续退回最近原始轮次。摘要不得包含 API Key、令牌、`.env` 内容或 Tool 未返回的推测事实。

## 分阶段 Prompt

`PromptRegistry` 增加阶段概念。同一请求的不同阶段只装配所需 section。

```ts
type PromptPhase =
  | "intent"
  | "context"
  | "discussion"
  | "tool-loop"
  | "completion"
  | "final"
  | "summary";

interface PromptSection {
  readonly id: string;
  readonly phases: readonly PromptPhase[];
  readonly order: number;
  render(context: PromptContext): string | undefined;
}
```

装配原则：

| 阶段 | 必需内容 | 不装配内容 |
|---|---|---|
| `intent` | 分类定义、当前输入、结构化输出要求 | 性格、Tool 说明、完整历史 |
| `context` | 当前意图、摘要目录、选择规则 | 性格、业务 Tool 说明 |
| `discussion` | 身份、必要历史、讨论边界 | 写入强制路由 |
| `tool-loop` | 任务目标、已确认范围、Tool、权限规则、步骤结果 | 性格和修辞要求 |
| `completion` | 任务目标、成功条件、步骤结果 | 性格、无关历史 |
| `final` | 身份、最终状态、确认事实、必要来源 | Tool schema、内部恢复规则 |
| `summary` | 当前 user/assistant、摘要 schema | Tool schema、性格 |

用户提供的自定义 system prompt 仍属于会话状态，但必须声明适用阶段；迁移期间默认只进入 `discussion` 和 `final`，不能污染分类器或完成判定。

## Agent Loop

Agent Loop 不再把“无 Tool Call”等同于完成。每个步骤返回结构化动作：

```ts
type AgentStep =
  | { readonly status: "continue"; readonly toolCalls: readonly ToolCall[] }
  | { readonly status: "completed"; readonly result: string }
  | { readonly status: "needs_user"; readonly question: string }
  | { readonly status: "blocked"; readonly reason: string };
```

Runtime 每步执行以下判断：

```text
读取步骤结果
→ continue：执行 Tool 并记录结果
→ completed：进入 CompletionChecker
→ needs_user：结束本轮并向用户提问
→ blocked：如实说明阻塞原因
```

`CompletionChecker` 独立检查模型提出的完成状态，不生成新的工作计划。它根据意图、成功条件和 Tool 结果返回：

```ts
type CompletionDecision =
  | { readonly complete: true }
  | { readonly complete: false; readonly reason: string };
```

当判定未完成时，原因回填 Agent Loop，继续下一步骤。最多允许 8 个 Tool 步骤；分类、上下文选择、完成检查、最终回答和摘要不计入 Tool 步骤，但每种阶段在一次请求中的调用次数必须有固定上限，防止模型调用无限循环。

## 成功条件

Runtime 提供最小的硬性完成条件，不能全部交给 Prompt：

- `inspect`：至少存在一个与目标相关的成功读取结果；
- 创建文件：目标 `write_text_file` 成功；
- 修改文件：目标文件先成功读取，随后写入成功；
- `discuss` 和 `answer`：不要求 Tool，但不得声称外部状态已经改变；
- Tool 被拒绝、权限拒绝或沙盒阻止时，不能标记执行完成。

模型可判断语义上是否充分，Runtime 判断可机械验证的事实是否成立。

## Tool 失败与恢复

Tool 失败先由 Runtime 分类，再交给 Agent Loop 选择恢复动作：

| 失败 | 允许的恢复 | 是否可改道绕过 |
|---|---|---|
| `INVALID_ARGUMENTS` | 修正参数后有限重试 | 可以 |
| 路径不存在或不明确 | 使用只读目录工具定位 | 可以 |
| `EXECUTION_FAILED` | 根据错误选择同权限 Tool 或有限重试 | 可以 |
| `UNKNOWN_TOOL` | 重新选择已注册 Tool | 可以 |
| `PERMISSION_DENIED` | 说明权限边界或询问用户调整配置 | 不可以 |
| `USER_REJECTED` | 停止该敏感动作并说明 | 不可以 |
| Sandbox 拒绝 | 说明越界目标 | 不可以 |

同一 Tool、同一参数、同一失败连续出现时不得无限重试。v0.1.8 先采用简单重复检测；复杂 retry middleware 暂缓。

## 来源

不强制模型逐项报告 Tool 调用。Runtime 记录本轮成功使用的文件路径；最终回答在用户需要验证事实或模型引用当前项目状态时，可以显示简短的“参考”列表。

来源只能来自成功 Tool 结果，不能由模型自行编造。普通对话不附来源。

## Provider 契约

Intent、Context、AgentStep、Completion 和 Summary 都需要可靠的结构化响应。v0.1.8 先在 Provider 契约中增加统一的结构化生成入口，Provider 负责转换厂商协议，Runtime 负责校验返回值。

结构化结果解析失败时：

- 允许使用同一阶段 Prompt 重试一次；
- 再次失败后返回明确错误或安全的 `unknown` / `blocked`；
- 不从包含自然语言的无效输出中猜测部分字段。

不得把 Provider 私有响应格式泄漏进 `ChatSession`。

## Session 演进

v0.1.8 需要为以下信息确定权威状态：

- 原始 user/assistant 消息；
- 每轮意图结果；
- 待确认执行状态；
- Tool Call 与 Tool Result；
- 每轮摘要；
- 最终完成或阻塞状态。

实现时先完成 v0.1.6 尚未完成的最小 Session Event 投影，再让分阶段请求从事件和摘要重建。旧 `version: 1` JSON 会话必须继续可读；如升级持久化格式，需要显式迁移或兼容读取，不能静默丢弃已有会话。

## DSH 参考结论

本版本参考 DSH 已验证的思路，但按 Isla 的当前规模独立实现。

采用：

- Agent Loop、System Prompt、Tool、Retry 和 Session Query 是不同职责；
- 历史信息通过受限查询或选择进入模型上下文；
- Tool 失败需分类，并区分可恢复失败与权限边界；
- 行为通过阶段和事件状态表达，不依赖一个不断膨胀的 system prompt。

暂缓：

- SQLite Session Query、全文索引和跨会话检索；
- 通用 retry middleware、事件投影框架和复杂插件组合；
- Plan Mode、Todo、Goal、子 Agent、后台任务和并行 Tool。

拒绝：

- 复制 DSH 的 Cordis、monorepo、profiles、bundles 或目录结构；
- 为了形式相似而拆分多个 package；
- 把 DSH 源码作为 Isla 的隐式实现依赖。

## 暂缓

- 跨会话长期记忆和个性画像；
- Embedding、向量数据库和自动知识抽取；
- 多模型路由、动态 Provider 切换和专用小模型；
- 并行分类、并行 Tool 和推测执行；
- 展示或持久化模型完整思维链；
- Shell、网络、删除和外部消息 Tool；
- 自动修改并部署 Isla 自身。

## 重新评估条件

- 每轮分类、上下文选择和摘要造成明显延迟或成本时，评估合并阶段、缓存或专用模型；
- 摘要选择无法稳定恢复相关上下文时，评估关键词索引或 DSH 式 Session Query；
- 8 个 Tool 步骤不足以完成已出现的真实任务时，评估可配置上限和任务预算；
- 出现第二类可恢复外部故障时，再抽象统一 Retry Policy；
- 需要恢复中断中的 Loop 时，升级持久化事件和重放协议。

