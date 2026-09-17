# Isla v0.3.0 当前评估结论

更新时间：2026-09-16

## 当前状态

v0.3.0 已实现并完成基线收口。当前 package 版本仍为 v0.2.9，版本号升级不属于本次收口。

已实现：Bailian 普通文本、one-shot Tool Calling、可选普通文本 native streaming、模型目录分页与安全投影、本地成功缓存和 stale 回退、TTY `/models`、`--models`、NDJSON `models_list/models_use/model_changed`。

本次设计阶段只核实了百炼官方接口：

- 百炼是同时托管 Qwen 与第三方模型的平台，Provider 应按平台命名；
- OpenAI-compatible Chat Completions 可作为最低迁移成本的文本和 Function Calling 路径；
- `GET /api/v1/models` 可返回分页模型目录、模型作者、推理服务商、capabilities、features、上下文和价格信息；
- 地域、API Key、Base URL 与模型可用范围相关，不能静默混用；
- 不同模型族的 Tool Calling 参数与历史回传可能存在差异，不能由通用模型目录字段替代协议验证。

## 当前验证基线

2026-09-15 本次收口重新验证：71 个测试文件通过、4 个真实 smoke 文件跳过，312 passed、6 skipped；typecheck、build 和 `pack:check` 通过。发布包为 `@winc159/isla@0.2.9`，共 179 个文件。

此前经用户授权、使用本地 Bailian Profile 完成了普通文本、模型目录、NDJSON 多轮上下文和只读 Tool Calling 真实验证。本次收口没有重新访问真实 Provider。

## 尚未允许的声明

基于当前实现与验证，仍不得声称：

- Bailian 目录中的任意模型都支持 Isla Tool Loop；
- Bailian streaming Tool Calls 可用；
- 所有百炼模型共享相同 Tool、thinking 或 history 协议；
- 每个模型都具有固定免费额度。

## 下一评估停点

1. v0.3.4.1 修改后验证状态的跨 Turn、恢复和真实状态转换；
2. Bailian `qwen-plus`、`qwen3.7-plus` 精确 Tool Calling 白名单与未知模型关闭行为；
3. 不含私人内容的 Memory 持久化写入、重启与召回真实端到端验证；
4. 只有官方协议和真实回归都稳定后，才评估 streaming Tool Calls。

## v0.3.3 第一梯队工具结论

已验证静态 Capability 组合不会改变现有 Tool Runtime 权限边界。`glob_project` 与 `grep_project` 使用随包分发的 ripgrep 二进制、直接 argv、工作区沙箱和有界输出；`ask_user_question` 在 TTY 与 NDJSON 中都能暂停当前 Tool Call，回答后继续同一 Turn。

2026-09-16 经用户授权使用本地 Bailian Profile 与 qwen-plus 完成真实回归：模型主动完成 glob、grep 和用户提问三个 Tool Call；问题回答后存在下一模型 Step 和唯一 `response_end`。本次全量基线为 341 passed、6 skipped，typecheck、build、pack dry-run 与 diff check 通过。

真实评估不得保存 API Key、Authorization、Workspace ID、完整 Provider payload、完整模型目录或私人会话正文。

## v0.3.4 授权评估

2026-09-17 用户授权执行一次真实 DeepSeek smoke。请求实际发出，但服务端返回 HTTP 402 `Insufficient Balance`；未继续重试或切换 Provider，避免重复费用。该结果只证明错误归一化路径被触发，不证明真实模型回答能力。

同日完成本地命令执行闭环验证：`run_command` 的 runner、PowerShell/Bash 适配、Approval 拒绝、Workspace 校验、取消、非零退出和输出截断专项测试通过；未保存命令完整输出或任何凭据。

随后切换到 Config 中的 `bailian` Profile，以 NDJSON 发起一次最小 Qwen 真实评估：`ready` 确认 provider=`bailian`、model=`qwen3.7-plus`，收到唯一 `response_end`，回答非空且为预期探针文本 `qwen-real-ok`；未保存回答正文。

同日完成 v0.3.4 真实闭环评估：在临时 fixture 中，Qwen 先调用两次 `read_text_file`，再调用 `edit_text_file` 将 `actual.txt` 修改为目标内容，随后调用 `run_command` 执行 `node check.mjs`。写入和命令执行均触发并批准了独立 Approval，两个 Tool Result 均成功，最终 `response_end` 非空；独立读取 fixture 确认内容为 `passed`。临时 fixture、完整命令输出和会话正文均已清理。
