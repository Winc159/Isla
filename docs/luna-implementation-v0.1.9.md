# Luna 实施顺序：Isla v0.1.9

## 执行约束

架构依据为 `docs/architecture-v0.1.9.md`。每次只完成一个步骤并运行对应测试。不得修改 Runtime 核心契约来迁就协议层；发现 v0.1.8 基线测试失败时先修复基线。

未经用户明确要求，不执行 Git 提交、推送或远程连接。真实 Provider smoke test 必须得到用户明确许可并使用现有环境配置，禁止把密钥打印或写入 Fixture。

## Step 0：确认基线

1. 读取 `AGENTS.md`、v0.1.8/v0.1.9 架构和本文件；
2. 检查 `git status --short`，保留用户已有改动；
3. 运行 `npm run typecheck` 和 `npm test`；
4. 记录当前测试数量和跳过数量；
5. 若基线失败，先停止 v0.1.9 并修复或报告。

## Step 1：协议类型与纯解析器

新增建议文件：

```text
src/protocol/types.ts
src/protocol/parser.ts
tests/protocol/parser.test.ts
```

实现 `ProtocolRequest`、`ProtocolEvent`、逐行 JSON 解析和 schema 校验。不要引入 schema 库，当前字段较少，使用窄类型守卫即可。

测试：四种输入消息、空行、非法 JSON、缺字段、空 prompt、未知 type、重复 id 所需的纯状态辅助逻辑。

完成信号：解析器无 I/O、无 Runtime 依赖，错误 code 稳定。

## Step 2：协议事件写入器

新增 `ProtocolWriter`，将事件序列化为单行 JSON 并追加换行。

要求：

- stdout 不出现 header、`isla>`、耗时文本、spinner 或 ANSI；
- JSON 序列化失败和流写入失败不得静默忽略；
- delta 与最终完整 text 都保留；
- 单元测试逐行 `JSON.parse` 全部成功。

## Step 3：ProtocolApprovalService

新增：

```text
src/protocol/approval.ts
tests/protocol/approval.test.ts
```

实现审批请求、approvalId 关联、批准、拒绝、remember、错误 id、EOF 默认拒绝和 dispose。服务不直接解析 stdin，由协议 runner 把 `approval_response` 交给它。

完成信号：等待审批不会阻塞其他审批响应或 exit 处理；dispose 后没有未决 Promise。

## Step 4：ProtocolRunner

新增：

```text
src/protocol/runner.ts
tests/protocol/runner.test.ts
```

职责：

- 输出 ready；
- 逐行读取请求；
- 串行调用 ChatSession；
- 映射 response/tool/approval/session/error 事件；
- 管理 BUSY、重复 id、new_session、exit 和 EOF；
- stdout 仅交给 ProtocolWriter；
- stderr 仅记录 debug 诊断。

使用内存 Readable/Writable 和 FakeProvider 测试，不启动真实子进程。

## Step 5：CLI 入口分流

解析 `--protocol ndjson`：

```text
无参数 → runCli()
--protocol ndjson → runProtocol()
其他值 → 启动错误并非零退出
```

入口分流只发生在 composition root。不得把 argv 或 NDJSON 类型传入 `ChatSession`。

保持 `runCli()` 的公开测试接口和现有交互行为不变。

## Step 6：Session 与 Tool 事件关联

为当前 prompt 建立 request id 上下文，将 `onToolStarted` / `onToolFinished` 映射到事件。若现有回调无法表达 `ok`，先以最小方式扩展 Tool 完成回调，必须同步 CLI 与测试。

不得默认输出 Tool 参数、文件内容或完整 Tool Result。失败只输出稳定错误分类和 `ok: false`。

## Step 7：new_session、exit 与 EOF

实现：

- new_session 使用现有 SessionStore 创建空会话；
- 清除 pending execution、进程内审批记忆和其他会话态；
- exit 输出 bye 后退出读取循环；
- EOF 拒绝待审批并有界退出；
- 正在写入 SessionStore 时等待写入完成。

测试正常退出、审批期间退出、EOF、重复 exit 和持久化失败。

## Step 8：子进程端到端测试

新增：

```text
tests/protocol/ndjson.e2e.test.ts
```

先 build，再启动 `node dist/cli.js --protocol ndjson`。测试：

1. 收到 ready；
2. 发送 prompt；
3. 收到 start、delta、end；
4. 连续发送第二轮并确认历史存在；
5. 发送 new_session；
6. 发送 exit 并收到 bye；
7. 进程在超时内退出；
8. stdout 每行都是合法 JSON。

默认 e2e 使用测试 Provider 或可注入 FakeProvider composition，不访问网络。

## Step 9：Agent 行为回归脚本

新增受控测试场景：

- 普通问候；
- 自我介绍；
- 检查自身能力；
- 深入检查 Approval、Sandbox 和 Tool Loop；
- 讨论修改但不执行；
- 用户确认后执行原任务；
- Tool 审批批准与拒绝；
- 相同 Tool 失败达到阈值；
- unknown 意图零 Tool Call；
- 新会话不继承待确认状态。

断言协议状态和 Tool 事件，不对模型自然语言做脆弱的整段字符串匹配。

## Step 10：脚本与文档

在 `package.json` 增加最小脚本，例如：

```json
{
  "protocol": "tsx --env-file-if-exists=.env src/cli.ts --protocol ndjson",
  "test:protocol": "vitest run tests/protocol"
}
```

同步 README 或使用文档，说明启动、输入、输出、审批、安全边界和真实 smoke test 的显式运行方式。

## Step 11：最终验证

依次运行：

```text
npm run typecheck
npm test
npm run build
npm run pack:check
```

额外检查：

- `git diff --check`；
- 搜索 Fixture 中是否出现疑似密钥；
- NDJSON stdout 是否混入 CLI 文本或 ANSI；
- 子进程是否存在未退出句柄；
- 默认测试是否发生网络请求。

最终报告实际测试文件数、通过/跳过/失败数量，以及是否运行真实 Provider smoke test。

## 补充修复：确认后的 execution phase

参考 DSH 的 step/tool pipeline 不变量：每个模型 step 接收当前会话历史与可见工具 schema；模型产生具体 Tool Call 后，Tool Runtime 才执行权限判断和 Approval。Isla 保留现有 IntentClassifier 与执行前用户确认，但确认后的步骤必须满足以下契约：

1. `execute + confirmed` 使用独立 `execution` Prompt phase，并继续暴露当前能力的工具 schema。
2. execution Prompt 明确要求通过目标写工具完成原任务，不允许只返回说明文字。
3. 若模型没有产生要求的写 Tool Call，追加一次只对当前 step 生效的纠偏指令并重试。
4. 第二次仍无目标 Tool Call 时返回结构化 `blocked`；不得声称写入成功。
5. Approval 只处理已经生成的具体 Tool Call，不负责重新判断是否应调用工具。
6. FakeProvider 测试证明 phase Prompt、单次纠偏和有界失败；真实 NDJSON 驱动验证模型、协议、Approval 与文件结果。

## Skill 后续步骤

本版本不要同时创建 Skill。NDJSON 协议稳定且完成至少两轮真实回归后，单独设计 `isla-runtime-testing` Skill。Skill 只编排协议，不复制 parser、Approval 或 Runtime 逻辑。
