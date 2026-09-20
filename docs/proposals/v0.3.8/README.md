# Isla v0.3.8 PTY 测试驱动

状态：已实施；Windows 当前环境验证通过，macOS ARM64 与 Linux x64 尚未在本轮执行。

## 本版目标

v0.3.8 只增加跨平台 PTY 测试驱动，把 Isla 真实交互终端行为变成可重复、可自动断言的离线回归测试。

首批覆盖：

- `/skills` 列表与 `/skills <name>` 预览；
- `/skill <name> [request]` 的真实交互调用；
- `/new` 新建隔离 Session；
- 生成期间 Ctrl+C 取消并恢复输入；
- 空闲输入期间 Esc 退出；
- Approval 的批准、拒绝与 Esc 拒绝；
- `/exit` 正常退出及子进程清理。

PTY 只进入 `tests/` 和开发依赖，不进入 Runtime 核心、生产依赖或发布包。离线测试使用本机临时目录与本地假 OpenAI-compatible 服务，不访问 Bailian、DeepSeek 或其他真实 Provider。

## 文档

- [设计](./design.md)
- [实施顺序](./implementation.md)
- [测试计划](./testing.md)
- [实施评估](./evaluation.md)

## 本版不做

- 不改变 CLI 命令语义；
- 不把 Esc 扩展为生成中取消；当前契约是生成中 Ctrl+C 取消、空闲 Esc 退出、Approval 中 Esc 拒绝；
- 不修改 Agent Loop、Session、Approval、Sandbox 或取消核心；
- 不增加测试专用生产 Provider、隐藏 CLI 参数或 Runtime 后门；
- 不运行真实 Provider 评估；
- 不实施 `task_get`、恢复摘要、Provider 评估工具化或 Skill 恢复补强；这些进入后续独立版本；
- 不升级 package 版本，不执行发布流程。

## 完成定义

1. Windows 已通过同一测试 API 驱动真实 PTY；macOS ARM64、Linux x64 的同一 API 设计已完成但本轮未验证；
2. 子进程中的 `stdin.isTTY` 为 true，实际执行构建后的 `dist/cli.js`；
3. 首批交互矩阵全部由离线自动测试覆盖；
4. 失败时输出脱敏、限长的终端轨迹，并保证子进程、服务和临时目录被清理；
5. 原有 CLI 单元测试、NDJSON 测试与全量离线门禁无回归。
