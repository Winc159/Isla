# Isla v0.3.4.2 验证感知的完成门禁

状态：Batch A-C 已实现；全量离线回归已通过。Batch D 已完成隔离 Session 的只读、未验证和失败后修复真实场景；重复失败场景已尝试，但模型继续发起验证，未稳定复现确定性 blocked。

## 目标

v0.3.4.2 完成 v0.3.4 安全命令执行闭环的最后一段：把 v0.3.4.1 已记录的修改后验证状态用于完成判断，并把结果以非敏感、可重建的方式交付给 TTY 和 NDJSON 调用方。

完整链路为：

```text
发现 → 读取 → 修改 → 执行验证 → 根据结果继续修复 → 带验证状态交付
```

本版只处理成功文件修改后的完成语义，不新增测试发现框架、任务分类器、后台 Job、PTY、MCP、子 Agent、Git 写操作或自然语言结果解析。

## 一、完成策略

### 1. 状态与行为

沿用 v0.3.4.1 的 `VerificationStatus`，不增加持久化状态：

| 状态 | 第一次完成尝试 | 再次完成尝试 |
| --- | --- | --- |
| `not_applicable` | 接受 | 不适用 |
| `passed_after_last_change` | 接受 | 不适用 |
| `not_run` | 拒绝一次，要求运行适用检查或明确无适用检查 | 接受为未验证交付 |
| `failed_after_last_change` | 拒绝一次，要求读取结果、修复并重新验证 | 若状态未改变，确定性 `blocked` |

`not_run` 的第二次完成不是验证通过。Runtime 必须把它作为未验证交付显式投影，不能把状态改写为 `passed_after_last_change`，也不新增由模型自报的“跳过验证”Journal 事实。

### 2. 新增门禁原因

```ts
type CompletionRejectionReason =
  | ExistingReasons
  | "verification_missing_after_mutation"
  | "verification_failed_after_mutation";
```

- `verification_missing_after_mutation`：当前存在成功文件修改，但最后一次修改之后没有明确验证命令；
- `verification_failed_after_mutation`：最后一次修改之后最近一次验证命令失败、超时或被终止。

门禁优先级保持安全事实优先：取消、活动 Tool、未批准动作、缺失 Tool Result 和必需外部证据先于验证状态判断。

### 3. 有界重试

- 每个原因在同一 Turn 最多触发一次修复机会；
- `not_run` 重复出现时接受模型最终回答，但交付状态保持未验证；
- `failed_after_last_change` 重复出现时返回 Runtime 生成的 `blocked`，不提交模型声称成功的正文；
- 一旦模型成功验证，状态变为 `passed_after_last_change`，门禁正常接受；
- 验证后再次成功修改，状态回到 `not_run`，重新适用一次修复机会。

该策略不解析模型自然语言，也不猜测某个项目是否存在测试。

## 二、结果投影

### 1. Core 响应

在 `ModelResponse` 增加可选非敏感字段：

```ts
readonly verificationStatus?: VerificationStatus;
```

只要当前 Session Journal 可推导状态，最终响应就携带该字段。它不包含命令、路径、stdout、stderr 或文件正文。

### 2. TTY

TTY 在 assistant 正文之后显示一行确定性摘要：

```text
验证：已通过
验证：未运行
验证：失败
```

`not_applicable` 不显示，避免影响普通问答和只读任务。摘要由 Runtime 状态生成，不依赖模型措辞。

### 3. NDJSON

`response_end` 增加可选字段：

```ts
verificationStatus?: VerificationStatus;
```

旧客户端可忽略未知字段；不升级协议消息类型，不改变 `tool_start`、`tool_end` 或 Approval 事件。

### 4. Journal 与恢复

- 不修改 Session Journal version；
- 不新增命令、输出或路径持久化；
- 状态继续只由 `workspace_mutation` 与 `verification` 动作重放得到；
- Session 恢复后 Completion Gate 与交付投影必须得到相同结果。

## 三、实施步骤

### Batch A：扩展 Completion Gate 纯契约

- `CompletionGateInput` 增加 `verificationStatus`；
- 增加两个 rejection reason 和稳定 observation；
- 实现 `not_run` 一次提醒后接受、`failed` 重复后 blocked；
- 保持现有安全原因优先级和行为不变。

停点：只运行 Completion Gate 单元测试，不接 Session。

### Batch B：接入 Agent Loop

- 每次模型尝试完成时从当前 Journal 推导状态；
- 把状态传给 Completion Gate；
- 成功验证后允许完成；
- 未验证二次完成时保留模型正文并标记未验证；
- 验证失败重复完成时丢弃模型成功声明，返回确定性 blocked 文本。

停点：Session 测试覆盖修改、验证、再次修改和有界重试。

### Batch C：TTY 与 NDJSON 投影

- `ModelResponse` 增加 `verificationStatus`；
- TTY 输出确定性中文摘要；
- NDJSON `response_end` 增加可选枚举字段；
- 确认普通问答不增加多余输出。

停点：协议和 CLI 测试证明状态可见且没有正文泄露。

### Batch D：回归与真实评估

- 完整离线门禁；
- 使用 Bailian `qwen3.7-plus` 运行三个临时 fixture：未验证交付、失败后修复成功、失败后重复结束；
- 只记录模型 ID、事件类型、Tool 名、Approval 决策、稳定错误码和验证枚举；
- 清理临时 fixture，不保存真实会话正文。

## 四、测试矩阵

### Completion Gate

1. `not_applicable` 直接接受；
2. `passed_after_last_change` 直接接受；
3. `not_run` 第一次返回 `verification_missing_after_mutation`；
4. 相同原因第二次接受，但状态仍为 `not_run`；
5. `failed_after_last_change` 第一次返回 `verification_failed_after_mutation`；
6. 相同原因第二次返回 `blocked`；
7. 首次失败后验证成功可以完成；
8. 验证成功后再次修改重新触发 missing；
9. 取消、活动 Tool、Approval、Tool Result 和外部证据原因优先级不回归。

### Session 与协议

1. 成功 edit/write 后直接 Yield 会被退回一次；
2. 模型随后调用 `run_command` 且验证通过，最终响应为 passed；
3. 验证失败后模型可继续读、改、重新验证；
4. 未验证的二次 Yield 保留回答，但 `verificationStatus=not_run`；
5. 重复失败时返回 blocked，不能提交虚假的成功正文；
6. TTY 只对适用状态显示摘要；
7. NDJSON `response_end` 可选字段与 Core 一致；
8. Session 恢复前后结果一致；
9. 日志、Journal、fixture 不含命令、输出、路径正文或秘密。

## 五、采用、暂缓与拒绝

采用：基于 Journal 事实的确定性门禁、有界一次修复机会、Core/TTY/NDJSON 的统一状态投影。

暂缓：自动发现 package scripts、按文件类型推断测试、多个验证命令聚合、验证覆盖率、结构化测试报告和 Completion Gate 配置化。

拒绝：解析模型自然语言判断是否验证、把任意 exit code 0 命令自动视为验证、由模型写入“已跳过验证”的可信事实、对所有文件修改永久强制测试通过。

## 六、完成门禁

```text
npm run typecheck
npm test
npm run build
npm run pack:check
npm audit
git diff --check
```

完成标准：离线矩阵全部通过；三个真实 Qwen 场景符合状态机；普通问答与只读任务无行为回归；临时 fixture 和评估正文已清理；文档状态与实现一致。
