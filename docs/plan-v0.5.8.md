# Isla v0.5.8 执行计划

> 执行用途：本文件是 v0.5.8 的设计、实施和验收基线。实施者应按批次顺序工作，每个批次完成测试后再进入下一批；如果需要改变公共事件、Session 持久化或取消语义，先更新本文并与用户确认。

## 版本主题

v0.5.8 聚焦 Resident Host 的实时 Turn 传输与远程取消。`isla <问题>` 继续由常驻 Host 执行，但 CLI 不再只能等待最终 JSON；它可以实时显示模型文本和工具阶段，并在用户按 `Ctrl+C` 时精确取消当前远程 Turn。

Resource 在本版本冻结：不新增 Resource API、Job Bridge、Web UI 或处理能力，只修复会阻塞现有使用的缺陷。

## 为什么优先做这一版

- Resident Host 已经持有 Session、Memory、Provider 和 Agent Runtime，但当前 `/quick` 直到 Turn 完成才返回一个 JSON。
- Runtime 和 NDJSON 协议已经能产生 `model_delta`、`tool_start`、`tool_end` 和唯一终态，Host 尚未复用这些现成观察点。
- 远程 CLI 显示旋转等待符，长回答、Tool 调用和重试过程不可见。
- Host 的取消入口按 Session 查找活动对象，没有 Turn 身份；旧请求结束与新请求开始相邻时，客户端无法证明取消的是哪一个 Turn。
- 无参数交互模式仍使用本地 Runtime，常驻 Host 尚未成为 CLI 的完整事实执行端。

## 用户闭环

```text
isla 帮我检查这个项目
  -> CLI 向 Host 发起 streaming quick turn
  -> Host 立即返回 turn_start(sessionId, turnId)
  -> CLI 实时显示 model_delta 和安全工具阶段
  -> Host 输出且只输出一个 turn_completed / turn_failed / turn_cancelled

用户在运行中按 Ctrl+C
  -> CLI 使用 sessionId + turnId 请求取消
  -> Host 只取消完全匹配的活动 Turn
  -> 流以 turn_cancelled 收敛
```

## 公共传输契约

### 请求

- 保留 `POST /quick` 的 workspace、是否新建 Session 和 prompt 语义。
- 客户端通过明确的 `Accept` 请求 NDJSON 流；旧 JSON 响应在迁移期继续可用。
- 每次请求由 Host 生成不可复用的 `turnId`，不信任客户端自报活动身份。

### 事件

- `turn_start`：`sessionId`、`turnId`。
- `model_step_start`：step、attempt。
- `model_delta`：step、attempt、provisional、text。
- `model_step_end`：step、attempt、result。
- `tool_start`：tool、callId；不传原始参数。
- `tool_end`：tool、callId、ok、可选安全错误码。
- 终态三选一：`turn_completed`、`turn_failed`、`turn_cancelled`。

事件逐行编码为 JSON。单行和文本块必须有界；内部异常、Tool 参数、Token、绝对私人路径和 Provider 原始响应不得写入流。

### 取消

- 取消请求同时携带 `sessionId` 和 `turnId`。
- 只有二者都匹配当前活动 Turn 才返回 `accepted: true`。
- 已完成、未知或过期 Turn 返回 `accepted: false`，不得取消同 Session 的后续 Turn。
- 第一次 `Ctrl+C` 请求协作取消并等待终态；再次中断才允许客户端退出等待，但 Host 中的取消仍继续收敛。

## 架构边界

```text
ChatSession callbacks
  -> ResidentHost turn-local writer
  -> bounded NDJSON HTTP response
  -> ResidentHostClient async event reader
  -> remote CLI renderer
```

- Session 消息仍是持久事实；实时 Turn 事件只是观察，不写成第二份 Session 历史。
- Host 只复用 ChatSession 已有的模型步骤和 Tool 生命周期回调，不引入 Event Bus。
- Client 断开连接触发该请求的协作取消，但断开本身不伪造成功终态。
- 流式文本是 provisional；只有 `turn_completed` 中的最终回答代表有效 assistant 消息已经落入 Session。
- Provider 不支持原生 streaming 时仍输出 step/tool/终态事件，最终文本由完成事件一次性交付。

## 批次 1：Host Turn 事件契约

- 定义独立、可解析、带版本边界的 Host Turn Event 类型。
- 增加逐行编码、最大行长、未知事件和不完整尾行处理。
- 把安全错误分类与 NDJSON Protocol 现有语义对齐，但不让 HTTP Host 依赖 stdin/stdout Runner。
- 为每个活动 Turn 保存 `sessionId + turnId + ChatSession`。

验收：事件顺序确定；每个已开始 Turn 最多一个终态；失败与取消不输出完成；流中没有原始 Tool 参数或敏感错误正文。

## 批次 2：Streaming `/quick`

- 为 `/quick` 增加显式 NDJSON 响应模式，保留旧 JSON 模式兼容现有调用方。
- 在创建 ChatSession 时注入模型步骤、Tool 开始和 Tool 结束观察回调。
- HTTP backpressure 通过等待 `drain` 收敛，不无限缓存慢客户端输出。
- 请求 aborted、response closed 和 Host shutdown 都进入同一取消路径。
- 非流式 Provider 也必须产生 start、step end 和唯一终态。

验收：慢客户端有界；中途断开不会留下永不释放的 active Turn；Host shutdown 等待 Turn 收敛；多个 Session 的流互不串线。

## 批次 3：精确远程取消

- 将取消 API 从“只按 Session”收窄为“Session + Turn”。
- 取消只对当前匹配 Turn 生效，空闲取消不影响未来请求。
- 保留第一取消原因；断开、用户取消和 Host shutdown 不互相覆盖。
- 客户端收到 `turn_start` 后才允许发送取消。

验收：旧 turnId 不能取消新 Turn；重复取消幂等；取消 Tool 或 Provider 后仍只有一个 `turn_cancelled`；Session 不追加伪 assistant 回答。

## 批次 4：远程 CLI 实时渲染

- `ResidentHostClient` 提供 async event reader，不向上层暴露原始字节流。
- `isla <问题>` 实时追加 provisional 文本，并以终态最终文本校正交付。
- Tool 只显示名称、开始/结束和安全状态，不显示秘密参数。
- 非 TTY 输出保持稳定、可管道消费；TTY 才使用原地状态更新。
- `Ctrl+C` 通过精确取消 API 工作，不直接杀死 Resident Host。

验收：中文分块、跨 UTF-8 边界、空 delta、Tool 中间轮和最终回答均正确显示；取消后 CLI 返回稳定退出状态；无颜色环境不输出控制字符。

## 批次 5：文档与发布门禁

- 更新 README、architecture、decisions、roadmap、testing 和 development。
- 明确实时事件是临时观察，Session 才是可恢复事实。
- 明确 v0.5.8 只覆盖一次性远程 prompt，不宣称完整交互 CLI 已迁移。
- 更新版本号并检查 npm 包只包含正式运行产物。

## 明确暂缓

- 无参数 `isla` 默认切换到完整远程交互模式。
- 远程 Approval 和 User Question 往返。
- `/sessions` 搜索、选择、历史回放以及 `/memory`、`/trace` 等命令的远程等价实现。
- Session 断线续看、事件重放、cursor 和 retained output。
- 后台 Turn、提醒、Subagent、Agent Team 和 Workflow。
- Resource Bridge 及任何新的 Resource 能力。

这些能力应在 v0.5.8 的 Turn 流稳定后逐项增加，不能通过一次性复制本地 CLI 状态机完成。

## 明确拒绝

- 把 provisional delta 写成 Session assistant 消息。
- 为实时显示建立第二套持久事件日志。
- 引入 WebSocket、通用 Event Bus、Cordis 或远程消息队列。
- 仅按 Session ID 取消而不校验 Turn 身份。
- 在实时流中传输 Tool 原始参数、Approval 秘密或 Provider 原始错误。
- 因为客户端断开而删除 Session 或回滚已经持久化的用户消息。

## DSH 参考取舍

参考：

- [DSH Architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)
- [DSH Core](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/core.md)
- [DSH session history and event transport](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/architecture/2026-08-18-session-history-and-event-transport.md)

采用：持久 Session 事实与实时 Agent 观察分离；Turn 事件携带明确身份；可从 Session 基线修复的 UI 状态不进入持久日志；取消和终态只有一个权威结果。

暂缓：远程事件重放、跨客户端跟随、通用 Agent Registry 和后台 Job 观察。Isla 当前只需要当前请求的单连接实时流。

拒绝：Cordis、DSH Event Map、插件化 transport 和完整 Web 客户端架构。Isla 继续使用现有 ChatSession 回调与 loopback HTTP Host。

## 发布门禁

```bash
npm run verify
npm run pack:check
git diff --check
```

额外覆盖：HTTP 流分块、backpressure、客户端断开、精确取消、Host shutdown、多 Session 隔离、非流式 Provider 和 CLI TTY/非 TTY 输出。

## 完成条件

- `isla <问题>` 可以从 Resident Host 实时显示回答与安全工具阶段。
- 用户可以精确取消当前远程 Turn，不影响同 Session 的后续请求。
- 每个 Turn 只有一个终态，Session 仍能重建实际模型输入。
- 旧 JSON quick prompt 在迁移期保持兼容。
- 本版本没有新增 Resource 能力，也没有引入新的通用框架。

## 实施顺序与提交边界

本版本按以下顺序实施，不跨批同时重构：

1. 先增加纯类型、编码和解析能力，不连接 HTTP。
2. 再把现有 `ChatSession` 观察回调接入 Host Turn writer。
3. 再实现精确取消和连接关闭收敛。
4. 最后修改 CLI 渲染和文档。

每个批次只修改实现该批次所需文件。不得顺手迁移无参数交互 CLI、增加远程 Approval、修改 Resource，或重构 Agent Loop。

建议文件落点：

- Host Turn 公共类型和 NDJSON 编解码：`src/host/`；
- Host HTTP 生命周期：`src/host/server.ts`；
- 客户端事件读取：`src/client/host-client.ts`；
- 一次性远程 CLI 展示与取消：`src/client/remote-cli.ts`、`src/entrypoints/cli.ts`；
- 对应测试：`tests/host.test.ts`、`tests/remote-cli.test.ts`，必要时新增职责单一的 Host transport 测试文件。

## 验收矩阵

| 场景 | 必须观察到的结果 |
|---|---|
| 流式普通回答 | `turn_start` 后收到零个或多个 `model_delta`，最终只有一个 `turn_completed`。 |
| 非流式 Provider | 仍有 step 和唯一终态；最终文本通过完成事件交付。 |
| Tool 中间步骤 | 只显示工具名、callId 和安全状态，不暴露原始参数或结果正文。 |
| Provider 失败 | 只有一个 `turn_failed`，不追加成功 assistant 消息。 |
| 用户第一次 `Ctrl+C` | 使用已收到的 `sessionId + turnId` 请求取消，并等待 `turn_cancelled`。 |
| 旧 turnId 取消 | 返回 `accepted: false`，不能影响同 Session 的新 Turn。 |
| 客户端中途断开 | Host 协作取消对应 Turn，最终释放 active 记录。 |
| Host shutdown | 所有活动 Turn 收敛后关闭，不留下活动 Session 或悬空 writer。 |
| 慢客户端 | 写入遵守 backpressure，内存不会随输出无限增长。 |
| 非 TTY 管道 | 不输出 spinner、颜色或光标控制字符，文本可稳定重定向。 |
| 旧客户端 | 未请求 NDJSON 时仍获得兼容的 `/quick` JSON 响应。 |

## 自动化测试目标

- 单元测试：事件解析、未知事件、不完整尾行、最大行长、UTF-8 分块和唯一终态判定。
- Host 测试：流式/非流式 Provider、Tool 生命周期、并发 Session、断开、shutdown、backpressure 和精确取消。
- CLI 测试：TTY、非 TTY、第一次/第二次中断、完成文本校正、失败退出码和无控制字符输出。
- Session 回归：用户输入仍在模型调用前持久化；失败与取消不产生伪 assistant 消息；旧 JSON quick 行为兼容。

最终执行：

```bash
npm run verify
npm run pack:check
git diff --check
```

## 版本退出条件

只有以下条件全部满足，才可以开始 v0.5.9：

- 一次性远程 prompt 已稳定使用 Turn 流，而不是轮询或等待完整 JSON。
- `sessionId + turnId` 是取消当前 Turn 的唯一身份。
- 每个已开始 Turn 在正常、失败、取消和断开路径上最多产生一个终态。
- 事件流不成为第二份持久历史，Session 仍是模型输入的事实源。
- 旧 `/quick` JSON 调用方通过兼容测试。
- 默认验证无网络、无真实凭据、无私人日志。
