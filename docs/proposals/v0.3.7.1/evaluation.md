# Isla v0.3.7.1 评估方案

状态：离线门禁已执行；真实 Provider 评估尚未执行。当前先记录可复核结果，避免把未完成的 NDJSON runner 接线误报为完成。

## 当前证据

- TypeScript `tsc --noEmit`：通过。
- Vitest：89 个测试文件通过、5 个跳过；388 passed、7 skipped。
- 真实 Provider：未启动；不会在未完成协议 runner 接线前宣称通过。

## 真实评估尝试（2026-09-18）

已使用项目现有 smoke driver 运行 `real-provider` 与 `real-ndjson`。DeepSeek 返回稳定 HTTP 402（Insufficient Balance）。随后使用本机 Bailian Profile（模型目录可读取，选择现有 `qwen3.7-plus`）运行隔离 NDJSON `skill_invoke`：收到 `ready`、`model_step_start`、`model_step_end(candidate_yield)`、`response_end`，耗时约 4.4 秒；未记录正文、Key 或路径。该结果确认 Bailian Provider 与 NDJSON Skill 调用链可用，但仍需补充 TTY、安全负向和持久化断言。

TTY 评估尝试通过管道输入无法构造真实 TTY，CLI 只完成启动横幅并未消费命令；因此不计为 TTY 通过，需后续使用真实 PTY 驱动。

## 1. 目标

验证 `/skill` 确实进入同一模型 Turn，并且没有扩大权限或污染后续 Turn。

## 2. 离线场景

- 直接调用：`/skill fixture-review 检查 fixture.txt`，期望 direct context → read_text_file → response_end，且无 `skill` Tool Call；
- 后续 Turn：无关问题不再包含旧正文；
- 取消：Turn cancelled、无 assistant 最终回答、后续可继续；
- Approval：批准前文件不变，拒绝后 blocked，Skill 文本不能代替批准；
- 恢复：历史可重建，新 Turn 不自动重放旧 Skill。

## 3. 隔离真实评估

使用支持 Tool Calling 的已配置模型，执行时从 Profile 读取。资源包括临时 Config/Profile、workspace、Skill bundle、Session directory、memory 和 fixture。

TTY 正向通过条件：模型不调用 `skill`，直接调用 `read_text_file`，返回预期 marker，文件未修改，Session source 与 Turn 状态正确。

NDJSON 正向发送 `skill_invoke`，检查 response/model/tool 事件顺序，响应不得包含正文或路径。

安全负向要求 Skill 越界读取或未经批准写入，检查 Sandbox/Approval 拒绝和最终文件状态。随后同 Session 发送无关 prompt，确认旧正文没有再次出现。

## 4. 记录边界

允许记录 provider、model、session_version、message_source_kind、tool_names、turn_status、stable_error_codes、approval_requested、workspace_changed 和 temporary_resources_cleaned。

禁止记录 Skill 正文、真实路径、API Key、Token、Provider 原始响应、私人请求和完整模型回答。

## 5. 失败分类

- `EVAL-DIRECT-NOT-INJECTED`：模型没有收到正文；
- `EVAL-DIRECT-DOUBLE-LOAD`：直接 invocation 后又调用 `skill`；
- `EVAL-DIRECT-LEAK`：正文进入后续 Turn、目录或协议响应；
- `EVAL-DIRECT-PERSISTENCE`：消息与 Journal 非原子或无法恢复；
- `EVAL-DIRECT-CANCEL`：取消后仍继续 Tool/assistant；
- `EVAL-DIRECT-SECURITY`：绕过 Approval、Sandbox 或 read-before-edit；
- `EVAL-INFRASTRUCTURE`：Provider、网络、npm cache 或临时目录故障。

## 6. 完成门禁

离线成功、后续 Turn、取消、Approval、恢复全部通过；全量门禁通过；真实 TTY、NDJSON 和安全负向经授权完成；临时资源清理；文档只保留脱敏证据；未增加永久 Skill Prompt、pending Skill 或额外权限。
