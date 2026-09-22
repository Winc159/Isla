# v0.4.5 测试设计

- HOST-01 只绑定 loopback，非 loopback 配置默认拒绝。
- HOST-02 无/错 token 无法读取或写入私人 Session。
- HOST-03 单实例锁和 stale lock 恢复稳定。
- HOST-04 同 Session 单活动回合，不同 Session 受全局上限控制。
- HOST-05 CLI 与 HTTP 使用同一 SessionFactory 和 CapabilitySnapshot。
- HOST-06 断线不丢终态，重连可查询。
- HOST-07 cancel 只影响目标回合。
- HOST-08 shutdown 停止接收、取消活动并关闭 MCP/Memory/文件句柄。
- HOST-09 重启后 Session 可恢复，live observation 不伪装成持久事实。
- HOST-10 日志不含 token、私人正文和 Tool 参数。
- HOST-11 systemd/LaunchAgent 模板不包含 secret。
- HOST-12 tarball 安装路径不依赖源码目录。

真实评估：常驻至少一个有 MCP 的 Session，另一 Client 连接、发送、取消、断开、重连并恢复；检查无孤儿进程。

阻断：远程默认暴露、认证绕过、双写 Session、shutdown 泄漏或入口装配分叉。
