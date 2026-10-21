# v0.5.3 Goal-driven Agent Runtime 设计

## 1. 背景

Isla 已有 Session、Tool Runtime、Approval、文件、命令、Web、Browser、MCP、Skill、Context、Task State 和 Capability Catalog，但主路径仍接近“模型看到工具后自由决定”。真实对话暴露了任务缩小、遗漏交付物、局部证据泛化、能力不可发现、固定步数停止和未完成误报 completed 等通用问题。

目标不是让 Runtime 判断每句话真假，而是让 Runtime 持有任务契约、能力选择、执行进展和完成状态，使模型不能无声改变用户目标。

## 2. 当前断点

1. `src/core/agent-loop.ts` 已有 `answer | clarify | execute`、`TaskBrief`、`EvidenceRequirement`，但 `runTurn()` 没有稳定 decision phase；`update_task_state` 只是可选 Tool。
2. `CapabilityCatalog`、`CapabilityActivator`、Resolver、Step Snapshot 和 routing tools 已实现并测试；生产 `SessionFactory.create()` 只做静态 Snapshot，没有传入 `resolveCapabilities`，routing tools 也未成为最小常驻能力。
3. Loop 默认 12 Step、自动 28、硬上限 40，并把任何成功 Tool Result 当作进展。
4. Completion Gate 能检查调用闭合、Approval、取消、外部证据和修改后验证，但不知道 deliverables、success criteria、未完成步骤和能力缺口。

## 3. DSH 参考取舍

参考 2026-10-20 查阅的 DeepSeek Harness 官方 Agent Loop、Core、Tool Catalog 和并行调度资料，只采用不变量。

主要来源：

- [DSH Core subsystem](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/core.md)
- [DSH Agent Loop](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/agent-loop/README.md)
- [DSH Tool Catalog](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/tool-catalog.md)
- [DSH parallel tool-call execution note](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/feature/2026-07-10-parallel-tool-call-execution.md)
- [DSH failed tool chain completion discussion](https://github.com/deepseek-ai/deepseek-harness/discussions/4410)

### 采用

- 每个 Step 从权威 Session 派生；模型可见事实先记录再使用；
- Loop 驱动与 Goal/Task、Prompt、Tool、能力呈现和终态策略分责；
- Tool Result 后持续下一 Step，不以低固定步数作为正常结束条件；
- 并行安全由 Tool 对参数作纯函数、fail-closed 分类，未知即串行；
- 安全调用进入有界 rolling pool，exclusive 调用形成 barrier，结果按模型调用顺序提交；
- 调度失败或取消仍必须闭合每个 Tool Call；
- Web Tool Schema 与具体 provider 解耦；
- Goal/Todo 只保存任务事实，不保存思维链。

### 按 Isla 调整

- DSH 默认无内建 Turn Step Budget；Isla 保留可配置的 Model Step、Tool Call、wall clock、无进展和重复失败上限，硬边界进入可恢复 `paused`。
- DSH 并行默认可到 10；Isla 首版默认 4、范围 1-8，只开放验证过的只读 Tool。
- DSH 用插件与 lifecycle hook 扩展；Isla 使用类型封闭的小模块，不引入 Cordis。
- 不整体移植 DSH 的 Goal/Todo/Job/Subagent/Workflow/Terminal 工具族。

### 暂缓与拒绝

暂缓 inbox followup/steer/inject、Subagent、Agent Team、Ralph、Workflow、Jobs、持久 Terminal、spill store、per-agent plugin scope 和 resource-aware 冲突图。

拒绝无限 `while(true)`、按 Tool 名猜并行安全、失败链等待模型自行解释、复制 DSH 包结构/源码，以及用堆 Tool 数量代替能力发现。

## 4. TaskContract

```ts
interface TaskContractV1 {
  readonly version: 1;
  readonly goal: string;
  readonly mode: "answer" | "execute";
  readonly deliverables: readonly string[];
  readonly constraints: readonly { readonly text: string; readonly sourceMessageIndex?: number }[];
  readonly assumptions: readonly string[];
  readonly openQuestions: readonly string[];
  readonly successCriteria: readonly string[];
  readonly evidenceNeeds: readonly {
    readonly topic: string;
    readonly source: "conversation" | "workspace" | "runtime" | "web" | "external-tool";
    readonly required: boolean;
  }[];
  readonly capabilityNeeds: readonly string[];
  readonly steps: readonly {
    readonly id: string;
    readonly title: string;
    readonly status: "pending" | "in_progress" | "completed" | "blocked";
    readonly evidenceRefs: readonly string[];
  }[];
  readonly status: "active" | "needs_user" | "paused" | "blocked" | "completed";
  readonly revision: number;
}
```

不得保存思维链、隐藏推理、凭据、私人命令输出或完整网页正文。

### Decision Phase

每个新用户 Turn 先输出 `answer | clarify | execute`：

- `answer`：无需 Tool 的简单回答，候选文本直接进入现有提交路径；
- `clarify`：缺失信息会实质改变结果、安全边界或不可逆动作；
- `execute`：创建或更新 TaskContract 后进入 Loop。

Decision 不暴露业务 Tool Schema；使用有界 JSON 和严格 parser；最多一次格式修复；不要求思维过程。连续 Turn 必须区分继续、修订、旁支问题和新任务，最新用户要求优先。

Runtime 创建初始 Contract；模型通过现有 task tool 提交完整 revision；Runtime 校验迁移、约束来源和 evidence ref。Tool 成功不会自动把业务步骤标记完成。

## 5. 动态 Capability Resolution

每个 execute Step 常驻最小能力：Task read/update、`capability_search/activate/status`、可用的用户提问能力，以及当前 Step 解析出的业务能力。

Resolver 输入使用当前 goal、active steps、capabilityNeeds、最新用户消息、最近 Tool Result 类型/错误码、已激活能力和 Profile policy，不再对完整历史做单纯关键词匹配。不引入第二个路由模型。

找不到能力时必须先搜索 Catalog；可用受控命令或 MCP 则激活/调用；需要配置、凭据或安装则 `needs_user`；当前确实不支持则 `blocked`，不能用模型记忆冒充执行。Activation 不等于 Approval。

## 6. Progress-aware Loop

```ts
interface AgentLoopBudgetV1 {
  readonly softModelSteps: number;      // 16
  readonly maxModelSteps: number;       // 64
  readonly maxToolCalls: number;        // 256
  readonly maxWallClockMs: number;      // 30 minutes
  readonly maxNoProgressSteps: number;  // 4
  readonly maxRepeatedFailures: number; // 3
}

interface ProgressSignalV1 {
  readonly newEvidence: boolean;
  readonly taskAdvanced: boolean;
  readonly capabilityExpanded: boolean;
  readonly workspaceChanged: boolean;
  readonly verificationAdvanced: boolean;
  readonly questionResolved: boolean;
  readonly repeatedObservation: boolean;
}
```

预算可在 Profile 安全范围内配置；数字是保护边界，不是完成定义。空搜索、重复读取、同一失败和不影响任务的成功调用不算进展。

- soft budget 后仍有进展则自动继续；
- 连续无进展先提醒换策略，仍无进展则 blocked；
- 达到硬 step/tool/time 边界则保存 checkpoint 并 paused；
- “继续”恢复同一 Contract，不重复已完成写入；
- Approval 拒绝不能形成重试循环；
- 失败链耗尽必须 failed/blocked，不能 completed。

## 7. 并行 Tool Group

Tool 增加同步纯函数 classifier：只返回 `parallel-safe | exclusive`。缺失、未知、抛错或参数非法全部 exclusive；首版不做兄弟资源冲突比较。

默认并发 4、范围 1-8。安全调用进入 rolling pool；exclusive 前 drain、执行时独占；结果按模型 Call 顺序写入。调度失败时 drain 在途调用并为所有 Call 产生真实或合成 Result；取消停止新派发，未派发调用得到 `ABORTED_BEFORE_DISPATCH`。

首批候选：`read_text_file`、`glob_project`、`grep_project`、`search_project`、独立 dispatcher 的 `web_fetch`、同时通过声明和本地策略的只读 MCP Tool。写文件、命令、Browser、Task、Question、Credential、Session mutation 始终 exclusive。

## 8. Tool 能力补全

### Provider-independent Web Search

Search 配置与主聊天 Provider 解耦，使用独立 `searchProvider` 和稳定 `web_search` Schema；首版复用现有 DeepSeek 官方实现，但不要求主 Provider 是 DeepSeek。未配置时 Capability 明确 unavailable。Search 发现来源，Fetch/Browser 才读取原文。

### 只读 Git Capability

增加 `git_status/git_diff/git_log/git_show`：只允许当前 workspace repo、固定 argv、有界脱敏输出；不允许 fetch/pull/checkout/reset/clean/commit/push。

### 安全 System Inspection

提供平台、架构、Runtime 版本、可执行文件可用性、端口/服务摘要和代理配置 presence 的结构化只读观察。默认不返回环境变量值、凭据、完整进程参数或主目录内容；深入调查继续使用需 Approval 的 `run_command`。

Resource Job Tool 暂缓到独立版本，避免把长任务语义混入本轮主 Loop 重构。

## 9. Completion Gate V2

候选终答必须同时满足：Tool 全闭合；没有活动执行/Approval；必要步骤无 pending/in_progress；deliverables 已覆盖；required evidenceNeeds 有合法 evidence ref；修改后验证合格；最近失败链已恢复；outcome 与 completed/paused/blocked/needs_user 一致。

首次拒绝注入简短缺口；同一缺口第二次出现则结构化非完成终态，避免无限提醒。TaskContract 不是正确性证明，只保证模型必须继续、说明阻塞或显式修订范围。

## 10. 状态与可观测性

- Stored Session 增加可迁移 TaskContract/LoopCheckpoint；历史 Session 继续可读；
- Capability Activation 真正恢复并参与下一 Step；
- CLI/NDJSON/Host 使用统一 outcome；
- `/trace` 增加 decision kind、Task revision/步骤计数、每 Step capability count/schema bytes/hash、Tool/并行计数、Progress 布尔摘要、completion rejection 和预算停止原因；
- 不输出用户正文、任务内容、Tool 参数/结果、命令输出、URL query、密钥或完整 Schema。

## 11. 重新评估条件

跨进程/跨小时任务触发 Job；单 Agent 确实无法拆分时触发 Subagent；资源级冲突触发 resource-aware scheduler；Tool Result 成为主要上下文瓶颈时触发 spill；TaskContract 无法表达分支计划时触发 Workflow/Plan Graph。
