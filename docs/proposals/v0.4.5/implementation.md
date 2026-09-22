# v0.4.5 实施步骤

## Batch A：Host 生命周期

提取 Resident Host 装配，复用现有 ApplicationContext/SessionFactory；实现单实例锁、ready、graceful shutdown。

## Batch B：本机 API

实现 loopback HTTP、token 认证和最小 Session API；请求/响应复用 NDJSON 稳定类型而非复制业务逻辑。

## Batch C：事件与取消

增加 SSE 或 NDJSON stream，处理断线、重连、重复 id、活动回合和 shutdown 收敛。

## Batch D：CLI Client

提供显式连接常驻 Host 的 CLI 模式；默认本地 CLI 行为不变。证明两种入口对同一 Session 事实等价。

## Batch E：服务与真实评估

提供 systemd/LaunchAgent 模板和安装说明；完成当前平台长时间运行、重启恢复、并发 Session、取消和资源清理评估。
