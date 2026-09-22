# v0.4.4 测试设计

- EXEC-01 executable 与 argv 边界不经过 shell。
- EXEC-02 cwd 不能逃出授权 workspace。
- EXEC-03 env 不继承 API Key/token/cookie。
- EXEC-04 stdout/stderr 分离并受字节预算限制。
- EXEC-05 timeout、AbortSignal 和进程退出只有一个终态。
- EXEC-06 子进程树无孤儿。
- EXEC-07 readonly 不产生写入。
- EXEC-08 workspace-write 必须 Approval。
- EXEC-09 拒绝后进程未启动。
- EXEC-10 危险命令在 full 下仍按硬规则处理。
- EXEC-11 空格、Unicode 和 Windows/POSIX 路径正确。
- EXEC-12 Session/Journal 不保存秘密或无限输出。

真实评估必须使用隔离临时 workspace，不操作用户 home、Git 历史或系统配置。

阻断：shell 注入、workspace 逃逸、凭据继承、取消后残留进程或 Approval 绕过。
