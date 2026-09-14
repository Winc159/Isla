# Isla v0.2.6 架构基线：端到端协作式取消

## 1. 版本目标

v0.2.6 只实现当前活动 Turn 的端到端取消。它位于受控联网之前，因为 Provider 与未来网络 Tool 都必须先具备共同的取消和安静收尾边界。

本版从 Isla 现有 `CLI/NDJSON → ChatSession → Provider/ToolRuntime/Approval → StoredSession/Journal` 调用链演化，不复制 DSH 的 Agent Registry、Inbox、Cordis 生命周期、事件溯源 Session 或包结构。DSH 只用于确认已经验证过的取消不变量。

## 2. 硬约束

- `StoredSession.messages` 仍是唯一对话正文事实源；
- 用户输入在调用 Provider 前进入历史，取消后继续保留；
- 只有完整有效的模型回答才能作为 assistant 消息进入历史；
- 取消只影响调用时的当前活动，不预先取消未来 Turn；
- 每个 Turn 拥有独立 `AbortController`，第一取消原因生效；
- 同一个 `AbortSignal` 传播到 Provider、Approval 和 Tool；
- 取消不触发自动重试，不自动重放 Provider 或 Tool；
- 对外报告取消终态前，Runtime 必须等待已启动操作进入 quiescence；
- CLI 与 NDJSON 使用同一 Session 取消能力，不各自实现 Runtime 取消状态；
- 默认测试完全离线；
- 不同时实现联网、Shell、流式输出、后台任务、消息队列或子 Agent。

## 3. DSH 参考取舍

| DSH 设计 | Isla 决策 | 理由 |
|---|---|---|
| 活动操作独占 AbortSignal | 采用 | 与一个 Isla Turn 的生命周期直接对应 |
| 空闲 cancel 是 no-op | 采用 | 防止未来 Turn 继承旧取消状态 |
| 第一取消原因生效 | 采用 | 避免竞态覆盖审计事实 |
| cancel 后可等待 idle/quiescence | 采用 | 防止后台继续写文件、持久化或输出事件 |
| Tool 接收协作式 signal | 采用 | 为文件 Tool 和未来网络 Tool 建立共同边界 |
| Agent Inbox、nextTurn/nextStep | 拒绝 | Isla 当前不支持多 Turn 队列 |
| steer、inject、step-only cancel | 暂缓 | 当前没有对应产品需求 |
| Agent Registry、父子 Agent | 拒绝 | 超出个人 CLI Runtime 当前范围 |
| Event-sourced Session | 拒绝 | 不改变 StoredSession.messages 与现有 Journal 架构 |
| maintenance task 与 dispose drain | 暂缓 | 本版只处理 Turn 活动 |

## 4. 术语与状态

- `abort`：进程内通过 `AbortController` 发出的协作式中止动作；
- `cancelled`：Turn 对用户、协议和 Journal 的稳定终态；
- `aborted`：一次已经启动但因 Turn 取消而终止的 Model Attempt 状态；
- `quiescence`：当前 Turn 启动的 Provider、Approval、Tool、回调和必要持久化均已结算，不会再产生 Tool 写入或协议生命周期事件；
- `force exit`：CLI 第二次 Ctrl+C 的进程级兜底，不是 Runtime 终态，也不承诺任意外部操作已经回滚。

稳定取消原因保持最小封闭集合：

```ts
type TurnCancelReason =
  | { readonly kind: "user" }
  | { readonly kind: "disconnect" }
  | { readonly kind: "shutdown" };
```

取消原因属于 host/runtime 控制信息，不进入模型消息正文。

## 5. ChatSession 生命周期

`ChatSession` 仍是一个串行会话，不引入队列。建议的最小公开契约：

```ts
interface TurnControl {
  cancel(reason?: TurnCancelReason): boolean;
  whenIdle(): Promise<void>;
  readonly active: boolean;
}
```

可以直接由 ChatSession 暴露上述方法，也可以返回窄化控制接口；实施时选择改动最少且便于未来 HostedApplication 使用的形式。

每次 `send()`：

1. 拒绝与当前 Turn 并发的第二个 `send()`；
2. 创建新的 `AbortController` 并登记为当前活动；
3. 先持久化 user 消息和 running Turn；
4. 在 Memory、Provider、Approval、Tool 和步骤边界调用 `throwIfAborted()`；
5. 将同一 signal 传入所有可阻塞外部边界；
6. 成功时提交完整 assistant 并结束 Turn；
7. 取消时不提交 assistant，将 Turn/Attempt 写成取消终态；
8. 在所有已启动 promise 和终态持久化结算后清除活动控制器并解析 `whenIdle()`。

清除活动引用必须使用 identity guard：旧 Turn 的 finally 不得清除后来 Turn 的控制器。

## 6. Signal 传播契约

### 6.1 Provider

Provider 调用增加显式执行上下文：

```ts
interface ModelCallOptions {
  readonly signal: AbortSignal;
}
```

`generate()` 与 `generateWithTools()` 均接收它。OpenAI、DeepSeek 和 Local 适配器必须把 signal 传给底层 HTTP SDK；Provider 将取消规范化为 `TURN_CANCELLED`，不能误报为 timeout/network，也不能重试。

### 6.2 Approval

`ApprovalService.request(request, { signal })` 必须：

- signal 已取消时立即结算为取消；
- 等待期间取消时移除输入/协议监听并拒绝或返回专用取消结果；
- 取消不能被记为用户拒绝；
- 已记住的批准也要先检查 signal，不能在取消后继续执行 Tool。

### 6.3 Tool

`ToolRuntime.execute(call, { signal })` 与 `Tool.execute(arguments, { signal })` 共用 Turn signal。Tool 在解析前、Approval 后、实际副作用前检查 signal。长操作还必须在内部边界主动检查。

协作式取消不能回滚已经完成的文件写入。本版要求防止取消后开始新的副 multiline 写入或后续 Tool，而不是承诺事务回滚。

### 6.4 Memory 与派生回调

Memory 召回可以接收 signal，取消后不再启动新的派生工作。取消终态所需的 Session/Journal 持久化不能使用已经取消的 signal，否则会丢失审计事实。取消后不执行 `onTurnCommitted`；已完成的必要终态保存必须等待。

## 7. 消息、Journal 与恢复

不升级 StoredSession 正文模型。Session v3 Journal 做向后兼容扩展：

```ts
type TurnStatus = "running" | "completed" | "failed" | "blocked" | "interrupted" | "cancelled";
type ModelAttemptStatus = "running" | "succeeded" | "failed" | "aborted";
```

取消后的不变量：

- user 消息索引有效且正文保留；
- 没有 assistantMessageIndex；
- 没有不完整 assistant；
- 活动 Attempt 记为 aborted，并有 endedAt；
- Turn 记为 cancelled，并有 endedAt 与安全原因；
- 已完成 Tool action 可以保留；尚未完成 Tool 不伪造成功结果；
- 重启只恢复历史事实，不重放 cancelled Turn；
- 旧 v1/v2/v3 Session 继续读取；旧 reader 遇到新状态的兼容策略必须由迁移测试锁定。

进程崩溃留下的 running Turn 仍恢复为 interrupted，不能推断成 cancelled。

## 8. CLI 语义

CLI 必须区分输入空闲和生成活动：

- 输入空闲时 Ctrl+C 沿用明确退出语义；
- 生成期间第一次 Ctrl+C 调用当前 Session 的 cancel，并显示一次“正在取消”；
- 取消完成后显示“已取消”，回到输入；
- 取消尚未收敛时第二次 Ctrl+C 允许强制退出进程；
- 新 Turn 开始后，Ctrl+C 计数重新从零开始；
- loading timer 在成功、失败或取消时都必须停止；
- Ctrl+C 不得与复制快捷键说明冲突，帮助文本同步更新。

第一版不增加“是否退出”菜单；若现有终端行为无法跨平台稳定表达，空闲 Ctrl+C 直接退出，Esc 保持原行为。

## 9. NDJSON 协议

新增请求：

```json
{"type":"cancel","id":"c1","targetId":"p1"}
```

新增事件：

```json
{"type":"cancel_ack","id":"c1","targetId":"p1","accepted":true}
{"type":"response_cancelled","id":"p1","elapsedMs":123}
```

协议规则：

- `targetId` 必须指向当前活动 prompt；
- 空闲、未知或已结束 target 返回稳定 `NOT_ACTIVE`，不得影响未来请求；
- `cancel_ack.accepted=true` 只表示 signal 已发出，不表示已经 quiescent；
- `response_cancelled` 是该 prompt 的唯一终态，与 `response_end`、`error` 互斥；
- `response_cancelled` 只在 quiescence 和取消终态持久化完成后输出；
- 取消 Approval 时清除 pending approval，迟到的 approval_response 返回 `UNEXPECTED_APPROVAL`；
- EOF/disconnect 使用 `disconnect` 原因取消并等待安静收尾；
- exit 等待活动 Turn 按原有协议边界结算，再输出 bye；若需要取消活动 Turn，调用方先发送显式 `cancel`，避免 exit 与正常完成产生隐式竞态；
- `ready.capabilities.cancellation` 在完整实现和测试通过前保持 false，收口时改为 true。

旧客户端不发送 cancel，原有 prompt/approval/new_session/exit 行为保持兼容。

## 10. 竞态与终态仲裁

终态以单一 Turn settlement gate 仲裁：

- assistant 已完成持久化后到达的 cancel 返回 false 或 NOT_ACTIVE；
- signal 先被观察到时，即使 Provider 随后返回文本，也不得提交 assistant；
- Tool 完成与 cancel 同时发生时，允许保留已经完成的实际 Tool 事实，但不得继续下一模型步骤；
- Approval decision 与 cancel 同时发生时，在副作用开始前再次检查 signal；
- 重复 cancel 幂等，不能重复写 Journal 或重复发 response_cancelled；
- 所有 terminal event 每个 prompt 最多一个。

## 11. 错误与诊断

`TURN_CANCELLED` 是稳定、不可重试的控制终态，不作为 warning/error 污染正常诊断。debug 可以输出不含正文的安全事件：取消来源、阶段和耗时。

Provider 不支持 signal 或 Tool 忽略 signal 属于能力实现缺陷；Runtime 仍等待 promise 结算。超过 CLI 双 Ctrl+C 阈值只允许进程退出，不把未收敛错误伪装成安全取消。

## 12. 暂缓与拒绝

暂缓：暂停/继续、step-only cancel、后台任务、自动超时策略、多 Turn 队列、取消后重试、网络 Tool、流式 frame、进程级 Tool。

拒绝：全局持久 abort flag；空闲取消影响下一 Turn；取消后自动重放；把 cancelled 写成用户拒绝或 Provider 网络失败；为取消引入 DSH Inbox、Cordis 或 Agent Registry；声称可以回滚已经完成的外部副作用。

## 13. 完成标准

1. 每个 Turn 使用全新 controller，空闲取消不影响未来 Turn；
2. 同一 signal 到达 Provider、Approval、Tool；
3. 三种 Provider 都把 signal 传到底层调用；
4. CLI 第一 Ctrl+C 取消、第二次仅在未收敛时强退；
5. NDJSON 支持 cancel、ack 和唯一 cancelled 终态；
6. user 保留、不完整 assistant 不保存；
7. Journal 准确区分 cancelled、aborted、failed、interrupted；
8. 取消不触发模型重试或 Tool 重放；
9. 对外取消终态发生在 quiescence 之后；
10. Session v1/v2/v3、CLI、Tool、Approval、Memory、来源链无回归；
11. 默认离线门禁、build、pack 和 diff-check 全部通过；
12. 未实现本版明确暂缓的能力。
