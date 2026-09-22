# v0.4.5 设计

## 1. Host 边界

Resident Host 只负责启动事实、Session 路由、资源所有权和 Surface；Provider、Agent Loop、Tool、Skill、MCP、Approval 仍复用同一 Application/SessionFactory。

## 2. API

最小 API：health、capabilities、sessions list/create/open、prompt、cancel、events。写操作要求本机 bearer token；只监听显式 loopback 地址；禁止 `0.0.0.0` 默认值。

## 3. 并发

每个 Session 最多一个活动回合；不同 Session 可并发，但设置全局上限。重复 request id 幂等拒绝；取消只作用于目标活动回合。进程关闭先停止接收，再取消并等待资源收敛。

## 4. 事件

持久事实仍来自 Session/Journal，HTTP/SSE 只传 live observation 和可重新查询的终态。断线不取消任务，除非请求显式声明 disconnect-cancels；首版默认不断开即取消。

## 5. 服务安装

服务文件只传明确 config/profile/workspace，不复制 API Key；日志不得包含私人对话和 Tool 原始参数。安装/卸载脚本必须幂等且不自动启用远程监听。

## 6. 偏离条件

若需要多用户、远程认证、队列、Job、Webhook 或 Web UI，停止并建立独立版本设计。
