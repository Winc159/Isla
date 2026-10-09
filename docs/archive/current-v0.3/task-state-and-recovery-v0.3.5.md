# Isla v0.3.5 任务状态与可恢复执行

状态：v0.3.5 已完成。Batch A-F 已实现；任务状态、Session v4、workspace 隔离、恢复摘要、`/task`、模型契约收口和真实 Qwen 评估均已通过。

## 目标

v0.3.5 把 Isla 从“单个 Turn 内完成工具闭环”推进到“一个任务可跨 Turn、进程重启和显式 Session 切换继续执行”。本版复用已有 `TaskBrief`、Session Store、Context Checkpoint、Journal、VerificationStatus 和 Agent Loop，不引入通用 Planner、工作流引擎、后台 Job 或子 Agent。

目标链路：

```text
建立任务 → 记录约束与步骤 → 执行并更新状态 → 中断/退出
        → 按 workspace 恢复 → 展示恢复摘要 → 继续执行 → 完成归档
```

## 一、已解决的缺口

本版解决了以下缺口：

- `TaskBrief`：目标、确认约束、开放问题、假设；
- StoredSession v4：按 workspace 隔离并保存 `task`、`journal`、`context` 和消息；
- RequestContextBuilder：可把任务状态注入模型请求；
- `/sessions`、`/new` 和 NDJSON `session_changed`；
- 修改后验证状态可由 Journal 恢复；
- Runtime 维护 TaskState revision，模型不再管理 CAS；
- 任务 Tool 使用完整、严格、顶层 JSON Schema；
- 同一 Turn 不重复注入完整 TaskState，重复快照幂等；
- 完成状态、`/task`、恢复摘要和跨重启继续执行已接通。

但当前 `TaskBrief` 缺少稳定更新入口，不能表达步骤进度、阻塞和完成状态；启动恢复只按 Provider/Model 选择最新 Session，无法隔离不同 workspace。真实评估已证明，跨 workspace 复用旧 Journal 会让只读任务继承错误的修改验证状态。

## 二、任务状态契约

### 1. `TaskStateV1`

以新类型替代内部的 `TaskBrief`，旧名称保留为迁移读取类型：

```ts
type TaskStatus = "active" | "blocked" | "completed";
type TaskStepStatus = "pending" | "in_progress" | "completed" | "blocked";

interface TaskConstraint {
  readonly text: string;
  readonly sourceMessageIndex?: number;
}

interface TaskStep {
  readonly id: string;
  readonly title: string;
  readonly status: TaskStepStatus;
}

interface TaskStateV1 {
  readonly version: 1;
  readonly revision: number;
  readonly goal: string;
  readonly status: TaskStatus;
  readonly constraints: readonly TaskConstraint[];
  readonly assumptions: readonly string[];
  readonly openQuestions: readonly string[];
  readonly steps: readonly TaskStep[];
  readonly blockers: readonly string[];
  readonly updatedAt: string;
}
```

字段约束：

- `goal` 1-1000 字符；
- `revision` 为 Runtime 管理的非负单调整数，不暴露为模型输入；
- constraints、assumptions、openQuestions、steps、blockers 各最多 32 项；
- 单项最多 1000 字符；
- step id 为 Runtime 生成或校验的短稳定 ID，不使用路径和正文作为 ID；
- 同时最多一个 `in_progress` step；
- `completed` 任务不能存在 pending、in_progress 或 blocked step；
- `blocked` 任务必须至少有一个 blocker 或 openQuestion；
- `updatedAt` 由 Runtime 写入，模型不能提供。

### 2. 状态边界

TaskState 只记录继续任务所需的摘要，不保存：

- API Key、Token、Authorization、真实 `.env` 内容；
- stdout/stderr、完整命令、文件正文；
- 模型思维链；
- Approval 请求正文和私人会话逐字内容；
- 已经可以从 Journal 或消息重建的大段事实。

验证状态继续由 Journal 推导，不复制进入 TaskState。请求模型时并列注入 TaskState 摘要与 VerificationStatus，避免双事实源。

## 三、任务状态更新能力

### 1. 新增 `task-state` Capability

提供一个模型可见 Tool：

```ts
update_task_state({
  goal: string;
  status: "active" | "blocked" | "completed";
  constraints: Array<{ text: string; sourceMessageIndex?: number }>;
  assumptions: string[];
  openQuestions: string[];
  steps: Array<{
    id?: string;
    title: string;
    status: "pending" | "in_progress" | "completed" | "blocked";
  }>;
  blockers: string[];
})
```

采用整体快照更新，而不是 JSON Patch 或逐字段命令。理由是状态规模受限，完整快照更容易校验、持久化、恢复和测试。

模型可见 JSON Schema 必须完整声明顶层状态字段、必填项、枚举和嵌套对象，并拒绝未知字段；不能只声明无结构 object 后依赖 Runtime 二次校验，也不增加无语义价值的 `state` 包装层。真实 Qwen 评估证明，无字段定义时模型会自行生成 `task` 等不同字段，嵌套包装则会出现层级漂移，导致更新在 Runtime 校验阶段失败。

### 2. 调用规则

- 普通问答和一次性只读请求不要求创建 TaskState；
- 任务预计跨多个 Tool、多个 Turn，或用户明确要求继续、暂停、恢复时创建；
- 目标、用户约束、步骤状态或 blocker 发生实质变化时更新；
- 不在每个 Tool Call 后机械更新；
- 模型不读取或提交 revision；Runtime 使用当前状态 revision 完成一致性检查；
- 同一 Turn 内不重复注入完整 TaskState；模型从自己的 Tool Call 与简短结果继续执行；
- `completed` 只能在 Completion Gate 接受最终交付后由 Runtime 落盘；模型请求 completed 只是完成意图；
- 用户新指令改变目标时更新现有任务，不自动创建并行任务。

### 3. 权限与运行时

- 权限类型使用现有的 session-state/internal 类别；若当前权限枚举没有对应类型，新增最小 `session-update`；
- 默认无需 Approval，因为只修改当前 Isla Session 元数据，不执行外部动作；
- 仍受 AbortSignal、Tool 配对、错误归一化和 Step 上限约束；
- Tool Result 只返回状态摘要和稳定错误码，不回显完整私人内容；
- 状态必须先通过 schema 与不变量校验，再原子保存。

### 4. 稳定错误码

```text
TASK_STATE_INVALID
TASK_STATE_CONFLICT
TASK_STATE_TOO_LARGE
TASK_STATE_STALE
```

- INVALID：字段、枚举、步骤关系无效；
- CONFLICT：completed/blocked 等状态与步骤不变量冲突；
- TOO_LARGE：数量或字符上限超出；
- STALE：模型基于旧 revision 更新，当前状态已变化。

TaskState 增加单调 `revision` 或等价的 compare-and-swap 版本，避免并发/重试覆盖较新状态；不引入通用事务框架。

## 四、Session 与 workspace 恢复

### 1. StoredSession v4

新增 StoredSession v4：

```ts
interface StoredSessionV4 {
  readonly version: 4;
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly provider: string;
  readonly model: string;
  readonly workspaceKey: string;
  readonly messages: readonly Message[];
  readonly context?: SessionContext;
  readonly task?: TaskStateV1;
  readonly journal: SessionJournal;
}
```

`workspaceKey` 为规范化 workspace 绝对路径的 SHA-256，不保存为日志或协议字段。Windows 比较时统一盘符大小写与分隔符；macOS/Linux 保持平台路径语义。它只用于隔离 Session，不作为安全 Sandbox 判断依据。

### 2. 自动恢复规则

启动时按以下条件选择最新 Session：

```text
provider + model + workspaceKey
```

- 相同 Provider/Model、不同 workspace 不自动复用；
- v1-v3 Session 没有 workspaceKey，不能自动恢复到任意 workspace；
- 旧 Session 仍可在 `/sessions` 中显示并由用户显式选择；选择后首次保存迁移为 v4，并绑定当前 workspace；
- `/new` 创建空 Journal、空 TaskState 和当前 workspaceKey；
- 切换 Profile 或模型不动态迁移当前 Session，沿用现有“下次启动生效”原则。

### 3. 恢复摘要

恢复时不自动向模型发起请求。首次用户输入前，TTY 显示：

```text
已恢复任务：<goal>
状态：进行中 · 已完成 2/4 · 阻塞 0
验证：未运行
```

只展示受限摘要；`not_applicable` 不显示验证行。NDJSON `ready` 增加可选：

```ts
sessionId?: string;
task?: {
  status: TaskStatus;
  goal: string;
  completedSteps: number;
  totalSteps: number;
  blockerCount: number;
};
verificationStatus?: VerificationStatus;
```

不在 `ready` 输出 constraints、assumptions、blockers 正文或消息历史。

## 五、用户入口

### 1. `/task`

新增只读 TTY 命令：

```text
/task
```

输出：goal、status、步骤标题与状态、开放问题数量、blocker 数量和 VerificationStatus。默认不输出约束、假设和 blocker 正文；后续确有需求再设计详细模式。

无任务时输出 `当前 Session 没有活动任务`。

### 2. NDJSON

新增请求：

```ts
{ type: "task_get"; id: string }
```

响应：

```ts
{
  type: "task_state";
  id: string;
  sessionId: string;
  task?: TaskStateV1;
  verificationStatus: VerificationStatus;
}
```

NDJSON 是受信本地协议，可以返回 TaskState，但不返回消息、Journal、命令或 Tool Result。v0.3.5 不提供协议侧任意 task 写入，所有更新仍经模型 Tool 和 Runtime 校验。

## 六、模型请求与压缩

- TaskState 作为 Runtime system context 注入，不伪装为用户消息；
- 每次 Model Step 使用当前最新 revision；
- 注入内容有固定字段顺序和总字符上限；
- Context Compaction 不复制 TaskState，checkpoint 只压缩对话历史；
- 恢复时 TaskState、Journal、VerificationStatus 和 checkpoint 独立读取，再统一构造请求；
- Tool Result 和旧模型消息不能覆盖 Runtime 持有的 TaskState；
- Request Snapshot 只记录可重建请求哈希，不新增任务正文日志。

## 七、完成与阻塞语义

### 完成

只有同时满足以下条件，Runtime 才把任务状态持久化为 `completed`：

1. 模型表达完成意图；
2. Completion Gate 接受最终响应；
3. 不存在 pending、in_progress 或 blocked step；
4. 不存在 blocker 和 openQuestion；
5. 修改验证状态符合 v0.3.4.2 契约。

若模型请求 completed 但条件不满足，返回 `TASK_STATE_CONFLICT`，任务维持 active 或 blocked。

### 阻塞

- 用户拒绝 Approval、缺少必须输入、重复验证失败或重复 Tool 失败时，可以落为 blocked；
- blocked 只描述“继续需要什么”，不能把失败伪装为完成；
- 用户下一条消息解决 blocker 后，模型可更新回 active；
- Runtime 自动产生的 blocked outcome 与 TaskState blocked 必须最终一致，但第一版不根据错误正文自动生成 blocker 文本。

## 八、迁移与兼容

- StoredSession v1-v3 继续可读取；
- v3 `TaskBrief` 映射为 TaskStateV1：goal、constraints、assumptions、openQuestions 保留，status=active，steps/blockers 为空；
- `clarificationTurns` 不进入新状态，继续作为旧会话兼容数据读取后丢弃；
- 首次成功保存时写为 v4；
- 旧客户端可忽略 `ready` 和 `response_end` 新字段；
- 不修改 Journal version；
- 不迁移或重写历史 Session 文件，采用读取时投影、保存时升级。

## 九、实施批次

### Batch A：纯状态模型

- TaskStateV1 类型、边界和不变量；
- TaskBrief → TaskState 投影；
- revision/CAS；
- 状态摘要函数。

停点：纯单元测试通过，不接 Provider、Session 或 CLI。

### Batch B：Session v4 与 workspace 隔离

- workspaceKey 规范化和哈希；
- StoredSession v4 读写；
- loadLatest 按 workspaceKey 过滤；
- 旧 Session 显式选择迁移；
- `/new`、`/sessions` 回归。

停点：跨 workspace 污染测试通过，旧 Session 可读取。

### Batch C：Task Capability

- `update_task_state` schema、校验和原子保存；
- Capability 组合；
- Session 事件和持久化；
- stale、conflict、size 错误。

停点：模型 Tool Loop 可创建、更新、阻塞和恢复任务。

### Batch D：请求、完成和阻塞集成

- TaskState 注入 Model Step；
- 完成意图接 Completion Gate；
- blocked outcome 与 TaskState 对齐；
- checkpoint/恢复请求重建。

停点：跨 Turn 与重启后继续执行的请求一致。

### Batch E：TTY 与 NDJSON

- `/task`；
- TTY 恢复摘要；
- NDJSON `ready` 摘要、`task_get`/`task_state`；
- 不泄露日志与协议测试。

### Batch F：全量回归与真实评估

- 完整离线门禁；
- 隔离 Config/Profile/Session 的真实 Qwen 评估；
- 清理 fixture、临时配置和评估正文；
- 文档状态与实现同步。

## 十、离线测试矩阵

### 状态模型

1. 合法 active/blocked/completed；
2. 多个 in_progress 拒绝；
3. completed 仍有未完成步骤拒绝；
4. blocked 无 blocker/openQuestion 拒绝；
5. 数量与字符上限；
6. step id 稳定与重复拒绝；
7. stale revision 不覆盖新状态；
8. TaskBrief 迁移无信息伪造。

### Session 与恢复

1. 相同 Provider/Model/workspace 恢复；
2. 不同 workspace 不自动恢复；
3. Windows 大小写和分隔符规范化；
4. macOS ARM64/Linux x64 路径语义；
5. v1-v3 可读、显式选择后升级 v4；
6. `/new` 清空任务和 Journal；
7. Session 并发保存冲突；
8. 原子写失败不破坏旧 Session。

### Tool 与 Agent Loop

1. 创建多步骤任务；
2. 同一任务增量更新；
3. Tool 重试不重复生成 step；
4. Approval/取消不破坏状态；
5. 完成条件不足返回 conflict；
6. 验证通过后任务完成；
7. 验证失败后任务 blocked；
8. 用户补充信息后 blocked → active；
9. 普通问答不强制创建任务；
10. Step 上限不导致虚假 completed。

### TTY、协议与安全

1. `/task` 无任务和有任务输出；
2. ready 恢复摘要；
3. task_get/task_state 配对；
4. 未知协议字段兼容；
5. API Key、Authorization、Token、命令、输出和文件正文不进入摘要；
6. Request Snapshot、日志和 diagnostics 不记录 TaskState 正文；
7. 旧客户端忽略新字段仍可工作。

## 十一、真实评估场景

使用 Bailian `qwen3.7-plus`，每个场景使用隔离临时 Config/Profile、workspace、sessionDirectory 和 memory database：

1. 两步代码任务：读取 → 修改 → 验证，重启前完成第一步，重启后继续第二步；
2. Approval 拒绝后任务 blocked，用户下一 Turn 改变决定后恢复 active；
3. 验证失败后保存 blocker，重启后修复并验证通过；
4. 同一 Profile 切换到另一 workspace，不恢复旧任务或 Journal；
5. `/new` 后任务为空；
6. 旧 v3 fixture 显式选择后迁移 v4；
7. NDJSON ready 与 task_get 返回一致摘要。

评估记录只保留模型 ID、事件类型、Tool 名、状态枚举、步骤计数、Approval 决策和稳定错误码，不保存 API Key、临时 Config、完整命令、文件正文或模型回答正文。

## 十二、采用、暂缓与拒绝

采用：受限 TaskState、完整快照更新、模型侧无 revision、重复状态幂等写入、简短更新结果、TaskState 不重复进入同一 Turn 的模型表面、Session v4 workspace 隔离、显式恢复摘要、单任务模型、Runtime 完成校验。DSH 的 `todo_write` 证明了窄模型契约、整体替换和日志/持久化状态不额外生成模型消息可以稳定组合；Isla 只采用这些原则，不引入 DSH 的事件框架或 UI 投影。

暂缓：任务树、并行任务、子 Agent、后台执行、计划调度、任务优先级、截止日期、跨设备同步、任务模板、自动测试发现和通用事件溯源。

拒绝：把 revision/CAS 交给模型管理、把聊天历史直接当任务状态、让模型任意写 Session JSON、按 Provider/Model 跨 workspace 自动恢复、把验证结果复制成第二事实源、保存思维链或秘密作为恢复上下文。

## 十三、完成门禁

```text
npm run typecheck
npm test
npm run build
npm run pack:check
npm audit
git diff --check
```

完成标准：全部离线矩阵通过；旧 Session 可读；没有秘密、临时配置、评估正文或 fixture 进入 Git；文档、协议和实际行为一致。已完成结果如下：83 个测试文件通过、4 个跳过，371 passed、6 skipped；typecheck、build、pack dry-run、npm audit 和 diff check 通过。

## 十四、DSH 参考与模型契约收口记录

参考 DSH `todo_write` 后采用了三项原则：模型提交受限的整体快照；状态更新结果保持简短；持久化/UI 状态不额外生成重复的模型上下文。没有引入 DSH 的 Cordis、事件投影、任务树或 UI 框架。

真实 Qwen 评估先发现两个契约问题：无字段定义的 object 让模型生成 `task` 等非 Isla 字段；`state` 包装层又导致参数层级漂移。最终改为顶层完整字段并拒绝未知字段，评估轨迹稳定为 `update_task_state → glob_project → read_text_file → update_task_state`，两次状态更新均成功，最终 `completed`、revision=2、4/4 步完成。

本记录替代此前“Batch D-F 尚未完成”的状态描述；后续若增加任务树、并行任务或后台恢复，应另立设计，不在 v0.3.5 内扩张。
