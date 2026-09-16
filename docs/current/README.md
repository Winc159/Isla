# Isla v0.3.2 当前文档入口

当前设计基线为 v0.3.2：沿用 v0.3.0 Bailian Provider and Model Discovery 文档，并加入安全精确编辑扩展。只以本目录为准：

- [architecture.md](./architecture.md)：v0.3.0 架构、边界与硬不变量
- [implementation.md](./implementation.md)：Batch A-D 的实施顺序和停点
- [testing.md](./testing.md)：离线测试矩阵、真实评估条件与门禁
- [evaluation.md](./evaluation.md)：当前已验证事实与尚未验证声明
- [decisions.md](./decisions.md)：已确认取舍与重新评估条件
- [editing-v0.3.2.md](./editing-v0.3.2.md)：v0.3.2 安全精确编辑的已确认契约与完成信号
- [bounded-reading-v0.3.2.md](./bounded-reading-v0.3.2.md)：v0.3.2 有界精确读取、分页与大文件流式扫描契约

v0.3.2 在 v0.3.1 模型目录与能力收窄基线上，新增 `edit_text_file`、read-before-edit 新鲜度保护、原子替换和有界文件读取；不扩大到 Shell、MCP 或通用文件系统框架。

状态：v0.3.0 已实现并完成基线收口。当前 package 版本仍为 v0.2.9；版本号升级留给独立发布步骤。

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
