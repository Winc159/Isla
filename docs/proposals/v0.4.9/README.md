# v0.4.9：文档与架构收口

## 目标

以 v0.4.8 实际源码为事实源，建立可长期维护的当前架构入口，分离当前事实、历史提案、公开评估与本地原始日志。

## 范围

- 审计 README、docs、src、tests、scripts、package 与 CI；
- 重写 `docs/current/` 的架构、实现、测试和决策入口；
- 归档已被替代的 v0.3.x current 专题；
- 修复 README、current、roadmap 与历史资料导航；
- 验证链接、路径、脚本、版本、秘密、日志、构建、测试与打包内容。

本版本不新增 Runtime 功能、不改变核心契约、不引入 Provider 或框架，也不执行 Git commit/push。

## 文档

- [`audit.md`](audit.md)：清单、分类和代码/文档差异。
- [`implementation.md`](implementation.md)：实际执行记录。
- [`testing.md`](testing.md)：验收方法与最终结果。
- [`../../current/architecture.md`](../../current/architecture.md)：收口后的权威架构入口。

## 完成定义

`docs/current/` 与 v0.4.8 代码一致；历史资料不再冒充当前事实；文档和源码链接有效；仓库文档不含原始私人评估日志或秘密；标准验证通过后版本调整为 `0.4.9`。
