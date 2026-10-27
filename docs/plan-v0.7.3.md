# Isla v0.7.3：Plan / Act 与 Workspace Checkpoint

## 设计目标

让规划成为持久、可审阅、受权限约束的工作模式；让执行严格继承用户批准的计划，并能在失败时重规划。Checkpoint 为文件修改提供可预览和可恢复边界。

## Plan 契约

Plan 包含 `planId`、revision、goal、constraints、assumptions、steps、dependencies、risks、verification、openQuestions 和 status。每次修改产生 `plan/updated` 事件。

模式：

- `plan`：只读文件、项目搜索、Web 研究、Session/Memory 查询和安全诊断；禁止写文件、安装、外部副作用和凭据使用。
- `act`：按 Policy、Sandbox、Approval 执行计划。
- `review`：只运行验证和读取差异，不允许新增实现修改。

模式切换更新 Capability Snapshot 和权限上限。模型请求进入 Act 不能自行批准；用户显式指令或预配置可信策略才可切换。

## Checkpoint 契约

- 修改前记录 workspace 基线：Git commit/index/worktree 摘要，非 Git workspace 使用文件清单和受限内容快照。
- Checkpoint 只包含 Workspace 内变更，不包含秘密和忽略文件，除非用户显式选择。
- 支持 list、diff、restore-preview、restore。
- Restore 是破坏性操作，必须 Approval；不得用 `git reset --hard` 实现默认恢复。

## 实施步骤

1. Plan schema、store、projection 和协议 Item。
2. Mode state、Capability/Permission 上限和切换协议。
3. Planner prompt 与计划质量校验。
4. Act runner 将 Tool/Step 关联到 plan step。
5. Progress evaluator 更新步骤状态，失败触发局部 replan。
6. Git/non-Git Checkpoint Adapter。
7. CLI/Web 协议暴露计划、模式和恢复预览。

## 自动测试

- Plan revision 并发冲突、恢复和迁移。
- Plan 模式无法调用写入、命令、安装和副作用 Tool。
- Act 切换必须有新的显式批准事实。
- 模式切换后 Tool Snapshot 在下一 Step 生效。
- Step 进度、重规划次数和完成门禁一致。
- Checkpoint 路径边界、未跟踪文件、脏 index、恢复预览和取消。

## 真实验收

- 复杂模块开发：先探索并产出计划，用户批准后连续实现、测试、修复和总结。
- 注入模拟 Bug：Plan 定位假设，Act 修复，Review 验证；错误假设后自动回到 Plan。
- 中途取消并恢复 Session，Plan revision、步骤状态和 Checkpoint 保持一致。

## 完成条件

- Plan/Act 是 Runtime 权限事实而非提示词约定。
- 用户能在 CLI 和协议客户端查看、批准、修改和恢复计划。
- Workspace 恢复不覆盖范围外文件，Resource 目录不参与 Checkpoint。

## 当前实现记录

- Work Plan 独立于旧 TaskContract，Session v6 持久化 Plan 和 Mode；旧 Session 可迁移续存。
- `update_work_plan` 在 Plan 模式更新 revision；Host CLI `/plan approve` 只批准当前 revision，计划变更使 Act 批准失效。
- ToolRuntime 对 Plan/Review 的写入、命令和外部副作用实施拒绝；旧直接 ChatSession 构造保持兼容。
- Workspace Checkpoint 自动在文本文件写入前生成，排除 Git 忽略文件、凭据特征、Resource、`.git`、依赖和构建目录；CLI 支持 list / preview / 双命令确认 restore。
- Checkpoint 保存 Git HEAD、暂存区/index 与工作区路径摘要、文本快照及排除文件路径；不恢复 Git index，也不保存二进制或超大文件。恢复只作用于工作区文件，并需单独确认。
- Plan/Review 通过显式工具 allowlist 同时约束模型工具快照和执行时调用；Review 的 `run_command` 必须标注 `purpose=verification`。
- 已使用 Qwen 对含故障的 clamp fixture 完成真实对话，10 项验收全通过（100%）：Plan 持久化、显式 revision 批准、Act、写入、测试、Review、checkpoint 及无秘密输出。
- 在宣告覆盖所有原始标准前仍需评估：逐步进度自动归并/有限局部重规划，以及完整的人类可读工作区 diff UI。当前真实验收覆盖单次修复，不覆盖多步骤恢复或中断后续跑。
