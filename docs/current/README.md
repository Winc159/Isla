# Isla v0.3.0 当前文档入口

当前设计基线为 v0.3.0（Bailian Provider and Model Discovery），只以本目录为准：

- [architecture.md](./architecture.md)：v0.3.0 架构、边界与硬不变量
- [implementation.md](./implementation.md)：Batch A-D 的实施顺序和停点
- [testing.md](./testing.md)：离线测试矩阵、真实评估条件与门禁
- [evaluation.md](./evaluation.md)：当前已验证事实与尚未验证声明
- [decisions.md](./decisions.md)：已确认取舍与重新评估条件

状态：v0.3.0 Batch A 已实现，Batch B 模型目录客户端已实现，目录 CLI/缓存与后续 Batch 尚未完成。当前 package 版本仍为 v0.2.9；进入每个 Batch 前必须保持上一基线可运行。

v0.3.0 按以下顺序推进：

1. Batch A：`bailian` 平台文本接入与配置事实源收敛；
2. Batch B：官方模型目录发现；
3. Batch C：首个经验证的 Qwen one-shot Tool Calling；
4. Batch D：仅在官方 fixture 与真实回归通过后评估原生 streaming。

本版不为每个模型新增 Provider。Provider 表示平台与协议适配，模型 ID 和模型族兼容差异分别属于启动配置与窄模型策略。
