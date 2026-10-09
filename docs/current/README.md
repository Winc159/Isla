# Isla 当前文档

本目录描述 `0.4.9` 的当前有效事实；本版本未改变 v0.4.8 Runtime 行为。历史设计过程保存在 [`../proposals/`](../proposals/)，已被替代但仍有复盘价值的资料保存在 [`../archive/`](../archive/)。

建议按以下顺序阅读：

1. [`../../README.md`](../../README.md)：产品定位、安装、运行和用户入口。
2. [`architecture.md`](architecture.md)：当前架构、模块边界和完整执行链路。
3. [`implementation.md`](implementation.md)：源码导航与扩展入口。
4. [`testing.md`](testing.md)：测试分层、真实评估边界和发布门禁。
5. [`decisions.md`](decisions.md)：已经稳定形成的架构决策。
6. [`../roadmap.md`](../roadmap.md)：版本历史与后续方向。

v0.4.8 的设计、实施和脱敏验收记录见 [`../proposals/v0.4.8/`](../proposals/v0.4.8/README.md)。v0.4.9 的文档审计与收口记录见 [`../proposals/v0.4.9/`](../proposals/v0.4.9/README.md)。这些 proposal 记录为什么这样设计，但不能替代本目录对当前代码的描述。

## 文档事实优先级

当描述不一致时，按以下顺序处理：

1. 当前源码、测试和 `package.json`；
2. 本目录；
3. 已完成版本的 proposal 与脱敏评估；
4. archive 中的历史资料。

发现源码与本文档不一致时，应先记录差异。若修正文档即可反映既有行为，更新文档；若需要改变核心契约或 Runtime 行为，必须先提出设计问题。

## 隐私边界

原始 Provider 对话、JSON/NDJSON transcript、Profile、凭据和私人会话不得进入文档或 Git。允许公开的评估材料只能保存脱敏后的场景、判定与必要证据。原始本地评估资料统一放在被忽略的 `.isla-local/evaluations/`。
