# v0.4.4 实施步骤

## Batch A：Executor 与规范化

实现跨平台 spawn Adapter、输出限制、timeout、取消和进程树清理，不先暴露给模型。

## Batch B：Policy 与 Approval

实现命令分类、cwd/workspace 边界、env 白名单和三档策略；测试危险命令不可通过字符串伪装绕过。

## Batch C：Tool

增加单一 `run_command` Tool，schema 只接收 executable、argv、cwd 和 timeout；接入 CapabilitySnapshot、Journal 和 Completion Gate。

## Batch D：Surface 与诊断

增加 `/exec check` 或等价只读诊断，明确当前平台、策略和限制；NDJSON Tool 事件不泄露敏感 env。

## Batch E：真实验收

在当前平台验证只读命令、workspace 写入、拒绝、timeout、Ctrl+C、Unicode/空格路径和无孤儿进程；其他平台作为发布环境矩阵。
