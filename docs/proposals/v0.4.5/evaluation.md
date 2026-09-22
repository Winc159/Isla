# v0.4.5 验收记录

状态：服务化核心与自动化验收通过，已完成当前版本验收

## 当前结果

- [x] ResidentHost 仅允许 `127.0.0.1`、`::1` 或 `localhost`。
- [x] health 公共只读；Session、capabilities、prompt、cancel 需要 Bearer token。
- [x] sessions list/create/open、prompt、cancel 最小 API 已实现。
- [x] `/sessions/:id/events` 提供受保护的 SSE 终态事件，断线后可通过 Session 查询恢复事实。
- [x] shutdown 会取消并等待活动回合，重复 close 幂等。
- [x] 单实例 `lockPath` 防止重复 Host，关闭时清理 lock。
- [x] `ResidentHostClient` 提供 health/capabilities/sessions/create/prompt/cancel/events 连接入口。
- [x] systemd 与 LaunchAgent 模板不包含 token 或 API Key。
- [x] 非 loopback 绑定和错误 token 自动化测试通过。
- [x] 完整 `verify`：99 个测试文件通过，6 个跳过；427 个测试通过，8 个跳过。

## 当前边界

持续 live event fan-out 和把 Host 接入正式 CLI 启动入口属于后续产品化增强；本版已完成 loopback 服务、认证、Session API、SSE 终态、客户端、锁和服务模板的验收闭环。

- [x] Resident Host 生命周期通过。
- [x] loopback/token 安全通过。
- [x] 第二 Surface 与 Client 事实等价。
- [x] 取消、断线查询和恢复通过。
- [x] 当前平台服务评估通过。
- [x] Linux/macOS 服务模板静态检查通过。
- [x] typecheck/test/build/diff 全绿。

最终判定：v0.4.5 当前版本服务化验收通过。Linux/macOS 实机服务管理和 tarball 安装路径仍需在对应发布环境补证，不阻塞本版 Windows 核心收口。
