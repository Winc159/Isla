# Isla v0.3.6 实施顺序

状态：Batch A-E 已实现；隔离 Bailian/Qwen 两步历史召回真实评估通过。架构依据为 [design.md](./design.md)，测试依据为 [testing.md](./testing.md)。

每个 Batch 必须独立可验证。前一 Batch 未通过停点，不进入后一 Batch；不得顺手加入索引、Skills、后台任务或 Session 事件框架。

## 0. 开始前检查

1. 读取 `AGENTS.md`、`docs/current/README.md`、v0.3.5 任务状态文档和本提案；
2. 执行 `git status --short --branch` 和 `git diff --check`；
3. 确认 package 版本保持 `0.2.9`，版本升级不属于实现 Batch；
4. 运行与 Session/Protocol/TaskState 相关的现有测试，记录基线；
5. 不执行 `git add`、`commit`、`push`；
6. 不访问真实 Provider。

## 1. Batch A：收口 v0.3.5 NDJSON 偏差

预计修改：

- `src/protocol/types.ts`
- `src/protocol/runner.ts`
- `src/cli.ts` 或共享 Session 投影模块
- `tests/protocol.test.ts`
- 相关 subprocess/e2e 测试

步骤：

1. 为 `ready` 增加可选 task 摘要与 verificationStatus；
2. 增加 `task_get` 请求和 `task_state` 响应；
3. task 摘要复用 `summarizeTaskState`，verificationStatus 复用 Journal 推导；
4. `task_state` 可以返回受信本地协议允许的 TaskState，但不得返回 messages、Journal、命令或 Tool Result；
5. 无任务时保持稳定的缺省形状，不伪造空 TaskState；
6. 未知字段继续遵循当前协议兼容规则；
7. 更新 v0.3.5 文档状态，使声明与实现一致。

停点：`ready`、`task_get/task_state` 配对、恢复和隐私专项测试通过；尚未增加 Session 搜索。

## 2. Batch B1：只读 Session Query 核心

建议新增：

- `src/session-query/types.ts`
- `src/session-query/service.ts`
- `src/session-query/projection.ts`
- `tests/session-query/service.test.ts`
- `tests/session-query/projection.test.ts`

可能最小修改：

- `src/session-store.ts`
- `src/core/context.ts`，仅在需要复用 conversation unit 切分时修改

步骤：

1. 增加不按 Provider/模型过滤的 Session 枚举内部方法；
2. 只把解析成功且 version=4、workspaceKey 精确匹配的 Session 交给查询服务；
3. 建立可搜索的只读投影，不修改 StoredSession schema；
4. 实现大小写不敏感的字面搜索，中文按普通 substring 工作；
5. 可选 TaskStatus 过滤先于排序；
6. 命中排序按字段权重、更新时间、Session ID 确定性处理；第一版权重保持简单并用测试固定；
7. 固定 Runtime 结果上限和 excerpt 字符上限；
8. 搜索结果不包含 workspaceKey、完整消息或内部文件路径；
9. 读取受限上下文时复用 conversation unit，保证 Tool 配对不被拆开；
10. 所有文件读取和解析失败通过现有 warning/diagnostics 降级，不能使其他合法 Session 消失。

停点：纯服务测试通过；没有 CLI、协议和模型 Tool。

## 3. Batch B2：性能与安全基线

步骤：

1. 使用临时目录生成小、中等规模 Session 集合；
2. 验证扫描结果确定性和内存上限；
3. 对超大单 Session 只生成有界投影，不拼接无限正文；
4. 记录 JSON 扫描基线，但不设脱离真实需求的苛刻毫秒阈值；
5. 只有测试显示无法满足 CLI 使用，才暂停并重新确认是否引入索引。

停点：证明第一版无需 SQLite；如果不能证明，停止实现并向用户报告，不自行扩展架构。

## 4. Batch C1：TTY `/sessions` 搜索

预计修改：

- `src/cli/sessions-command.ts`
- `src/cli/command.ts`，仅在需要传入 Session Query 服务时修改
- CLI 命令测试

步骤：

1. 保留裸 `/sessions` 的现有选择行为；
2. 支持 `/sessions <query>` 与 `status:` 过滤；
3. 列表优先显示 TaskState goal、状态和步骤计数；
4. 无 TaskState 时回退 checkpoint 或首条用户消息；
5. 空结果明确显示，不创建 Session；
6. Enter 继续走现有 switch-session 结果；
7. Esc、Ctrl+C、分页和当前 Session 标记无回归。

停点：TTY 搜索和选择可用；自动恢复语义未改变。

## 5. Batch C2：NDJSON Session 发现与选择

预计修改：

- `src/protocol/types.ts`
- `src/protocol/runner.ts`
- `src/cli.ts` 或 SessionFactory/ApplicationContext 装配
- `tests/protocol.test.ts`
- NDJSON subprocess/e2e 测试

步骤：

1. 增加 `sessions_list`、`sessions_search`、`session_select`；
2. list/search 返回统一 `sessions_result`；
3. Protocol Runner 从当前 Application/Session 上下文取得 workspaceKey；
4. `session_select` 只能选择当前 workspace 的 v4 Session；
5. 成功后复用 `session_changed`，失败不替换当前 Session；
6. 协议摘要与 TTY 复用同一投影函数；
7. 请求不可指定 workspace、输出上限、目录或 Session 文件路径。

停点：无 TTY 客户端可以搜索、选择、读取 task 状态并继续对话；模型 Tool 尚未注册。

## 6. Batch D1：模型 Session Query Capability

建议新增：

- `src/tools/session-query.ts`
- `tests/tools/session-query.test.ts`

预计修改：

- Capability 静态组合入口
- RequestContextBuilder 的固定 Capability instructions，只增加必要的一段

步骤：

1. 增加 `search_session_history`；
2. 增加 `read_session_context`，模型字段使用 snake_case（`session_id`、`anchor_message_index`）；
3. schema 使用顶层、完整字段并拒绝未知字段；
4. workspaceKey、limit 和 cursor 不进入模型 schema；
5. 当前 Session 默认从搜索结果排除；
6. Tool Result 使用短标题、受限 excerpt 和稳定截断标记；
7. read 结果增加“不可信历史资料”固定说明；
8. 只读 Tool 无 Approval，但受取消、Step 上限和错误归一化约束；
9. NOT_FOUND 与 UNAUTHORIZED 在模型边界上不可区分；
10. 不提供模型 Session 切换 Tool。

停点：FakeProvider 可完成 search → read → 最终回答，且请求可由 Session 消息重建。

## 7. Batch D2：Agent Loop 与恢复回归

步骤：

1. 搜索 Tool Result 驱动下一 Model Step；
2. 历史资料不能绕过 Approval、Sandbox 或 read-before-edit；
3. compaction 不自动复制历史查询结果之外的新 Session 内容；
4. 取消查询后没有后续 Tool 或 assistant 提交；
5. 当前 Turn 不得读取调用点之后的消息；
6. Session 切换后 TaskState、Journal、Context 和消息保持现有恢复语义；
7. 普通单轮请求不机械调用 Session Query。

停点：完整离线矩阵通过，尚未执行真实模型评估。

## 8. Batch E：文档、门禁与可选真实评估

必须执行：

```text
npm run typecheck
npm test
npm run build
npm run pack:check
npm audit
git diff --check
git status --short
```

另执行：

- Session fixture、日志、diagnostics 和构建产物敏感内容扫描；
- Windows 路径大小写和分隔符测试；
- macOS/Linux 路径语义的纯函数测试；
- OpenAI、DeepSeek、Local、Bailian 现有离线回归；
- 所有真实 smoke 默认 skip。

真实模型评估必须重新取得用户授权，并使用隔离 Config/Profile、workspace、Session 目录和 memory 数据库。评估记录只保留模型 ID、Tool 名、命中数量、截断标记、状态枚举和稳定错误码，不保存搜索词、历史正文或最终回答正文。

## 9. 当前实现与真实评估记录

- Batch A：`ready` 任务摘要、验证状态和 `task_get/task_state` 已实现；
- Batch B：JSON Session 跨 Provider/模型 workspace 查询、脱敏投影、有界读取已实现；
- Batch C：TTY `/sessions` 过滤和 NDJSON list/search/select 已实现；
- Batch D：`search_session_history`、`read_session_context` 已接入 Capability 和离线 Agent Loop 测试；
- Bailian/Qwen 真实评估：NDJSON 可搜索隔离旧 Session；Qwen 完成 `search_session_history` → `read_session_context` → `response_end`；首次失败根因是模型 schema 使用 camelCase，修正为 snake_case 后通过；
- 临时 Config、Session、workspace 和评估资源均由 smoke 测试清理；
- `npm test`：85 个测试文件通过、5 个真实 smoke 跳过，378 passed、7 skipped；针对性回归 54/54 通过；
- typecheck、build、diff check 通过；`pack:check` 曾受本机 npm cache EPERM 影响，需在发布前重跑。

## 10. 下一模型接手顺序

切换模型后按以下顺序开始，不要重新扩大设计：

1. 读取 `AGENTS.md`；
2. 读取 `docs/current/README.md`；
3. 读取 `docs/current/task-state-and-recovery-v0.3.5.md`；
4. 读取本目录的 `design.md`、`implementation.md`、`testing.md`；
5. 检查 `git status` 与当前 diff；
6. 发布前复核真实评估记录和隐私清理；
7. 不增加任务树、后台 Job、PTY、Skills 或更复杂 Session Query；
8. 不升级 package 版本，不提交，不推送，不运行真实 Provider。
