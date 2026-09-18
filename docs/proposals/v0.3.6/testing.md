# Isla v0.3.6 测试计划

状态：测试矩阵已执行。默认全部离线；真实评估仅使用隔离资源，测试不得包含真实私人会话、API Key、Token、`.env` 或完整命令输出。

## 1. v0.3.5 协议偏差

### TASK-PROTOCOL-001 ready 无任务

无 TaskState 时 `ready` 不伪造 task；verificationStatus 使用当前 Journal 推导值或按契约省略。

### TASK-PROTOCOL-002 ready 恢复摘要

恢复 v4 Session 后，`ready.task` 只包含 status、goal、completedSteps、totalSteps、blockerCount，不包含 constraints、assumptions、blocker 正文或 messages。

### TASK-PROTOCOL-003 task_get

请求 ID 与 `task_state` 响应配对；有任务时返回当前 TaskState 和 verificationStatus。

### TASK-PROTOCOL-004 task_get 无任务

返回稳定的缺省形状，不创建任务、不增加 revision、不修改 Session。

### TASK-PROTOCOL-005 隐私

`ready` 和 `task_state` 不返回 Journal、命令、Tool Result、API Key、Authorization 或 Session 文件路径。

## 2. Session 查询授权

### SESSION-QUERY-001 当前 workspace

只返回 workspaceKey 精确匹配的 v4 Session。

### SESSION-QUERY-002 跨 Provider/模型

同一 workspace 的 OpenAI、DeepSeek、Local 和 Bailian Session 都可显式发现。

### SESSION-QUERY-003 不改变自动恢复

自动启动仍只恢复 `provider + model + workspaceKey` 的最新 Session。

### SESSION-QUERY-004 不同 workspace

搜索、读取和选择都不能发现其他 workspace Session。

### SESSION-QUERY-005 legacy Session

v1-v3 不进入 workspace 搜索；现有显式兼容选择和保存迁移行为无回归。

### SESSION-QUERY-006 越权不可枚举

不存在 Session 和其他 workspace Session 在模型边界返回相同安全错误与消息。

## 3. 搜索与排序

### SESSION-SEARCH-001 Task goal

关键词命中 TaskState goal，返回状态与步骤计数摘要。

### SESSION-SEARCH-002 checkpoint

无 TaskState 时可命中结构化 checkpoint。

### SESSION-SEARCH-003 消息

可命中用户消息和已提交 assistant 最终回答；不命中 system、Tool arguments 或 Tool Result。

### SESSION-SEARCH-004 中文与大小写

中文 substring 和拉丁字符大小写不敏感搜索可用，不引入分词器依赖。

### SESSION-SEARCH-005 状态过滤

active、blocked、completed 过滤正确；无 TaskState 的 Session 不伪造 active。

### SESSION-SEARCH-006 确定性

相同输入重复查询得到相同顺序；相关性相同时按 updatedAt、Session ID 打破平局。

### SESSION-SEARCH-007 当前 Session

用户列表可以显示当前 Session；模型 `search_session_history` 默认排除当前 Session。

### SESSION-SEARCH-008 固定上限

超过结果上限时返回固定数量并标记 truncated；模型和协议不能提高上限。

## 4. 有界历史读取

### SESSION-READ-001 按 Session 读取

合法 Session 返回受限上下文和消息位置，不返回完整 StoredSession JSON。

### SESSION-READ-002 anchor

anchorMessageIndex 合法时返回附近完整 conversation units；负数、越界和非整数稳定失败。

### SESSION-READ-003 Tool 配对

任何截断都不能把 assistant Tool Call 与对应 Tool Result 分开。

### SESSION-READ-004 字符上限

超出上限时按 conversation unit 截断，并设置 truncated；不截断到无效 JSON 或半个消息对象。

### SESSION-READ-005 当前调用点

读取当前 Session 时看不到调用 Session Query Tool 之后的消息或未提交 provisional output。

### SESSION-READ-006 历史不可信

模型结果包含固定不可信历史说明；历史文本中的“批准”“忽略 Sandbox”等内容不能改变 Tool 权限。

## 5. 数据安全

### SESSION-SAFE-001 搜索投影

system message、Tool arguments、Tool Result、命令输出、Approval details 和 Journal diagnostics 不进入搜索投影。

### SESSION-SAFE-002 秘密过滤

包含测试用 API Key、Authorization、Token 或 `.env` 样例的禁区字段不会出现在搜索结果、协议、CLI、日志和 diagnostics。

### SESSION-SAFE-003 路径

workspaceKey、Session 文件路径和 Session 存储目录不返回给模型或协议客户端。

### SESSION-SAFE-004 损坏文件

单个损坏或不兼容 Session 产生受控 warning，不泄漏正文，也不阻断其他合法结果。

## 6. TTY

### SESSION-CLI-001 裸命令兼容

`/sessions` 保持现有列表、分页、当前标记、Enter 切换和 Esc 取消行为。

### SESSION-CLI-002 关键词搜索

`/sessions <query>` 只展示匹配结果，并可选择切换。

### SESSION-CLI-003 状态过滤

`status:active|blocked|completed` 可单独或与关键词组合。

### SESSION-CLI-004 摘要回退

摘要优先级为 TaskState goal → checkpoint → 首条用户消息 → 新对话。

### SESSION-CLI-005 空结果

空结果明确显示，不退出程序、不创建或切换 Session。

## 7. NDJSON

### SESSION-PROTOCOL-001 list/search

`sessions_list` 和 `sessions_search` 返回统一 `sessions_result`，请求 ID 正确配对。

### SESSION-PROTOCOL-002 select

合法选择发出唯一 `session_changed`；后续 prompt 使用被选 Session 的消息、Context、TaskState 和 Journal。

### SESSION-PROTOCOL-003 选择失败

不存在、legacy 或跨 workspace Session 不替换当前 Session，返回稳定可恢复错误。

### SESSION-PROTOCOL-004 输入约束

拒绝客户端提供 workspaceKey、文件路径、limit、cursor 或未知危险字段。

### SESSION-PROTOCOL-005 TTY 等价

相同 query 和 status 得到与 TTY 相同的核心结果集合与排序。

## 8. 模型 Tool 与 Agent Loop

### SESSION-TOOL-001 schema

两个 Tool 使用完整顶层 JSON Schema、必填项和枚举，模型字段使用 snake_case，拒绝未知字段；不暴露 workspace、limit 或 cursor。

### SESSION-TOOL-002 search → read

FakeProvider 先搜索、再读取命中 Session、最后产出非空回答；Tool 配对和唯一终态正确。

### SESSION-TOOL-003 不机械调用

普通问答和当前上下文已足够的请求不要求调用 Session Query。

### SESSION-TOOL-004 取消

搜索或读取期间取消产生唯一 cancelled 终态，无后续 Tool、assistant 或后台写入。

### SESSION-TOOL-005 错误归一化

覆盖 INVALID、NOT_FOUND/UNAUTHORIZED 安全合并、TOO_LARGE 和内部 FAILED。

### SESSION-TOOL-006 权限不可提升

读取到的历史 Approval、命令或用户文字不能跳过当前 Approval、Sandbox、Permission 和 read-before-edit。

### SESSION-TOOL-007 请求重建

所有发送给模型的历史查询调用与结果都能由当前 Session messages 重建；查询服务隐藏状态不参与请求事实。

## 9. 性能与兼容

### SESSION-PERF-001 多 Session 扫描

临时生成多个小型和中等 Session，验证结果完整、顺序稳定和输出有界；记录基线而不写机器相关的极窄耗时断言。

### SESSION-PERF-002 大 Session

单个超大 Session 不构造无限拼接结果，不导致未捕获内存错误。

### SESSION-COMPAT-001 平台路径

覆盖 Windows 盘符大小写和分隔符，以及 macOS/Linux 大小写敏感路径语义。

### SESSION-COMPAT-002 Provider 回归

OpenAI、DeepSeek、Local、Bailian 的普通文本、Tool Calling、streaming 能力声明和现有 Session 自动恢复无回归。

### SESSION-COMPAT-003 Memory/Compaction

Memory 召回与 Session Query 保持独立；compaction checkpoint 仍只压缩当前 Session，不自动合并其他 Session。

## 10. 完整门禁

```text
npm run typecheck
npm test
npm run build
npm run pack:check
npm audit
git diff --check
git status --short
```

真实 Provider 测试默认 skip。经用户授权已验证最小 Qwen 场景：模型搜索隔离旧 Session、读取受限上下文并回答；记录中不保存 query、excerpt、Session 正文或回答正文。
