# Isla v0.3.x 当前文档入口

本目录保留 v0.3.0-v0.3.5 的稳定设计基线；v0.3.6-v0.3.8 的增量设计和评估分别位于 `docs/proposals/`。3.x 收口基线见 [v0.3.9 proposal](../proposals/v0.3.9/README.md)。

当前历史基线为 v0.3.5：沿用 v0.3.4 的安全命令执行和验证门禁，并加入任务状态、workspace 隔离与恢复。只以本目录中的对应文档为准：

- [architecture.md](./architecture.md)：v0.3.0 架构、边界与硬不变量
- [implementation.md](./implementation.md)：Batch A-D 的实施顺序和停点
- [testing.md](./testing.md)：离线测试矩阵、真实评估条件与门禁
- [evaluation.md](./evaluation.md)：当前已验证事实与尚未验证声明
- [decisions.md](./decisions.md)：已确认取舍与重新评估条件
- [editing-v0.3.2.md](./editing-v0.3.2.md)：v0.3.2 安全精确编辑的已确认契约与完成信号
- [bounded-reading-v0.3.2.md](./bounded-reading-v0.3.2.md)：v0.3.2 有界精确读取、分页与大文件流式扫描契约
- [tool-platform-v0.3.3.md](./tool-platform-v0.3.3.md)：第一梯队工具、静态组合边界与分批验证顺序
- [command-execution-v0.3.4.md](./command-execution-v0.3.4.md)：一次性前台命令执行 Tool 的契约、平台适配与安全边界
- [verification-and-bailian-capabilities-v0.3.4.1.md](./verification-and-bailian-capabilities-v0.3.4.1.md)：修改后验证状态与 Bailian Tool Calling 精确白名单收口
- [verification-completion-gate-v0.3.4.2.md](./verification-completion-gate-v0.3.4.2.md)：验证感知的完成门禁、未验证交付和协议状态投影
- [task-state-and-recovery-v0.3.5.md](./task-state-and-recovery-v0.3.5.md)：任务状态、Session v4、workspace 隔离、模型契约收口和跨重启恢复的完成记录

v0.3.3 已新增集中 Capability 组合、`glob_project`、`grep_project` 和 `ask_user_question`。v0.3.4 已接入 `run_command`，支持有界前台执行、Approval、取消和跨平台 Shell 适配。

状态：v0.3.9 已完成 3.x 核心收口；package 版本已更新为 v0.3.9，可通过 `npm pack` 生成私有分发的 `.tgz`，尚未发布到 npm Registry。Windows 验证已完成，Linux x64 与 macOS ARM64 仍需在对应目标系统验收。

当前版本进展：v0.3.6 的 Batch A-E 已实现，已完成 workspace 内 Session 发现、TTY/NDJSON 搜索选择和两个只读模型 Tool；隔离 Bailian/Qwen 已稳定完成 `search_session_history → read_session_context → response_end`。设计、实施步骤、测试矩阵和评估记录见 [`docs/proposals/v0.3.6/`](../proposals/v0.3.6/README.md)。

配置说明：正常启动使用 Config/Profile；`.env` 仅用于显式开发、CI 或迁移兼容入口，不是默认配置事实源。切换 Provider、模型或 Base URL 时优先检查当前 Profile。

v0.3.0 已按以下顺序完成：

1. Batch A：`bailian` 平台文本接入与配置事实源收敛；
2. Batch B：官方模型目录发现；
3. Batch C：首个经验证的 Qwen one-shot Tool Calling；
4. Batch D：普通文本 native streaming 已实现；带工具请求因 `streamingToolCalls=false` 保持 one-shot 回退。

当前还包括：

- TTY `/models` 查询、搜索和显式模型保存；
- `--models` 无 TTY 查询；
- NDJSON `models_list`、`models_use` 与 `model_changed`；
- 成功目录缓存以及网络失败时的 stale cache 回退；
- Bailian one-shot Tool Loop。

已知边界：Provider 和模型在一次运行中保持固定，模型保存只对下次启动生效；跨 Provider 切换、DeepSeek/OpenAI 统一模型目录、持久化 Memory 真实端到端验证、Context Budget/Compaction 和 streaming Tool Calls 尚未实现。

本版不为每个模型新增 Provider。Provider 表示平台与协议适配，模型 ID 和模型族兼容差异分别属于启动配置与窄模型策略。
