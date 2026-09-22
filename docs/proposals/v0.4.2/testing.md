# v0.4.2 测试设计

## P0 目录与安全

- CAP-01 三类能力具有稳定、无冲突 id。
- CAP-02 目录不包含 env、command、cwd、参数值、Skill 正文。
- CAP-03 unavailable 能力保留安全诊断但不进入模型 Tool schema。
- CAP-04 排序在重启和 Surface 间稳定。

## P0 策略与预算

- CAP-05 未配置策略保持 4.1 行为。
- CAP-06 allow/deny 按名称和 Server 生效，deny 优先。
- CAP-07 未知策略项只产生诊断。
- CAP-08 Tool 数、schema 字节和 Skill 字符预算边界精确。
- CAP-09 超限不暴露部分 generation。

## P0 Snapshot/Surface

- CAP-10 请求开始后配置文件变化不改变当前 Snapshot。
- CAP-11 Snapshot hash 不含 secret 且不进入模型正文。
- CAP-12 TTY 与 NDJSON 返回相同安全事实。
- CAP-13 模型不能调用配置写入口。

## 真实评估

使用官方 Filesystem MCP 与合成 Skill 验证：只允许读工具、禁用写工具、模型请求实际 schema 与目录一致、重启后策略生效。

发布阻断：秘密泄漏、策略绕过、静默 schema 截断、Snapshot 不可重建或未配置 Profile 回归。
