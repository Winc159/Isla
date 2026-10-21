# Isla v0.5.3：Goal-driven Agent Runtime

状态：设计候选，等待用户确认后由 Luna 按 Batch 实施。

版本说明：当前仓库没有 v0.5.2 proposal。开始修改版本号前，Luna 必须确认 v0.5.2 是否存在于其他分支/设备或是否被有意跳过；本提案的技术基线是当前 v0.5.1 工作区，不擅自补写 v0.5.2。

## 版本目标

v0.5.3 解决的不是某个具体问答失败，而是当前主 Agent 的三个通用瓶颈：

1. 没有稳定的任务理解与完成契约，模型容易缩小问题、遗漏子目标或过早结束；
2. Agent Loop 使用固定 Model Step 上限，长任务无法按真实进展持续执行和恢复；
3. 能力目录、动态路由和 Tool 扩展没有形成生产闭环，模型既可能看见过多无关 Schema，也可能找不到已有能力。

目标工作流：

```text
user input
  -> decision (answer | clarify | execute)
  -> persisted TaskContract
  -> per-step capability resolution
  -> model step -> guarded tool group
  -> observations + progress assessment
  -> re-plan or continue
  -> completion gate against TaskContract
  -> completed | needs_user | paused | blocked | failed
```

## 文档入口

- [`design.md`](design.md)：架构、契约、DSH 取舍和版本边界；
- [`implementation.md`](implementation.md)：Luna 必须遵循的分批实施顺序和停点；
- [`testing.md`](testing.md)：P0/P1 自动化验收矩阵与发布门禁；
- [`real-evaluation.md`](real-evaluation.md)：真实模型评估用例、执行方式和 100 分评分表。

## 版本边界

包含：

- 接回并升级现有 `TurnDecision` / `TaskState`，形成 Runtime-owned TaskContract；
- 把 v0.4.8 已实现但未接入主 Session 的动态 Capability Routing 接到每个 Model Step；
- 用进展、Tool Call、时间和失败状态管理 Loop，而不是用 12/28/40 固定步数决定任务命运；
- 对明确声明并行安全的只读 Tool Call 做有界并行，结果仍按模型顺序提交；
- 补齐跨 Provider Web Search、只读 Git 观察和安全系统观察；
- 根据任务交付物、步骤、证据和失败链判断完成；
- 建立真实 Qwen 主 Agent 评估集、基线对比和量化评分。

不包含：Subagent/Agent Team、Workflow DSL、Ralph、无限 Tool Loop、自动安装未知扩展、后台 Shell、持久 PTY、动态主模型切换、完整 Claim Verifier、复制 DSH 框架或源码。

## 发布结论

只有 P0 自动化全过、真实评估至少 85/100、各维度达标、关键失败用例没有 completed 误报、动态路由确实生产生效、并行无悬空 Tool Call/乱序/越权，且秘密未进入 Git/日志/npm 包，才能标记完成。

Luna 必须逐 Batch 执行。若需要改变 Approval/Sandbox 核心语义、引入 Subagent/Job/通用插件框架，或无法保持 Session 可重建性，必须停止并先更新设计。
