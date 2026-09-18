# Isla v0.3.8 规划入口

状态：规划中，尚未实施。

## 优先方向

### 1. 真实 PTY 与交互评估基础设施

补齐跨 Windows/macOS/Linux 的 PTY 测试驱动，使 `/skill`、取消、Approval 和 `/new` 能在真实交互终端自动验证。PTY 只作为测试与 CLI 适配层，不进入 Runtime 核心。

### 2. Skill 调用测试与恢复补强

增加直接 Skill 调用的持久化、恢复、失败、取消和安全负向测试，特别是压缩后不重复注入正文、旧正文不进入后续 Turn，以及消息 source 损坏时的拒绝策略。

### 3. NDJSON `task_get` 与恢复摘要收口

在不引入任务树或后台 Job 的前提下，补齐协议侧任务状态/恢复摘要的一致性，明确字段版本、截断边界和敏感信息过滤。

### 4. Provider/模型切换的评估工具化

让真实评估从 Config/Profile 选择 Provider 和模型，输出脱敏的轨迹摘要，并支持 Bailian、DeepSeek 和本地 OpenAI-compatible 服务；不记录 Key、正文或完整模型回答。

## 暂不做

- 任务树、并行任务、后台 Job、持久终端；
- 远程 Skill、Skill 脚本执行器或动态 watcher；
- 通用 Workflow/Planner；
- package 版本升级和发布流程（单独发布步骤处理）。

## 建议实施顺序

先做 PTY 测试驱动和 Skill 回归矩阵，再收口 `task_get` 协议摘要，最后工具化多 Provider 真实评估。每批保持可独立验证，不改变 Session/Approval/Sandbox 核心边界。
