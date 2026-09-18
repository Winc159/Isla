# Isla v0.3.6 Workspace-scoped Session Discovery and Recall

状态：设计已确认并实现；真实评估已通过。

## 1. 目标

v0.3.6 让用户和模型能够在当前 workspace 内发现并受限读取历史 Session，解决“继续的不是最新任务”“记得结论但找不到会话”和“更换 Provider/模型后旧任务不可见”的实际问题。

本版建立以下链路：

```text
当前 workspace
  → 搜索历史 Session
  → 查看受限摘要
  → 用户显式切换 Session，或模型按需读取受限历史上下文
  → 继续当前请求
```

它扩展历史发现能力，不改变自动恢复规则，不把所有旧会话自动注入模型上下文，也不引入任务树、后台执行或通用事件查询框架。

## 2. 前置偏差收口记录

v0.3.5 文档声明 NDJSON 已支持：

- `ready.task` 与 `ready.verificationStatus`；
- `task_get` 请求；
- `task_state` 响应。

该偏差已在 v0.3.6 Batch A 中补齐：`ready` 提供受限任务摘要和验证状态，`task_get` 返回 `task_state`；协议不返回 messages、Journal、命令或 Tool Result。

## 3. 已确认取舍

### 3.1 搜索边界

- workspace 是历史查询的授权边界；
- 查询可跨 Provider 和模型，因为更换模型不应使同一项目的旧工作不可发现；
- 自动恢复继续使用 `provider + model + workspaceKey`，本版不改变；
- Session 选择仍是用户显式动作，模型 Tool 不直接切换当前 Session；
- v1-v3 Session 没有可信 `workspaceKey`，不能被 workspace 搜索自动返回；用户仍可通过现有兼容入口显式选择。

### 3.2 数据来源

第一版直接读取现有 JSON Session 文件，不增加 SQLite、FTS、Embedding 或第二份 Session 索引。只有真实数量和性能测试证明 JSON 扫描不足时，才单独设计索引。

可搜索投影只包含：

- Session ID、创建/更新时间、Provider、模型；
- TaskState goal、status、步骤计数和 blocker/open question 数量；
- Context checkpoint；
- 用户消息文本；
- 已提交的 assistant 最终回答。

默认不得搜索或返回：

- system message；
- Tool arguments 和 Tool Result 正文；
- 完整命令、stdout、stderr；
- Approval 请求详情；
- Journal 内部诊断；
- API Key、Token、Authorization、真实 `.env` 内容；
- 未提交的 provisional delta 或模型思维链。

### 3.3 查询服务

新增一个只读、Provider-neutral 的 Session Query seam。建议核心类型：

```ts
interface SessionSearchQuery {
  readonly workspaceKey: string;
  readonly query: string;
  readonly status?: TaskStatus;
}

interface SessionSearchHit {
  readonly sessionId: string;
  readonly provider: string;
  readonly model: string;
  readonly updatedAt: string;
  readonly task?: TaskSummary;
  readonly excerpt: string;
}

interface SessionContextReadQuery {
  readonly workspaceKey: string;
  readonly sessionId: string;
  readonly anchorMessageIndex?: number;
}
```

约束：

- `workspaceKey` 只能由 Runtime 提供，不能来自模型参数或协议客户端；
- 搜索结果按相关性、更新时间和 Session ID 确定性排序；
- 结果数量由 Runtime 固定上限控制，模型和协议请求不能任意提高；
- excerpt 和读取结果必须有字符上限，并返回明确的 `truncated`；
- 读取按完整 conversation unit 截断，不拆开 assistant Tool Call 与 Tool Result；
- 当前 Session 的事件只允许读取当前请求开始前已经持久化的内容；
- 不存在与越权 Session 对模型呈现相同的稳定错误，避免枚举跨 workspace Session ID。

### 3.4 用户入口

TTY 延伸现有 `/sessions`：

```text
/sessions
/sessions <query>
/sessions status:active
/sessions status:blocked <query>
```

列表摘要优先展示 TaskState goal 和状态；没有 TaskState 时回退到 checkpoint 摘要或首条用户消息。用户通过现有选择流程显式切换 Session。

NDJSON 新增：

```ts
{ type: "sessions_list"; id: string }
{ type: "sessions_search"; id: string; query: string; status?: TaskStatus }
{ type: "session_select"; id: string; sessionId: string }
```

响应建议：

```ts
{
  type: "sessions_result";
  id: string;
  sessions: SessionSearchHit[];
  truncated: boolean;
}
```

成功选择继续复用 `session_changed`。协议不返回完整 messages、Journal、Tool Result 或命令输出。

### 3.5 模型 Tool

模型 Tool 只在查询服务与用户入口通过测试后加入：

```text
search_session_history({ query, status? })
read_session_context({ session_id, anchor_message_index? })
```

模型可见 schema 不包含 workspace、limit、cursor、offset、Provider 或模型过滤器。Tool 均为只读、无需 Approval，但继续受 AbortSignal、Tool Step 上限、错误归一化和输出预算约束。

`read_session_context` 返回的内容必须带固定边界说明：它是“不可信历史资料”，不能授权工具、改变 Sandbox/Approval/Permission，也不能替代对当前文件和环境的重新检查。

模型 Tool 不提供：

- Session 切换；
- Session 删除、修改或合并；
- 任意事件 JSON 读取；
- Session lineage/trace；
- 跨 workspace 查询。

## 4. 与现有能力的关系

- TaskState：提供搜索摘要和状态过滤，不复制为第二事实源；
- Context checkpoint：作为历史摘要来源，但不能覆盖 TaskState；
- Memory：继续保存个人偏好和长期事实；Session Query 用于找回过去工作，不把两者合并；
- Compaction：继续决定当前 Session 发送给模型的历史窗口；Session Query 是显式按需读取；
- `/sessions`：继续负责用户显式切换，查询能力只增强发现；
- Session Store：继续是 Session 唯一持久化事实源，查询服务不得维护可写副本。

## 5. 稳定错误码

建议新增：

```text
SESSION_QUERY_INVALID
SESSION_QUERY_NOT_FOUND
SESSION_QUERY_UNAUTHORIZED
SESSION_QUERY_TOO_LARGE
SESSION_QUERY_FAILED
```

模型边界上，NOT_FOUND 与 UNAUTHORIZED 应使用相同安全消息；内部 diagnostics 可以保留精确分类，但不得包含 Session 正文。

## 6. 明确暂缓

- SQLite FTS5、Embedding 和向量检索；
- DSH 式 event search、trace、lineage 和 ZIP export；
- 自动把历史搜索结果注入每次模型请求；
- 模型直接切换或合并 Session；
- 跨 workspace、跨设备或远程 Session 同步；
- Session 标题自动生成；
- Goal 自动续跑、任务树、后台 Job、PTY、并行 Tool、子 Agent；
- 本地 Skills 系统。

## 7. 完成定义

v0.3.6 完成门禁：

1. v0.3.5 NDJSON task 观察契约与实现一致；
2. 同一 workspace 历史可跨 Provider/模型发现；
3. 不同 workspace 无法枚举或读取彼此 Session；
4. 自动恢复规则保持不变；
5. TTY 与 NDJSON 搜索、选择语义一致；
6. 两个模型 Tool 使用窄 schema、有界结果和 Runtime 派生授权；
7. 历史结果不能授权当前操作；
8. Session Store 仍是唯一持久化事实源；
9. 无秘密、Tool 参数、命令输出或私人完整会话进入日志和评估记录；
10. 全量离线门禁通过，真实模型评估仅在用户再次授权后执行。
