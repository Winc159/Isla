# Isla v0.5.9 执行计划

> 执行用途：本文件是 v0.5.9 的设计、实施和验收基线。开始实施前必须确认 v0.5.8 的 Host Turn 流、精确取消和唯一终态已经通过完整门禁。

## 版本主题

v0.5.9 将无参数交互式 CLI 迁移为 Resident Host 的完整客户端。Session、Memory、Provider、Agent Runtime、Approval 和 User Question 都由 Host 持有；CLI 只负责输入、显示和用户响应。

本版本不增加后台任务或 Resource Bridge。交互协议只处理一个前台 Turn 的输入、观察、审批、问题和终态，避免把后台 Job 生命周期混入 Turn 协议。

## 设计目标

1. 无参数 `isla` 默认连接 Resident Host，并恢复当前 workspace、Provider 和模型对应的最近 Session。
2. 远程交互与现有本地模式保持相同的 Session 事实和安全语义。
3. Approval 与 User Question 可以通过 Host 暂停和恢复当前 Turn。
4. `/sessions` 支持查询、选择和历史回放，不要求 CLI 直接读取 Session 文件。
5. `/memory`、`/trace`、`/context` 通过 Host 提供只读等价能力。
6. CLI 断开只结束当前客户端连接；已经持久化的 Session 不删除、不回滚。
7. `isla --local` 保留为显式开发和故障恢复入口。

## 非目标

- Resource Job、后台 Turn、提醒、定时任务和通知。
- Session Turn 事件重放、断点续看和多客户端同时跟随。
- 公网访问、远程账号系统、多用户授权和跨设备同步。
- 运行期间切换 Provider、模型或系统提示词。
- Web 聊天界面、Agent Team、Subagent 或 Workflow。
- 将 CLI 状态机复制到 Host 内形成第二套 Runtime。

## 核心契约

### 所有权

- Host 持有 `ChatSession`、活动 Turn、Approval、User Question 和命令查询服务。
- CLI 持有 TTY 输入、选择器、显示状态和中断按键。
- Session Store 是对话事实源；CLI 不直接读写 `~/.isla/sessions/`。
- Memory Store 只由 Host/Application 打开；CLI 只消费有界、安全的查询结果。

### 交互身份

- 每个活动 Turn 沿用 v0.5.8 的 `sessionId + turnId`。
- 每个 Approval 有 Host 生成的 `approvalId`，并绑定当前 `sessionId + turnId`。
- 每个 User Question 有 Host 生成的 `questionId`，并绑定当前 `sessionId + turnId`。
- 旧、重复、未知或不匹配的响应必须被拒绝，且不能作用于后续 Turn。

### 断开语义

- 前台 Turn 中 CLI 连接断开时，沿用 v0.5.8 规则协作取消该 Turn。
- 已经持久化的用户消息和此前有效历史不回滚。
- 空闲交互 CLI 退出时只关闭客户端，不停止 Host。
- 本版本不支持断线后继续观看同一活动 Turn；重新连接从持久 Session 基线恢复。

### 安全展示

- Approval 只展示允许用户决策的工具名、权限、原因和安全摘要。
- Tool 原始秘密参数、API Key、密码、Token、Provider 原始错误和任意绝对私人路径不得进入协议。
- `/trace` 默认返回结构化、脱敏、有限条数的摘要，不返回完整模型正文或 Tool 私有 details。

## 批次 1：远程交互协议

### 步骤

1. 在 v0.5.8 Turn Event 上增加有版本边界的交互事件：`approval_requested`、`question_requested`。
2. 定义对应响应请求，并要求 `sessionId`、`turnId` 和 `approvalId` 或 `questionId` 全部匹配。
3. 明确事件最大尺寸、可显示字段、超时、取消和重复响应语义。
4. 保持终态仍只有 `turn_completed`、`turn_failed`、`turn_cancelled` 三选一。

### 验收

- Approval 和 Question 都能暂停当前 Turn，并在合法响应后继续。
- 拒绝、取消、超时、客户端断开和 Host shutdown 都能收敛到唯一终态。
- 陈旧响应不能批准或回答新的 Turn。
- 协议测试证明秘密字段不会进入事件。

## 批次 2：Host 交互桥接

### 步骤

1. 把现有 CLI Approval 实现拆分为 Host 可等待的交互桥接和本地 TTY 适配，不改变 Approval Policy。
2. 为 User Question 建立同样的 Host 挂起/响应桥接。
3. Host 为每个活动 Turn 保存未决交互身份；Turn 结束时统一清理。
4. 重复响应保持幂等或返回稳定的已处理错误，不重复执行 Tool。

### 验收

- 读操作、写操作批准、拒绝和取消与本地模式结果一致。
- 一个 Turn 同时只有协议允许数量的未决交互。
- Host 重启不伪造已批准状态；本版本不承诺跨重启恢复未决 Turn。
- Tool 只在有效批准后执行一次。

## 批次 3：Session 查询、选择和回放

### 步骤

1. Host 提供按当前 Provider、模型和 workspace 过滤的 Session 列表。
2. 增加有界历史读取接口，返回用户可见消息投影，不暴露持久化内部字段。
3. CLI `/sessions` 使用远程列表、选择 Session，并从 Host 获取历史回放。
4. Session 切换只影响后续输入目标，不迁移或合并历史。
5. 新建 Session 继续由 Host 生成身份和初始状态。

### 验收

- 默认恢复规则与 `isla <问题>` 一致。
- 不同 workspace、Provider 或模型的 Session 不会串入列表。
- 长历史分页或有界读取，不能用单次请求耗尽内存。
- 切换、取消选择、新建和回放均有自动化测试。

## 批次 4：远程管理命令

### 步骤

1. 为 `/memory` 提供 list、show、disable 所需的窄 Host API；写操作继续执行现有确认和修订语义。
2. 为 `/trace` 提供当前或指定 Session 的脱敏运行摘要。
3. 为 `/context` 提供下一次请求将使用的上下文边界与安全摘要，不触发模型调用。
4. 保持命令分发在用户入口层，不把 slash command 写入模型历史。

### 验收

- 三类命令在远程模式下不调用模型。
- 输出与本地模式的用户语义一致。
- Memory 私人正文只在用户明确查询具体记录时返回。
- 所有列表和详情都有尺寸上限及稳定错误码。

## 批次 5：默认远程交互 CLI

### 步骤

1. 将无参数 `isla` 默认装配为 Host 客户端。
2. 复用 v0.5.8 的事件 reader 和渲染器，不另建流式协议。
3. 接入远程 Approval、Question、Session 选择和管理命令。
4. Host 不可用时给出启动/诊断提示，不静默创建第二套本地 Runtime。
5. `--local` 明确进入现有进程内模式。

### 验收

- 默认模式不会同时打开本地 Session/Memory 数据库。
- Host 不可用、Token 错误、协议版本不兼容都有明确诊断。
- `--local` 在 Host 不运行时仍可作为显式恢复入口。
- TTY 输入编辑、中断、退出和命令行为通过 PTY 测试。

## 测试矩阵

| 范围 | 必测场景 |
|---|---|
| 协议 | Approval/Question 请求与响应、陈旧 ID、重复响应、尺寸限制、未知事件。 |
| Host | 允许、拒绝、取消、超时、断开、shutdown、多个 Session 隔离。 |
| Session | workspace 过滤、列表、分页/窗口、切换、新建、历史回放。 |
| 命令 | `/memory`、`/trace`、`/context` 不进入模型历史且输出脱敏。 |
| CLI | 默认远程、`--local`、Host 不可用、TTY 选择器、第一次/第二次 `Ctrl+C`。 |
| 回归 | v0.5.8 一次性 prompt、旧 JSON `/quick`、NDJSON、本地模式。 |

## 发布门禁

```bash
npm run verify
npm run test:pty
npm run pack:check
git diff --check
```

真实目标机额外验证：启动 Host 后完成两轮交互、一次只读 Tool、一次写 Tool 拒绝、一次写 Tool批准、一次 User Question、Session 切换、CLI 退出后重新连接和 `--local` 故障入口。

## 完成条件

- 无参数 `isla` 的所有模型请求由 Resident Host 执行。
- 远程 Approval 和 User Question 具备稳定身份且不能跨 Turn 误用。
- `/sessions`、`/memory`、`/trace`、`/context` 有远程等价实现。
- CLI 退出不会停止 Host，也不会删除或回滚 Session。
- Host 不可用时不会静默分叉本地事实源。
- `--local` 仍能独立工作。
- 没有引入后台 Job、Resource Bridge 或第二套交互状态机。

## v0.6.0 进入条件

只有远程交互在 Windows 和至少一个长期运行目标机上稳定通过后，才开始 Resource Job Bridge。进入时应确认 Host 已经能可靠处理 Turn 身份、用户交互和断开收敛，否则后台 Job 的引用和通知语义没有稳定承载面。
