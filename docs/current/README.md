# Isla v0.3.4.1 当前文档入口

当前设计基线为 v0.3.4：沿用 v0.3.3 的安全精确读写、第一梯队工具与静态组合层，并加入一次性前台命令执行。只以本目录为准：

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

v0.3.3 已新增集中 Capability 组合、`glob_project`、`grep_project` 和 `ask_user_question`。v0.3.4 已接入 `run_command`，支持有界前台执行、Approval、取消和跨平台 Shell 适配。

状态：v0.3.4 已实现并完成离线与授权真实闭环评估；v0.3.4.1 处于设计确认阶段。当前 package 版本仍为 v0.2.9；版本号升级留给独立发布步骤。

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
