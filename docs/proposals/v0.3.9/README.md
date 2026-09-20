# Isla v0.3.9：3.x 收口与 4.0 准入

状态：已实施核心收口，离线门禁已验证；真实 Provider 与非 Windows 平台仍按矩阵保留未验证标记。

## 目标

v0.3.9 不新增用户能力，专门把 v0.3.x 已实现的能力、契约、测试、文档和发布边界统一起来，形成可以长期维护的 3.x 基线，并定义进入 4.0 前必须满足的准入条件。

3.x 当前已覆盖：

- Profile/Config 配置事实源与多 Provider；
- Tool、Approval、Sandbox、read-before-edit、验证完成门禁和取消；
- TaskState、Session 恢复、workspace 隔离与 Session Discovery；
- Skill Tool 与用户显式 `/skill` 调用；
- TTY CLI、NDJSON 和真实 PTY 回归；
- Bailian 模型目录、Qwen Tool Loop 与普通文本 streaming；
- Memory、Project Search、Web Fetch、命令执行和修改后验证。

## 3.9 只做什么

1. 建立 3.x 能力与契约清单，区分稳定、实验、兼容和明确暂缓；
2. 统一 CLI/NDJSON/TTY/PTY 的语义、错误、取消和能力报告；
3. 清除 package 版本、README、roadmap、current 文档与实现之间的陈旧声明；
4. 固定 Session/Journal/Message source/Profile/Tool permission 的兼容边界和迁移策略；
5. 完成离线、真实 Provider、PTY、隐私、打包和跨平台验证矩阵；
6. 记录 DSH 只被采用的设计不变量，避免 4.0 复制其框架规模。

## 3.9 明确不做

- 不新增 Agent Registry、Inbox、Job、Workflow、Subagent、并行 Tool 或 steering；
- 不引入完整事件溯源 Session、通用事件总线、Cordis 或 monorepo package seam；
- 不为尚未出现的长上下文问题预建 Context Budget、Compaction 或 token meter；
- 不把 PTY 测试层带入 Runtime 核心或生产依赖；
- 不在 3.9 中升级 4.0 版本号或发布 npm 包；
- 不以“文档收口”掩盖未验证的平台、Provider 或安全边界。

## 4.0 进入条件

只有 v0.3.9 的收口门禁全部通过，并且出现至少一个真实需求触发新的核心抽象，才进入 4.0 设计。4.0 的具体主题暂不预设；候选方向包括有界长上下文/压缩、跨入口长期运行资源或更严格的 Provider/model capability contract，但必须重新讨论并形成独立提案。

## 文档

- [设计](./design.md)
- [实施顺序](./implementation.md)
- [测试与收口门禁](./testing.md)
