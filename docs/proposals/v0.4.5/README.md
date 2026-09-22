# v0.4.5：Resident Host and Second Surface

状态：服务化核心与自动化验收通过，已完成当前版本验收

## 目标

证明 Isla Runtime 可以脱离单次前台 CLI 常驻运行，并由第二个受控入口创建、恢复、取消和观察 Session。首选本机 loopback HTTP + NDJSON/SSE 入口，CLI 继续作为兼容入口。

## 范围

- 单实例 Resident Host 与明确生命周期。
- 仅 loopback 的认证 API。
- Session create/list/resume/prompt/cancel/status。
- 流式观察与断线重连的有界语义。
- macOS LaunchAgent、Linux systemd 文档与脚本；Windows 开发运行说明。

## 非目标

不做公网服务、多人账号、Web UI、消息平台机器人、分布式 Agent、Webhook 自动执行、高可用、后台 Job 调度或云端托管。

文档入口：[设计](design.md) · [实施](implementation.md) · [测试](testing.md) · [验收](evaluation.md)
