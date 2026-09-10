# Luna 实施顺序：Isla v0.1.8

## 使用方式

本文件是 v0.1.8 的执行清单，架构依据为 `docs/architecture-v0.1.8.md`。每次只完成一个步骤，保持项目可运行；不得提前实现后续步骤。

开始每一步前：

1. 读取 `AGENTS.md`、`docs/architecture-v0.1.8.md` 和本文件；
2. 检查工作区已有改动，不覆盖用户修改；
3. 说明本步要修改的契约、文件和测试；
4. 如需改变架构文档中的核心类型或扩大范围，先停止并与用户确认；
5. 未经用户明确要求，不执行 `git add`、提交、推送或远程操作。

每一步完成后运行该步指定测试；阶段完成后运行：

```text
npm run typecheck
npm test
```

最终再运行：

```text
npm run check
npm run build
```

## 当前实现审计

开始实施前先把现有部分实现视为待修正代码，不把“已有类名”当作完成信号。当前已知问题：

1. `PendingExecution` 只保存目标字符串；用户确认后状态被清空，但原任务没有恢复执行。
2. `unknown` 仍可能落入带 Tool 的默认路径。
3. 重复失败只向结果追加提示，没有真正终止相同调用。
4. `TurnSummary` 只是 `response.text.slice(...)`，不包含用户目标、决定、待办、结果和 Tool 证据。
5. 摘要只存在于进程内，重启后丢失。
6. `inspect` 只验证“至少一次读取”，不能证明读取结果覆盖用户目标。
7. Tool 调用和结果没有成为可持久化的 Session Event。
8. `IntentClassifier` 只在存在 Tool Capability 时创建，不符合“每次普通输入先分类”的设计。
9. 分类、上下文选择、最终回答与摘要的 Provider 调用没有统一的结构化响应重试边界。

Luna 应先为这些缺陷补充失败测试，再修改实现。不得通过删除现有测试或放宽安全断言获得绿色结果。

## 实施批次与停点

按以下批次执行；每一批全部测试通过后再进入下一批：

```text
批次 A：修正意图与确认状态
批次 B：重构 Agent Loop 和完成检查
批次 C：失败恢复与来源证据
批次 D：摘要、ContextResolver 和持久化
批次 E：Session Event、请求重建和完整回归
```

同一批次内可以修改多个紧密相关文件，但不要跨批次提前引入后续抽象。

## Step 0：建立行为样例

目标：先把当前问题写成可观察的测试样例，不修改生产行为。

新增覆盖：

- “查看当前文件夹，了解一下自己”分类为 `inspect`；
- “讨论如何修改 Prompt”分类为 `discuss`；
- “按刚才确认的方案修改文件”分类为 `execute`；
- “如果删除文件会怎样”不能进入执行；
- 无 Tool Call 不能自动代表读取或写入任务完成；
- `USER_REJECTED` 和 `PERMISSION_DENIED` 不能通过换工具绕过。

测试可以先针对将要公开的类型和纯函数建立 fixture；不要为了让测试通过而把分类结果硬编码到具体句子。

验证：

```text
npm test -- tests/core/intent.test.ts tests/core/agent-loop.test.ts
```

完成信号：失败测试准确描述 v0.1.8 的目标行为，现有测试结果已记录。

## Step 1：分阶段 PromptRegistry

目标：让 Prompt section 声明适用阶段，保持现有 v0.1.6 调用兼容。

实现：

- 增加 `PromptPhase`；
- `PromptSection` 增加 `phases`；
- `render()` / `compose()` 接收阶段；
- 建立 `intent`、`context`、`discussion`、`tool-loop`、`completion`、`final`、`summary` 的最小 section；
- identity 默认只进入 `discussion` 和 `final`；
- capability 与 runtime policy 只进入需要的阶段。

测试：

- section 只出现在声明阶段；
- 同 order 仍稳定排序；
- 重复 id 仍拒绝；
- intent/tool-loop prompt 不含 personality；
- 旧 compose 行为在兼容入口下不回归。

验证：

```text
npm test -- tests/prompts
npm run typecheck
```

完成信号：阶段 Prompt 可独立快照或断言，尚未改变 ChatSession 主流程。

## Step 2：Provider 结构化生成契约

目标：Runtime 可以请求并校验阶段结构化结果。

实现：

- 在核心 Provider 契约增加结构化生成入口；
- Provider 只负责协议适配，不解释业务字段；
- Runtime 边界负责 schema 校验；
- 无效结构化输出只允许同阶段重试一次；
- 第二次失败返回明确失败，不从自然语言猜字段。

先实现当前实际支持 Tool Calling 的 Provider；如果 OpenAI 或 Local 尚无现实调用需求，保留明确的不支持结果，不做半完成适配。

测试：

- 有效 JSON；
- 缺字段、非法枚举、额外自然语言；
- 首次无效、第二次有效；
- 两次无效；
- Provider 私有格式不会进入核心类型。

验证：

```text
npm test -- tests/providers tests/core
npm run typecheck
```

完成信号：FakeProvider 能按阶段返回确定的结构化结果。

## Step 3：IntentClassifier

目标：每条普通用户输入先得到结构化 `IntentResult`。

实现：

- 新增 `IntentClassifier`；
- 使用独立 intent Prompt；
- 替换 `requiresWriteTool()` 正则路由；
- CLI 命令不进入分类器；
- 分类失败安全退回 `unknown`；
- 每条普通用户输入都经过分类，不以是否启用 Tool 为条件；
- `unknown` 只进入澄清流程，不得调用 Tool；
- 分类器不接收 Tool schema，不执行 Tool。

测试：

- answer / inspect / discuss / execute / unknown；
- 中英文执行与讨论表达；
- 写入关键词不再自动代表 execute；
- 用户已明确确认和仍需确认的区别；
- 分类请求中不存在 personality、Tool 和完整历史。

验证：

```text
npm test -- tests/core/intent.test.ts tests/cli.test.ts
npm run typecheck
```

完成信号：ChatSession 后续路由只依据结构化意图，不再调用关键词正则。

## Step 4：讨论与执行确认状态

目标：讨论不会直接改变外部状态，执行前确认由 Runtime 状态表达。

实现：

- 保存包含原始输入、完整 IntentResult 和拟执行操作的 `PendingExecution`；
- discussion 结束时可产生待确认目标；
- 后续明确确认才能进入 execute；
- 用户当前消息已经明确批准已讨论方案时不重复询问；
- 确认目标不等于批准每个敏感 Tool；
- `/new` 清除待确认状态。
- 用户确认后恢复原任务并进入 execute，不重新分类“确认”文本；
- 用户拒绝或发起不相关新任务时清除旧状态；

测试：

- 讨论后未确认不写文件；
- 确认后进入执行；
- 确认后执行的是原始任务，不是“确认”这条消息；
- 用户否决后清除待确认状态；
- 新话题不会误确认旧任务；
- Approval 仍在执行阶段独立触发。

验证：

```text
npm test -- tests/core/session.test.ts tests/cli
npm run typecheck
```

完成信号：执行授权有明确 Runtime 状态，不依赖模型猜测历史。

## Step 5：TurnSummary 与 ContextResolver

目标：按需选择历史，不再把固定最近窗口交给所有阶段。

实现：

- 每个成功回答后依据 user、intent、outcome 和 Tool evidence 生成 `TurnSummary`；
- 摘要失败不撤销已完成回答；
- ContextResolver 只查看当前意图和摘要目录；
- 选择有限原始轮次与摘要；
- 当前环境事实仍需 Tool 重新确认；
- 旧会话无摘要时退回最近原始轮次。

持久化要求：

- 旧 `version: 1` 会话继续可读；
- 如增加新版本，测试兼容读取和保存；
- 摘要是派生状态，不替代原始消息；
- 不记录 secrets 或未确认 Tool 事实。
- 禁止使用 `response.text.slice(...)` 作为正式摘要实现；

测试：

- 不需要历史时只发送当前输入和最小上下文；
- 需要历史时选中相关摘要；
- 无关摘要不进入请求；
- 摘要失败回退；
- 旧会话兼容；
- 保存后可重建相同模型请求。

验证：

```text
npm test -- tests/core/context.test.ts tests/session-store.test.ts tests/core/session.test.ts
npm run typecheck
```

完成信号：历史选择可测试、可重建、可回退，不依赖数据库。

## Step 6：AgentStep 状态与 CompletionChecker

目标：无 Tool Call 不再自动结束工具任务。

实现：

- 引入 `continue`、`completed`、`needs_user`、`blocked`；
- Tool Loop 只处理结构化步骤；
- completed 必须经过 CompletionChecker；
- 未完成原因回填下一步骤；
- 保留最多 8 个 Tool 步骤；
- 为非 Tool 阶段设置固定调用上限；
- 达到上限时返回明确 blocked，不保存虚假完成回答。

Runtime 硬性检查：

- inspect 至少有相关读取成功；
- inspect 的成功证据必须覆盖分类器给出的 requiredEvidence 或 CompletionChecker 确认的任务范围；
- create 至少有目标写入成功；
- modify 先读后写；
- discussion/answer 不得声称状态已改变；
- 拒绝、权限失败和沙盒失败不能完成执行任务。

测试：

- 模型过早 completed 被打回；
- 补充 Tool 后完成；
- needs_user 正确结束当前轮；
- blocked 如实返回；
- 8 步上限；
- 空 Tool Calls 不等于完成；
- send 与 sendStream 使用同一 Agent Loop 语义。

验证：

```text
npm test -- tests/core/agent-loop.test.ts tests/core/session.test.ts
npm run typecheck
```

完成信号：完成状态同时通过模型语义判断和 Runtime 硬性条件。

## Step 7：失败分类与有限恢复

目标：可恢复失败继续工作，权限边界停止。

实现：

- 为 Tool 失败补充稳定分类；
- INVALID_ARGUMENTS 可修正参数；
- 路径不明确可先读取目录；
- EXECUTION_FAILED 允许有限重试或同权限替代 Tool；
- UNKNOWN_TOOL 只能选择已注册 Tool；
- USER_REJECTED、PERMISSION_DENIED、Sandbox 拒绝禁止绕过；
- 检测相同 Tool、参数和失败的重复调用。
- 达到重复阈值后 Runtime 真正返回 blocked；只追加提示文字不算停止；

测试：

- 参数修正后成功；
- 路径定位后成功；
- 相同失败停止重复；
- 用户拒绝后不再尝试写入；
- 权限失败后不换方式绕过；
- Tool 异常仍不会穿透 Agent Loop。

验证：

```text
npm test -- tests/core/tool-runtime.test.ts tests/core/agent-loop.test.ts tests/sandbox.test.ts
npm run typecheck
```

完成信号：每类失败都有确定恢复语义和测试。

## Step 8：来源与最终回答

目标：必要时提供可验证来源，不暴露冗长工具轨迹。

实现：

- Runtime 汇总成功读取或写入的项目相对路径；
- FinalResponse 只接收已确认事实、最终状态和来源候选；
- 当前项目状态回答可显示简短“参考”；
- 普通闲聊不显示来源；
- 模型不能添加未成功访问的路径。

测试：

- 成功读取路径可以引用；
- 失败路径不能引用；
- 模型伪造路径被过滤；
- 普通回答不附工具清单；
- final Prompt 不含 Tool schema 和内部恢复细节。

验证：

```text
npm test -- tests/core/session.test.ts tests/prompts
npm run typecheck
```

完成信号：来源来自 Runtime 事实，用户输出保持简洁。

## Step 9：Session Event 补齐与请求重建

目标：完成 v0.1.6 遗留项，并证明所有模型请求可从 Isla 状态重建。

记录至少包括：

- user / assistant；
- intent；
- confirmation；
- tool call / tool result；
- completion / blocked；
- turn summary。

测试：

- Provider 调用失败后 user 仍在状态中；
- 无效 assistant 不进入历史；
- Tool Loop 中间状态可投影；
- 相同事件与摘要产生相同阶段请求；
- Approval 和 Tool 结果不会遗失；
- 旧会话兼容读取。

验证：

```text
npm test -- tests/core/session.test.ts tests/session-store.test.ts
npm run typecheck
```

完成信号：模型看到的每条消息都有可追溯的 Isla 状态来源。

## Step 10：回归、真实场景与文档同步

增加端到端 FakeProvider 场景：

1. 查看项目：分类 → 最小上下文 → 多次读取 → 完成检查 → 带可选来源回答；
2. 讨论修改：只讨论 → 用户确认 → 读取 → 写入审批 → 完成；
3. 写入失败：参数失败 → 修正 → 成功；
4. 用户拒绝：写入审批拒绝 → 停止 → 不声称完成；
5. 历史问题：ContextResolver 只选中相关摘要；
6. 阶段输出无效：重试一次 → blocked；
7. Tool 步骤达到上限：安全结束并保留真实状态。
8. 自省审批/沙盒：连续读取相关源码，区分源码默认机制和当前动态配置，不在读完入口文件后询问是否继续；
9. 确认恢复：讨论产生待执行任务，用户确认后执行原任务；
10. unknown：分类失败后只询问用户，零 Tool Call；
11. 重复失败：第二次相同失败后进入 blocked，第三次 Tool Call 不发生；
12. 摘要恢复：重启 Session 后仍能按摘要定位相关历史。

最终验证：

```text
npm run check
npm run build
npm run pack:check
```

同步：

- 更新 `docs/roadmap.md` 的完成项和遗留项；
- 更新 `docs/dsh-reference-review.md` 的采用、暂缓和拒绝；
- 如果实现偏离本架构，先记录原因和重新评估条件；
- 报告实际测试数量、跳过数量和失败数量，不复用旧结果。

## 禁止顺手实现

- 不新增 Shell、网络、删除、MCP 或子 Agent；
- 不引入数据库、Embedding 或向量检索；
- 不引入 Cordis、monorepo 或通用工作流框架；
- 不展示或持久化完整思维链；
- 不让分类器获得执行 Tool 的能力；
- 不用 Prompt 代替 Approval 或 Sandbox；
- 不因测试困难删除现有安全检查或降低断言。

## Luna 最终交付格式

实现结束后必须报告：

```text
完成的步骤：
核心行为变化：
新增或升级的持久化版本：
旧会话兼容方式：
测试文件数量：
测试通过/跳过/失败数量：
typecheck：
build：
pack:check：
未完成项：
Git 操作：
```

只有 Step 0–10 的完成信号全部满足且最终验证通过，才能声明 v0.1.8 完成。若 `pack:check` 因环境缺失无法运行，应明确记录“未验证”和错误原因，不能写成通过。
