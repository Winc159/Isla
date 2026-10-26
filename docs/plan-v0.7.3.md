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
