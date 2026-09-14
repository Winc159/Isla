# Isla v0.2.2 可靠会话与可观测性架构

状态：已确认，待实施
日期：2026-09-12
执行者：Luna
基线：v0.2.1

## 1. 目标

v0.2.2 解决真实使用中已经出现的可靠性与可解释性问题：

- 普通模型请求可能失败或返回空回答，但旧真实 smoke 仍可能误判场景通过；
- 用户等待期间需要稳定的整轮 loading，而不是只在 Tool 执行时显示；
- 记忆可能已经保存但因检索问题没有进入请求，现有日志难以定位请求实际使用了哪些上下文；
- Provider 失败、Tool 失败、Approval、持久化失败和进程中断缺少统一、可恢复的 Turn 终态；
- 当前只能看到最终 messages，无法解释一次模型尝试为什么失败、重试或停止。

本版本建立最小 Turn Journal、请求快照、错误分类和 Session Inspect，使一次请求从用户输入到最终终态可追踪、可验证、可恢复。

本版本不增加新的外部 Tool，不建设通用事件总线、工作流引擎或完整事件溯源平台。

## 2. 当前基线

v0.2.1 已具备：

- `StoredSession.messages` 保存 user、assistant、assistant Tool Call 和 tool result；
- Session version 2、Working Memory checkpoint 和原子 JSON 保存；
- 统一 Agent Loop、Tool Runtime、Permission、Approval 和 Sandbox；
- CLI 与 NDJSON 两种入口；
- SQLite 长期记忆、关键词/向量召回和跨会话记忆；
- Tool 生命周期事件和真实 NDJSON 测试日志；
- 默认离线测试、显式真实 smoke。

当前缺口：

- Provider 只抛普通 `Error`，上层主要依赖错误文本分类；
- 失败模型尝试不会形成可检查的持久记录；
- Session 无法区分运行中、完成、失败、blocked 和进程中断的 Turn；
- 模型请求中的 Prompt、Working Memory、召回资料和 Tool schemas 没有一次请求级快照；
- Session 恢复后无法判断上一轮是否在中途退出；
- `/sessions` 只能选择会话，不能查看会话运行健康状态；
- 记忆召回缺少稳定的离线问法评测集。

## 3. DSH 参考与取舍

### 3.1 采用

参考 DeepSeek Harness 的以下不变量：

- Turn、Step、模型 Attempt 与 Tool 生命周期具有明确边界；
- 没有形成有效 assistant message 的模型尝试也应保留失败事实；
- 失败 attempt 不得伪造成模型可见 assistant history；
- Tool Call 与 Tool Result 通过稳定 call ID 配对；
- 请求所用 Provider、模型、Prompt 和 Tool schemas 应可追溯；
- Session 查询是只读职责，不进入 Agent Loop；
- Compaction 和请求投影不能删除原始对话事实。

### 3.2 按 Isla 规模简化

- 不采用 DSH 的完整 append-only Session Event Map；
- 不采用 Surface replacement、declaration merging、Cordis 生命周期或多 package；
- 不保存 Provider 原始流或完整思维链；
- 不为所有内部动作建立通用事件总线；
- 不引入 SQLite Session Query；
- 不把 Turn Journal 变成插件扩展点。

### 3.3 Isla 的核心决定

`StoredSession.messages` 继续是唯一对话正文事实源。Turn Journal 只记录生命周期、索引引用、请求快照和错误元数据：

- 对话恢复只读取 `messages` 与 `context`；
- Journal 不生成、覆盖或删除消息；
- Journal 中不得复制 assistant 正文、Tool Result 正文或用户秘密；
- 精确请求快照允许保存实际发送的 system/derived context，因为它属于私人 Session 数据，但不得进入普通 debug 日志、npm 包或测试 fixture；
- message history 与 journal 不一致时，以 messages 为对话事实，Session Inspect 明确报告 journal inconsistency。

## 4. 核心不变量

1. `StoredSession.messages` 是唯一对话正文事实源。
2. user message 必须在第一次模型调用前持久化。
3. 只有有效模型回答才保存为 assistant message。
4. 失败 attempt 必须可审计，但永远不投影为 assistant history。
5. 每个 Turn 必须有唯一 ID、单一开始和最多一个终态。
6. `running` Turn 在进程恢复时转换为 `interrupted`，不得伪装为 completed。
7. Tool Call/Result 和 Approval 通过 call ID 关联到同一 Turn 与 Step。
8. 请求快照记录模型实际收到的消息和 Tool definitions；后续记忆或 Prompt 变化不能改写历史快照。
9. 请求快照属于私人会话数据，不进入默认日志或 npm 包。
10. Provider 错误使用稳定类型和 code，不依赖英文错误文本决定语义。
11. 自动重试只允许发生在尚未产生 Tool 副作用的单次模型调用边界；默认重试次数为 0。
12. loading、CLI、NDJSON 和 Journal 观察的是同一 Turn 生命周期。
13. Journal 或 Inspect 写入失败不得伪造主回答成功；是否允许主回答继续由持久化阶段决定。
14. 不恢复 IntentClassifier、Planner、CompletionChecker 或通用多阶段工作流。

## 5. Session version 3

```ts
interface StoredSessionV3 {
  readonly version: 3;
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly provider: string;
  readonly model: string;
  readonly messages: readonly Message[];
  readonly context?: SessionContext;
  readonly journal: SessionJournal;
}

interface SessionJournal {
  readonly version: 1;
  readonly turns: readonly TurnRecord[];
}
```

version 1 和 version 2 继续读取；第一次成功保存时升级为 version 3。升级不得修改、删除或重新排序原始 messages。

Journal 与 messages/context 保存在同一个 JSON 文件，并通过现有临时文件加 rename 的方式原子保存，不创建第二个会话日志文件。

## 6. Turn Journal

```ts
type TurnStatus =
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "needs_user"
  | "interrupted";

interface TurnRecord {
  readonly id: string;
  readonly sequence: number;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly status: TurnStatus;
  readonly userMessageIndex: number;
  readonly assistantMessageIndex?: number;
  readonly attempts: readonly ModelAttemptRecord[];
  readonly actions: readonly TurnActionRecord[];
  readonly error?: SafeErrorRecord;
}
```

约束：

- `sequence` 从 1 单调递增；
- `userMessageIndex` 必须指向对应 user message；
- completed 必须指向非空 assistant message；
- failed/interrupted 不得伪造 assistantMessageIndex；
- blocked/needs_user 只有在 Runtime 实际产生对应 outcome 时使用；
- Turn 修改只允许追加 Attempt/Action 或从 running 转入一个终态；终态不可回退。

## 7. Model Attempt 与请求快照

```ts
type ModelAttemptStatus = "running" | "succeeded" | "failed" | "interrupted";

interface ModelAttemptRecord {
  readonly attempt: number;
  readonly step: number;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly status: ModelAttemptStatus;
  readonly request: ModelRequestSnapshot;
  readonly usage?: TokenUsage;
  readonly error?: SafeErrorRecord;
}

interface ModelRequestSnapshot {
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly messages: readonly Message[];
  readonly tools?: readonly ToolDefinition[];
  readonly toolChoice?: ModelRequest["toolChoice"];
  readonly retrievedSourceIds: readonly string[];
  readonly requestHash: string;
}
```

请求快照保存模型真正收到的 request，不保存 API Key、HTTP header、Provider 原始响应、思维链或未发送的候选上下文。

`requestHash` 使用稳定 JSON 序列化后计算 SHA-256，用于检测持久化损坏和重建漂移，不用作安全签名。

Prompt Registry 为当前组合输出稳定 `promptVersion`。Tool schemas 的顺序必须稳定，否则同一请求会得到不同 hash。

## 8. Turn Action

```ts
type TurnActionRecord =
  | { readonly type: "tool"; readonly step: number; readonly callId: string; readonly tool: string; readonly ok: boolean; readonly code?: string }
  | { readonly type: "approval"; readonly step: number; readonly callId: string; readonly tool: string; readonly decision: "approved" | "rejected" }
  | { readonly type: "checkpoint"; readonly throughMessageIndex: number }
  | { readonly type: "memory_retrieval"; readonly sourceIds: readonly string[] };
```

Action 只保存结构化结果和引用：

- 不保存 Tool 参数或完整 Tool Result；
- Approval 保存决定，不保存用户输入的自由文本理由；
- Memory retrieval 保存 record/chunk ID，不复制长期记忆正文；
- 当前文件状态仍必须通过新 Tool 调用确认。

## 9. 错误模型

```ts
type RuntimeErrorCode =
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_NETWORK"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_AUTH"
  | "PROVIDER_EMPTY_RESPONSE"
  | "PROVIDER_INVALID_RESPONSE"
  | "PERSISTENCE_FAILED"
  | "TOOL_FAILED"
  | "USER_REJECTED"
  | "PERMISSION_DENIED"
  | "SANDBOX_DENIED"
  | "INTERRUPTED"
  | "UNKNOWN";

interface SafeErrorRecord {
  readonly code: RuntimeErrorCode;
  readonly recoverable: boolean;
  readonly message: string;
}
```

Provider adapter 在最接近协议的位置把 HTTP/SDK 错误转换为稳定 code。安全 message 不包含 URL query、header、Key、请求正文、记忆正文或 Tool Result。

默认 `ISLA_MODEL_RETRIES=0`。若用户显式设为 1，只对 `PROVIDER_TIMEOUT`、`PROVIDER_NETWORK`、`PROVIDER_RATE_LIMIT` 做一次模型调用级重试；AUTH、空响应、无效响应、持久化失败、用户拒绝和任何 Tool 结果都不自动重试。

## 10. 恢复语义

加载 version 3 Session 时：

1. 验证 messages、context 和 journal schema；
2. 验证 message index、sequence、Turn 终态和 Attempt 状态；
3. 把最后一个未终结的 running Turn/Attempt 标记为 interrupted；
4. 原子保存恢复结果后才接受下一条用户输入；
5. 不删除已持久化 user message；
6. 不自动重放中断的模型调用或 Tool；
7. 用户后续说“重试”时作为新 Turn 处理。

## 11. Session Inspect

新增只读命令：

```text
/trace
/trace <turn-number>
```

默认 `/trace` 显示当前会话最近 10 个 Turn：

- sequence、状态、耗时；
- 模型 attempt 数量及错误 code；
- Tool 名称与成功/失败；
- Approval 批准/拒绝；
- 召回来源数量；
- 是否使用 Working Memory checkpoint；
- request hash 前 12 位。

`/trace <turn-number>` 显示单 Turn 的安全结构化详情。默认不显示 prompt、用户正文、assistant 正文、Tool Result、记忆正文或完整请求快照。

不增加 `/trace --raw`。需要读取完整私人 Session JSON 时，用户直接检查本地会话文件。

## 12. CLI 与 NDJSON

NDJSON 是 Codex、自动化测试驱动和其他外部控制方与 Isla Runtime 对话的正式机器边界。2.2 的可靠性能力必须在该边界可观察并生效：Turn 终态、稳定错误 code、Tool/Approval 生命周期和会话切换不能只存在于交互式 CLI。

- CLI 从 Turn 开始到终态持续显示 loading；
- Tool 执行不重新创建第二个 spinner；
- 错误输出使用稳定 code 和用户可理解的安全信息；
- NDJSON 保持现有 schema，v0.2.2 不增加 breaking event；
- `response_start` 对应 Turn 开始，`response_end` 只用于有效最终回答；
- 请求失败输出 `error`，不得再追加一个空文本 `response_end`；
- Tool、Approval、Session 切换和 `bye` 语义保持不变；
- 真实测试日志仍需显式设置 `ISLA_NDJSON_LOG`，并继续被 `.gitignore` 排除。

## 13. 记忆召回评测

建立完全离线的固定评测集，至少覆盖：

- 中文同义和不同句式；
- 英文大小写与关键词；
- 中英文混合；
- global/workspace 隔离；
- 当前 Session conversation 排除；
- active/candidate/disabled/superseded；
- Embedding 成功、失败与维度不匹配；
- 相关记忆召回和明显无关记忆不召回；
- 跨 Session 明确记忆。

评测输出命中率、误召回案例和降级结果，不调用真实模型，不修改生产记忆。

## 14. 隐私与安全

- Session v3、请求快照、真实 NDJSON log 都属于私人数据；
- Session、日志、SQLite 和测试临时数据不得进入 Git 或 npm 包；
- 默认 debug 只输出 code、provider、model、turn ID 和耗时；
- 不输出 API Key、Authorization、Tool 参数、Tool Result、记忆正文或请求快照；
- `/trace` 只展示安全元数据；
- Session schema 损坏时拒绝恢复，不静默丢弃 required journal 数据；
- version 1/2 缺少 journal 是合法兼容状态，不得视为损坏。

## 15. 明确不做

- 完整 DSH SessionEvent/Surface 模型；
- 通用事件总线或插件可扩展 Journal；
- Provider 原始 stream、reasoning 或思维链持久化；
- 文本流式输出；
- 并发 prompt、后台任务、子 Agent；
- Shell、网络、MCP 或新外部 Tool；
- SQLite Session Query 或全文搜索 Session Journal；
- 自动重放 Tool、自动恢复中断 Turn；
- Web UI、远程日志上传和遥测服务。

## 16. 重新评估条件

- Session JSON 因请求快照增长过快时，评估快照压缩或独立私有审计文件；
- 出现并发输入、后台任务或子 Agent 时，再评估完整 append-only event log；
- 需要流式恢复时，再记录 provider stream chunk；
- `/trace` 无法满足真实调试时，再评估只读 Session Query；
- 默认 0 次重试造成可测量的高失败率时，再评估默认一次安全重试；
- Tool 类型增长后结构化 action 无法表达时，再扩展明确 union，不引入开放事件字典。

## 17. 完成标准

v0.2.2 只有同时满足以下条件才完成：

1. version 1、2、3 会话兼容读取；
2. version 1/2 下一次成功保存升级为 version 3，messages 原样保留；
3. 每个用户请求形成唯一 Turn 和确定终态；
4. Provider 失败形成 attempt，不生成伪 assistant；
5. running Turn 重启后变成 interrupted；
6. 请求快照与实际 ModelRequest 一致并通过 hash 验证；
7. Tool、Approval、记忆召回和 checkpoint 可关联到 Turn；
8. 稳定错误 code 不依赖错误文本分类；
9. CLI loading 覆盖整轮请求；
10. NDJSON 失败不输出空 `response_end`；
11. `/trace` 可查看安全摘要且不泄漏正文；
12. 记忆召回离线评测覆盖中英文、状态、workspace 和降级；
13. 默认测试不联网、不读取真实用户数据；
14. 真实 DeepSeek NDJSON 至少连续两轮通过，回答不得为空；
15. `npm run typecheck`、`npm test`、`npm run build`、`npm run pack:check` 和 `git diff --check` 全部通过。
