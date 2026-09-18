# Isla v0.3.7.1 测试计划

状态：已执行主要离线回归；CLI/Protocol/Session 门禁通过。真实 Bailian NDJSON 已通过；真实 PTY、取消和安全负向仍列为后续补充验证。

## 1. 命令

- `SKILL-INVOKE-CLI-001`：`/skill release-check` 触发一个 Turn；
- `SKILL-INVOKE-CLI-002`：带 request 时保留余下文本；
- `SKILL-INVOKE-CLI-003`：`/skills release-check` 只预览，无消息、Journal 或 Provider 副作用；
- `SKILL-INVOKE-CLI-004`：缺名、非法名、控制字符和未知名安全失败；
- `SKILL-INVOKE-CLI-005`：`userInvocable=false` 不可调用。

## 2. Session 与消息

- `SESSION-001`：Provider 前已保存 user、Skill system message 和 running Turn；
- `SESSION-002`：source 只接受正确 kind/name/scope/userMessageIndex；
- `SESSION-003`：退出恢复后可重建当时正文；
- `SESSION-004`：source 不含路径、rank 或遮蔽候选；
- `SESSION-005`：初始保存失败全部回滚，Provider 调用为零；
- `SESSION-006`：Provider 失败后消息保留，Turn failed，后续不重放；
- `SESSION-007`：v1-v5 无 source Session 兼容。

## 3. 上下文

- `CONTEXT-001`：当前请求包含一次正文，位于 Runtime 安全策略之下；
- `CONTEXT-002`：第二个普通 Turn 不含旧正文；
- `CONTEXT-003`：直接 invocation 后不重复调用同名 `skill`；
- `CONTEXT-004`：compaction 不复制正文；
- `CONTEXT-005`：恢复后新 Turn 不重放，重新 `/skill` 才读取当前正文。

## 4. Agent Loop

- `LOOP-001`：direct context → read_text_file → response_end，无 `skill` Tool Call；
- `LOOP-002`：正文变化时新调用读取当前正文，name/policy 变化则 unavailable；
- `LOOP-003`：direct invocation 不占 Tool round；
- `LOOP-004`：不自动修改 TaskState。

## 5. Approval 与安全

- `SAFE-001`：写操作仍发 Approval，批准前文件不变；
- `SAFE-002`：never 策略仍 PERMISSION_DENIED；
- `SAFE-003`：workspace 外访问仍被 Sandbox 拒绝；
- `SAFE-004`：未读编辑仍 FILE_NOT_OBSERVED；
- `SAFE-005`：正文不能覆盖系统规则、schema 或 permission preset；
- `SAFE-006`：CLI/NDJSON/diagnostics/Session Query 不输出正文、路径或秘密。

## 6. 取消与并发

- `CANCEL-001`：加载前取消不创建 Turn；
- `CANCEL-002`：Provider 中取消不提交 assistant，Turn cancelled；
- `CANCEL-003`：Tool 中取消不继续模型步骤；
- `CANCEL-004`：已有活动 Turn 时拒绝第二个调用；
- `CANCEL-005`：NDJSON 断开取消并拒绝等待中的 Approval/Question。

## 7. NDJSON

- `PROTOCOL-001`：只接受 id/name/text，拒绝 content/path/workspace/source/permission；
- `PROTOCOL-002`：成功事件顺序与 prompt 一致且不回显正文；
- `PROTOCOL-003`：未知、禁用、失效、超限和读取失败返回稳定错误；
- `PROTOCOL-004`：重复 ID 不重复执行；
- `PROTOCOL-005`：Session 切换后按新 Catalog 校验。

## 8. 回归门禁

必须通过 typecheck、全量测试、build、pack check、audit 和 diff check。重点回归普通 prompt、模型 `skill` Tool、Session v1-v5、compaction、TaskState、Session Query、Approval、Sandbox、CLI、NDJSON 和 Provider 离线适配。
