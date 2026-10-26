# Isla v0.7.1：Event Session 与 App Server

## 设计目标

以 append-only Session Event V1 作为主 Agent 的持久事实，并建立 CLI、Web UI、未来 ACP 客户端共享的 App Server 协议。支持断线续传、崩溃恢复、多客户端跟随和唯一终态。

Resource Service 保持独立事实源；Resource Job 只以引用和投影出现在 App Server。

## 核心契约

### Session Event V1

所有事件包含 `eventId`、`sessionId`、`sequence`、`timestamp`、`schemaVersion`。核心类型：

- `session/created|updated|archived`
- `turn/started|steered|cancel-requested|completed|failed|cancelled`
- `step/started|completed|failed`
- `message/user|assistant|attempt`
- `tool/call|started|result|outcome-unknown`
- `approval/requested|resolved|expired`
- `question/requested|resolved|expired`
- `plan/updated|mode-changed`
- `checkpoint/created|restored`
- `job/referenced|subscription-changed`

事件不可原地修改；聊天、Journal、Task State、Context、Evidence 和 UI Timeline 都由投影生成。

### App Server V1

- JSON-RPC 或等价的版本化双向协议；stdio 与 loopback WebSocket/HTTP 共用 schema。
- `initialize` 协商协议版本、客户端能力和服务器能力。
- Thread：create/list/read/archive/resume。
- Turn：start/steer/follow-up/cancel/read/follow。
- Item：message/tool/approval/question/plan/checkpoint/artifact/job。
- `follow` 使用单调 cursor；重连传 `afterCursor`，服务端补发持久事件，再切到实时流。
- 写操作带 request ID 和幂等键。

## 实施步骤

1. 定义事件 schema、codec、校验和错误码。
2. 实现文件型 Event Store V1：append、batch、flush、read、cursor、尾部损坏截断。
3. 建立投影注册表和基础投影。
4. 双写阶段：旧 JSON Session 与 Event Store 同时写，启动时进行一致性断言。
5. 实现旧 Session 到 Event V1 的单向迁移和备份。
6. ChatSession 改为通过 Event Writer 提交事实；旧字段由投影提供。
7. 实现 App Server initialize/thread/turn/follow/approval/question。
8. Remote CLI 改为 App Server 客户端，保留旧协议兼容开关。
9. 稳定后停止旧 JSON 双写，但保留只读迁移器两个版本。

## 自动测试

- 每种事件 schema 的 codec 与拒绝测试。
- sequence 单调、批次原子、并发写排他、flush barrier。
- 尾部半写、重复事件、未知版本、投影崩溃恢复。
- Tool Call/Result 配对和 `outcome-unknown` 修复。
- Turn 每种异常路径只有一个终态。
- cursor 重连无丢失、无重复；慢客户端有界背压。
- 双写一致性和旧 Session 迁移 golden fixtures。
- Host 重启、客户端断线、Provider 失败、Approval 等待中 shutdown。

## 真实验收

1. CLI 发起长 Turn，中途断开，再连接后从 cursor 继续。
2. 两个只读客户端同时跟随同一 Session；只有所有者客户端响应 Approval。
3. Tool 执行过程中强杀 Host，重启后记录 unknown outcome 并要求核对，不重复副作用。
4. 迁移现有真实脱敏 Session，模型输入投影与迁移前一致。

## 完成条件

- App Server 成为 CLI 唯一默认协议入口。
- Event Store 是主 Agent Session 事实源。
- 旧 Session 可迁移、可回滚读取，不丢消息或终态。
- Resource mock-e2e 零行为变化。
