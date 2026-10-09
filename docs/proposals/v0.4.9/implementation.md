# v0.4.9 执行记录

## 已执行

1. 加载项目规则，确认禁止 Git 写操作、秘密入库和 Runtime 范围扩张。
2. 核对 Git 状态、版本、package scripts、CI、文档树、源码树、测试树和正式脚本。
3. 阅读 current、roadmap、v0.4.8 proposal 及关键装配、Session、Capability、Tool、MCP、Browser、Memory、Protocol、Sandbox 和 Approval 源码。
4. 以源码重写 current 的 README、architecture、implementation、testing 和 decisions。
5. 将被替代的 v0.3.x current 专题移动到 `docs/archive/current-v0.3/`。
6. 更新根 README 和 roadmap 的导航与状态。
7. 新增本 proposal，记录范围、审计、执行和验收。
8. 运行链接、路径、脚本、版本、日志、秘密、Git diff、verify 和 pack 验证。
9. 全部必要验证通过后，将 package/lockfile 与用户文档版本调整为 `0.4.9` 并复验。

## 未执行

- 未修改 `src/` 或 Runtime 行为；
- 未新增依赖、Provider、Tool 或配置字段；
- 未运行需要真实凭据、外部网络或费用的评估；
- 未执行 `git add`、`git commit` 或 `git push`。

## 变更原则

当前事实只在 `docs/current/` 维护一个权威入口。Proposal 保留设计过程和验收上下文，Archive 保留被替代资料，公开 evaluation 只保留脱敏证据。本地原始日志和专项脚本继续留在 `.isla-local/`。
