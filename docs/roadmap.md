# Isla Roadmap

Isla 的目标是成为长期运行、贴合个人习惯的 Agent Runtime，不是通用 Agent 平台。Roadmap 只记录仍有意义的方向，不再为每个小版本复制设计、实施和测试模板。

## 当前能力

- TypeScript + Node.js 24 单包 Runtime。
- OpenAI、DeepSeek、Bailian 和 OpenAI-compatible Local Provider。
- 持久 Session、Memory、Agent Loop、Tool、Capability、MCP、Browser 和 Web 能力。
- Resident Host 持有长期 Runtime；CLI 是 Host 客户端。
- `isla <问题>` 恢复当前 workspace 最近会话；`--new` 创建新会话。
- 远程交互 CLI 可实时显示模型文本、安全 Tool 阶段，执行远程 Approval/User Question，并按 `sessionId + turnId` 精确取消。
- `/sessions`、`/memory`、`/trace`、`/context` 由 Host 提供有界查询；CLI 不直接读取 Host 持久化数据。
- Resource Service 独立处理下载、归档、整理和可选 Worker 推理。
- Linux systemd user service 管理 Host 与 Resource。

## 近期

1. 在 Linux x64/N100 实机验证安装、systemd、linger、重启恢复和日志。
2. 验证 Host 与 Resource 长期运行时的资源占用、数据库恢复和失败降级。
3. 在 Linux x64/N100 实机验证远程交互 CLI 与多 Session 切换。
4. 建立公开 npm 发布前的版本、打包和跨平台门禁。

## 中期

- 让 Resource 成为主 Agent 可显式调用的受控能力，同时保持独立 Job 生命周期（v0.6.0）。
- 根据真实个人使用场景扩展长期任务、提醒和后台执行，而不是预建通用 Workflow 平台。
- 改进 Memory 的个人偏好提取、修订、来源和可解释检索。
- 完成 macOS ARM64 常驻服务与跨设备配置迁移验证。

## 暂缓

- 多租户、公网 Host、通用 SaaS 控制台。
- Subagent/Agent Team、复杂 Workflow、插件市场和在线代码安装。
- Session 内无边界动态切换 Provider/模型。
- 在没有真实瓶颈前引入事件溯源、分布式调度或多包 monorepo。
