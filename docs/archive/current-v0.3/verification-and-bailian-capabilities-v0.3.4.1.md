# Isla v0.3.4.1 修改验证状态与 Bailian Tool Calling 收口

状态：Batch A-D 已实现并通过离线门禁；真实 Bailian 评估沿用 v0.3.4 的授权闭环。

## 目标

v0.3.4.1 只补充两项已经由真实使用驱动的正确性能力：

1. 记录最后一次文件修改之后是否执行过明确的验证命令，以及验证通过、失败或尚未运行；
2. Bailian 只对经过离线协议测试和授权真实 Tool Loop 验证的模型 ID 声明 Tool Calling，不按 Provider 整体放开。

本版不新增通用计划系统、后台 Job、PTY、MCP、子 Agent、自动测试发现或输出解析框架。

## 一、修改后验证状态

### 1. 状态语义

验证状态是由 Session Journal 中的非敏感动作事实派生的，不保存命令正文、stdout、stderr 或文件内容：

```ts
type VerificationStatus =
  | "not_applicable"
  | "not_run"
  | "passed_after_last_change"
  | "failed_after_last_change";
```

- `not_applicable`：当前可见历史中没有成功文件修改；
- `not_run`：最后一次成功文件修改之后没有明确的验证命令；
- `passed_after_last_change`：最后一次成功文件修改之后，最近一次明确验证命令正常退出；
- `failed_after_last_change`：最后一次成功文件修改之后，最近一次明确验证命令非零退出、超时或被信号终止。

新的成功文件修改会使此前验证立即失效并回到 `not_run`。失败或被拒绝的写入不改变状态。普通命令不改变验证状态。

### 2. `run_command` 契约补充

增加可选参数：

```ts
{
  command: string;
  workdir?: string;
  timeoutMs?: number;
  purpose?: "verification" | "other";
}
```

`purpose` 默认是 `other`。只有显式 `purpose: "verification"` 的调用更新验证状态。Tool schema 和 Capability instructions 要求模型在运行测试、构建、类型检查、lint 或专用检查脚本时标记为 `verification`，不得把 `pwd`、文件查看、安装依赖或普通生成命令标成验证。

验证通过只依据进程结果：`exitCode === 0`、未超时且未取消。v0.3.4.1 不解析 Vitest、TypeScript、lint 或自定义命令的输出语义。

### 3. Journal 事实

为 `TurnActionRecord` 增加不含正文的动作：

```ts
| { readonly type: "workspace_mutation"; readonly step: number; readonly tool: "write_text_file" | "edit_text_file" }
| { readonly type: "verification"; readonly step: number; readonly outcome: "passed" | "failed" }
```

事实只在对应 Tool Result 成功返回后写入。`workspace_mutation` 不记录路径；`verification` 不记录命令和输出。状态由全部 Turn 按 sequence 和 action 顺序重放得到，因此可以跨 Turn、重启和 Session 恢复重建。

旧 Session Journal 没有这些动作时继续合法；其状态按已有记录推导为 `not_applicable`，不猜测历史修改或验证。

### 4. 模型与用户可见投影

- 当当前状态为 `not_run` 或 `failed_after_last_change` 时，在下一 Model Step 注入一条 Runtime 事实摘要，提醒模型运行适合的验证或明确说明未验证原因；
- 不强制所有修改都运行测试，不因文档修改或无可用检查而阻止 Yield；
- Completion Gate v0.3.4.1 不新增强制 rejection reason，避免把“没有适用测试”误判为失败；
- `/trace` 增加 `verification=<status>`，不展示命令、路径、输出或文件正文；
- NDJSON `tool_start`/`tool_end` 保持现状，不增加命令和输出字段。

## 二、Bailian 按模型收窄 Tool Calling

### 1. 单一事实源

`src/providers/bailian-capabilities.ts` 继续作为 Bailian 模型能力的唯一事实源。Tool Calling 使用精确 model ID 白名单，不采用前缀、包含匹配、目录厂商字段或模型名称猜测。

v0.3.4.1 已有证据支持的白名单：

```ts
const VERIFIED_TOOL_MODELS = new Set([
  "qwen-plus",
  "qwen3.7-plus",
]);
```

- `qwen-plus`：此前真实 `glob_project`、`grep_project`、`ask_user_question` Tool Loop 已验证；
- `qwen3.7-plus`：本次真实 `read_text_file → edit_text_file → run_command → Yield` 已验证。

未知模型、其他 Qwen 变体和第三方模型保持 `toolCalling=false`。模型目录中的 `FunctionCalling` 元数据只能用于展示和候选筛选，不能自动扩大运行时白名单。

### 2. 能力行为

- `toolCalling=false` 时不向模型发送 Tool schema，不进入 Tool Loop；
- `toolCalling=true` 时沿用当前 one-shot Tool Calling；
- `streamingToolCalls` 继续为 `false`；
- Profile 切换只影响下次启动，当前 Session 不动态改变能力；
- `/config`、NDJSON `ready` 和 Provider 实际请求路径必须报告同一能力事实。

## 三、实施步骤

### Batch A：冻结状态契约

- 更新 `run_command` schema 与参数解析；
- 增加 Journal mutation/verification action；
- 定义纯函数 `deriveVerificationStatus(journal)`；
- 保持旧 Journal v1 可读取，不升级 Session 格式。

停点：纯状态推导测试通过，尚不改变 Session 执行流程。

### Batch B：记录与投影

- 成功 `write_text_file`、`edit_text_file` 后记录 mutation；
- `purpose: "verification"` 的 `run_command` 完成后记录 passed/failed；
- 把状态摘要加入后续 Model Step Runtime context；
- `/trace` 输出非敏感状态；
- 不改变 Completion Gate 强制条件。

停点：离线 Session 测试可证明“修改使验证失效、验证结果可跨 Turn 重建”。

### Batch C：Bailian 能力白名单收口

- 把 `qwen3.7-plus` 加入精确白名单；
- 增加已验证、未知和近似名称测试；
- 验证 `ready`、请求路径和 Tool schema 是否一致；
- 不从在线目录动态修改白名单。

停点：未知 Bailian 模型不收到 Tool schema，两个已验证模型维持 Tool Loop。

### Batch D：回归与授权真实评估

- 执行完整离线门禁；
- 使用 `qwen3.7-plus` 重跑临时 fixture；
- 验证修改后状态先为 `not_run`，验证命令成功后为 `passed_after_last_change`；
- 再修改一次，确认状态重新变为 `not_run`；
- 运行预期失败检查，确认状态为 `failed_after_last_change`；
- 使用一个非白名单 Bailian 模型只验证 `ready.toolCalling=false`，不要求产生 Tool Call。

## 四、离线测试矩阵

### 验证状态

1. 无修改时为 `not_applicable`；
2. 成功 write/edit 后为 `not_run`；
3. 被拒绝、失败或取消的写入不改变状态；
4. 普通 `run_command` 不改变状态；
5. verification 命令 exit 0 后为 `passed_after_last_change`；
6. 非零退出、超时或信号终止后为 `failed_after_last_change`；
7. 取消的 Turn 不伪造验证通过；
8. 验证通过后再次修改回到 `not_run`；
9. 跨 Turn 和 Session 恢复重放一致；
10. 旧 Journal 无新增动作时保持兼容；
11. `/trace` 只显示枚举状态，不泄露路径、命令和输出；
12. Runtime 摘要能进入下一 Model Step，且可由 Journal 重建。

### Bailian 能力

1. `qwen-plus` 为 `toolCalling=true`；
2. `qwen3.7-plus` 为 `toolCalling=true`；
3. 未知模型为 `false`；
4. `qwen3.7-plus-latest` 等近似名称不能误命中；
5. streaming 开关只影响 `nativeStreaming`；
6. `streamingToolCalls` 始终为 `false`；
7. `toolCalling=false` 时请求不携带 Tool schema；
8. NDJSON `ready` 与实际 Provider 请求路径一致。

## 五、真实评估与完成门禁

真实评估只记录 Profile、模型 ID、事件类型、Tool 名、Approval 决策、验证状态和稳定错误码，不保存 API Key、完整命令、stdout/stderr、文件正文或模型回答正文。

完成门禁：

```text
npm run typecheck
npm test
npm run build
npm run pack:check
npm audit
git diff --check
```

完成标准：离线矩阵全部通过；`qwen3.7-plus` 真实修改—验证状态转换通过；临时 fixture 和评估脚本清理；未知模型保持 Tool Calling 关闭；文档状态与实际实现一致。
