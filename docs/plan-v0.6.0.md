# Isla v0.6.0 执行计划

> 执行用途：本文件是 v0.6.0 Resource Job Bridge 的设计、实施和验收基线。开始实施前必须确认 v0.5.9 完成；任何扩大 Resource Tool 权限、改变 Job 状态机或自动向旧 Session 注入消息的方案都需要重新讨论。

## 版本主题

v0.6.0 让主 Agent 可以创建和管理现有 Resource Job，使任务在 CLI 退出后继续运行。Bridge 只暴露经过收窄的 Job 与 Artifact 操作；Resource Service、Scheduler 和 SQLite 继续拥有执行与持久化事实。

这是长期个人 Agent 的第一个后台闭环，但本版本不实现主动通知、通用后台 Turn、提醒或 Workflow。

## 设计目标

1. 主 Agent 可以创建现有、已验证的 Resource Job。
2. 主 Agent 可以查询、列出、取消 Job，并响应 `waiting_user` 决定。
3. 主 Agent 可以读取安全的 Artifact 元数据和用户可访问结果。
4. CLI 或 Session 关闭不取消 Resource Job。
5. 同一模型 Tool Call 或重试使用稳定幂等键，不重复创建有副作用的 Job。
6. Session 只记录稳定 Job 引用和用户可见结论，不复制 Resource 事件日志。
7. Job 完成不会自动向任意旧 Session 注入 assistant/user 消息。

## 非目标

- 新增 Resource Job 类型、下载器、归档能力或 Web UI 功能。
- Agent 直接访问 Resource SQLite、Scheduler、staging 或任意绝对路径。
- 通用 Job 框架、Workflow、DAG、Subagent 或 Agent Team。
- Job 完成通知、系统通知、后台自动唤醒 Session。
- 跨主机 Resource、远程文件操作和多用户权限。
- 让 Resource Worker 获得 Session、Memory 或 Tool。
- 把 Resource Service 合并进 Resident Host 或 Agent Loop。

## 允许的首版能力

主 Agent 只获得以下 Tool：

- `resource_job_create`
- `resource_job_get`
- `resource_job_list`
- `resource_job_cancel`
- `resource_job_respond`
- `resource_artifact_get`

首版 `resource_job_create` 只允许 Resource 当前已经支持并具有自动化测试的输入：

- `baidu-download`：分享文本或已登录账号中的百度路径；
- `archive-organizer`：`managedRootId + relativePath` 指向的受管文件或文件夹。

不得接受绝对路径、数据库路径、staging 路径、命令行、脚本、任意 URL 下载器或 Worker prompt。

Profile 的 `capabilities.resourceEnabled: false` 可关闭整组能力；默认仅在 Resource 健康且 Host 已连接时注册。创建、取消和决定响应仍经过现有 Approval Policy。

分享码、压缩包密码、登录验证码等秘密输入不通过 Agent Tool 参数提交：主 Agent 的 Tool Call 会进入可重建的 Session 历史，因此这类决定继续由 Resource UI 的秘密输入路径处理。`resource_job_respond` 只允许非秘密 `approve`、`reject`、`replace_input` 和 `choose_destination`；包含密码/分享码的输入稳定拒绝。

## 所有权与数据流

```text
Model Tool Call
  -> Tool Runtime / Approval / Capability Policy
  -> Resource Bridge Client
  -> Resource Service loopback API
  -> Resource SQLite + Scheduler
  -> Job ID / safe snapshot / artifact reference
  -> Session Tool Result
```

- Resource SQLite 是 Job、Event、Artifact、Decision 和幂等结果的唯一事实源。
- Resident Host 只持有 Resource 的连接信息和进程间凭据，不缓存权威 Job 状态。
- Session 中的 Tool Call/Result 用于重建模型实际看到的内容，但不能替代 Resource Job 状态。
- Resource Web 与 Agent Bridge 复用同一业务方法和状态机；不得复制 Job 创建或确认逻辑。

## Tool 契约

### `resource_job_create`

输入：受支持的 Job 类型、受限输入、目标 `managedRootId`、启动模式和由 Runtime 派生的幂等键。

输出：Job ID、revision、status、stage、是否等待用户，以及安全摘要。

约束：

- Tool schema 不接受调用方自报的绝对路径或 Resource Token。
- 默认创建属于有副作用操作，必须经过现有 Approval Policy。
- 幂等键由稳定的 Session/Turn/Tool Call 身份派生；模型不能选择或覆盖其他调用的键。
- 相同幂等键和相同规范化请求返回同一 Job；相同键配不同请求应稳定拒绝。

### `resource_job_get`

输入：Job ID。

输出：有界 Job snapshot，包括 revision、status、stage、进度、安全失败摘要、pending decision 摘要和 Artifact 引用。

不得返回密码、分享码、授权码、API Key、Resource Token、staging 绝对路径或内部 Worker 原文。

### `resource_job_list`

输入：可选状态过滤和有界 limit/cursor。

输出：按稳定顺序排列的 Job 摘要。

第一版不提供任意查询 DSL、全文检索或无限列表。

### `resource_job_cancel`

输入：Job ID 和调用前读取到的 revision。

输出：是否接受取消及新的安全状态。

重复取消应幂等；已终态 Job 不被改写；陈旧 revision 返回稳定冲突，不猜测用户意图。

### `resource_job_respond`

输入：Job ID、revision、decisionId、允许的 action 和该决定类型允许的 values。

输出：是否接受、更新后的 revision/status/stage。

Bridge 必须复用 Resource 已有 `revision + decisionId` 校验。秘密值只能进入 Resource 的秘密处理路径，不得出现在普通 Tool Result、Journal、Trace 或日志。

### `resource_artifact_get`

输入：Job ID 和 Artifact ID 或稳定引用。

输出：安全元数据、所属受管根、相对路径、类型、大小和可用状态。

第一版不直接把任意文件正文、二进制或绝对路径放入模型上下文。需要访问文本内容时，后续仍由现有 workspace/文件 Tool 在其沙箱边界内处理。

## 批次 1：Bridge 公共契约与只读客户端

### 步骤

1. 为 Host 到 Resource 的内部客户端定义有版本的请求/响应类型。
2. 增加有版本 health、get、list 和 artifact metadata 的有界读取。
3. 统一 Resource HTTP 错误到稳定 Bridge 错误码，不透传原始响应正文。
4. 使用 `runtime.json` 中的 loopback 地址和进程间凭据；不新增 `.env` 默认配置。

### 验收

- Resource 未运行、Token 错误、超时、协议不兼容和损坏响应有明确诊断。
- 只读调用不能越过 managed root 或读取 Resource 私密字段。
- Host 关闭会取消未完成的 Bridge HTTP 请求。
- 测试使用假 Resource 或本地隔离服务，不访问真实百度账号和私人数据库。

## 批次 2：Resource Capability 与只读 Tool

### 步骤

1. 在 Capability Catalog 注册稳定的 `resource` 能力。
2. 第一阶段只接入 `resource_job_get`、`resource_job_list`、`resource_artifact_get`。
3. 明确 Profile policy、availability、激活关键词、风险和 Resource 健康依赖。
4. Tool 输出进入现有有界结果、Journal 和完成门禁路径。

### 验收

- Resource 未配置或不可用时 Capability 显示明确 unavailable 原因。
- 激活不绕过 Tool Runtime、Policy、Sandbox 或 Approval。
- Tool schema 只在当前 Model Step snapshot 中按规则暴露。
- 大列表和 Artifact 数量受到预算限制。

## 批次 3：幂等创建

### 步骤

1. 在 Resource Service 的现有幂等表上实现事务化创建语义；Agent 幂等记录随 Resource 数据库保留，不按时间自动过期，避免迟到重试重复创建。
2. Bridge 对 `sessionId + turnId + toolCallId` 做 SHA-256 派生幂等键，不把原始身份写入请求头。
3. 规范化并绑定请求摘要，防止同键不同请求复用。
4. 接入 `resource_job_create`，只允许首版白名单 Job 类型。
5. 创建返回后立即记录 Job 引用；客户端响应丢失时，重试仍得到同一 Job。

### 验收

- Provider/Host 重试、HTTP 响应丢失和重复 Tool 调用不会创建重复 Job。
- 相同幂等键配不同输入稳定失败。
- 创建前失败不留下半成 Job；创建成功后响应失败可通过幂等查询恢复。
- 绝对路径、未知 root、未知 Job 类型和超限输入均被拒绝。

## 批次 4：取消与人工决定

### 步骤

1. 接入 `resource_job_cancel`，要求 Job ID 和 revision。
2. 接入 `resource_job_respond`，要求 revision 和 decisionId。
3. 按 pending decision 类型收窄允许的 action 和 values。
4. 对密码、分享码和授权信息建立不回显路径。
5. Tool Result 只返回状态变化和安全摘要。

### 验收

- 陈旧 revision、错误 decisionId、重复响应和终态取消都有确定行为。
- 一个决定最多产生一次业务副作用。
- 密码等秘密不出现在 Session 普通消息、Journal、Trace、错误或测试快照。
- Agent 不能自行构造越权 action 或为另一个 Job 回答决定。

## 批次 5：Session 引用与用户闭环

### 步骤

1. 明确 Job 创建 Tool Result 中的稳定引用格式。
2. 后续查询必须重新读取 Resource 事实，不依赖旧 Tool Result 判断当前状态。
3. 用户询问“刚才的任务”时，允许从当前 Session 的 Job 引用定位，再调用 get。
4. 用户再次打开 CLI 时，Job 继续运行；只有用户查询或显式调用 Tool 时结果才进入当前 Turn。
5. 不增加自动向历史 Session 注入消息的代码。

### 验收

- CLI 退出、Host 重启和 Session 切换不取消 Job。
- Resource 重启后同一 Job ID 仍可查询。
- Session 中的旧 snapshot 不会覆盖 Resource 当前状态。
- Job 完成不会凭空产生 assistant 消息或修改旧 Session。

## 批次 6：文档与运行诊断

### 步骤

1. 更新 README、architecture、development、decisions、roadmap 和 references。
2. `doctor` 增加 Resource Bridge 的地址、认证和协议兼容诊断，但不打印 Token。
3. 明确 Resource 未运行时主 Agent 仍可使用其他能力。
4. 明确本版本没有通知；用户需要主动查询 Job。

### 验收

- 文档不声称具备通知、后台 Turn 或任意 Resource 操作。
- 诊断输出不包含凭据、密码或绝对私人路径。
- Resource 故障只降级 Resource Capability，不阻止普通聊天启动。

## 测试矩阵

| 范围 | 必测场景 |
|---|---|
| 契约 | 六个 Tool schema、未知字段、长度限制、稳定错误码、秘密过滤。 |
| 读取 | get/list/artifact、分页或 limit、未知 Job、Resource 不可用。 |
| 创建 | 两种白名单 Job、审批、幂等重试、响应丢失、同键异参、未知 root。 |
| 取消 | queued、running、waiting_user、终态、重复取消、陈旧 revision。 |
| 决定 | approve、reject、replace/provide values、错误 decisionId、重复响应。 |
| 生命周期 | CLI 退出、Host 重启、Resource 重启、Session 切换、Job 最终完成。 |
| 安全 | 绝对路径、Token、密码、分享码、内部错误和 staging 路径不泄漏。 |
| 回归 | Resource Web 现有流程、主 Agent 非 Resource Tool、v0.5.9 远程交互。 |

至少增加一个隔离的端到端测试：通过 Agent Tool Runtime 创建假 Resource Job，关闭客户端，推进 Resource Scheduler 完成，再在新 Turn 中查询同一 Job 和 Artifact。该测试不得访问网络或真实私人配置。

## 发布门禁

```bash
npm run verify
npm run test:pty
npm run pack:check
git diff --check
```

真实目标机额外验证：Host 与 Resource 都由正式服务管理器启动；创建一个受控测试 Job；退出 CLI；确认 Job 继续；重连后查询；处理一次 `waiting_user`；取消一次活动 Job；检查日志无秘密。

## 完成条件

- 六个 Resource Tool 通过统一 Capability 和 Tool Runtime 暴露。
- 创建只允许现有白名单 Job，并具备可证明的幂等行为。
- Job、Artifact 和 Decision 的权威状态始终来自 Resource SQLite。
- `revision + decisionId` 防止陈旧或重复人工响应。
- CLI、Session 或 Host 关闭不会自动取消 Resource Job。
- Job 完成不会自动向旧 Session 注入消息。
- Resource 不可用只使该 Capability 降级，不影响普通 Agent Runtime。
- 没有新增通用 Job 系统、通知系统、Workflow 或 Resource 处理能力。

## 后续重新评估入口

v0.6.0 经过真实长期运行后，下一版才评估本地 Job 完成通知。评估依据应包括：用户实际查询频率、等待人工处理的数量、漏看完成结果的情况和 Host/Resource 重启恢复数据。通知只能引用 Resource Job 事实，不能复制或取代 Job 生命周期。
