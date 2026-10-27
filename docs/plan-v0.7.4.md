# Isla v0.7.4：Plan Progress、Bounded Replan 与 Checkpoint Diff

## 设计目标

补齐 v0.7.3 的工作闭环：Plan 不再只是已批准的静态步骤列表；Runtime 持久记录每一步的进度和可核验证据，工具反复失败时可在有限次数内回到 Plan 模式重规划；重规划必须重新获批。Checkpoint 预览提供有界、脱敏的人类可读文本差异，并能在 Session 恢复后继续查询。

本版本不改 Resource 服务、不增加通用 Job/Subagent，不自动恢复工作区，不允许模型自行批准重规划。

## 设计契约

### 1. Plan 结构与进度分离

- `revision` 仅表示目标、约束、假设、步骤拓扑、风险或验证标准等结构性计划版本；结构变化使旧批准失效。
- 新增 `progressRevision` 和每步的短证据引用。进度状态更新不增加结构 `revision`，不撤销对同一结构的批准。
- 进度更新仅允许单向转换：`pending → in_progress|completed|blocked`、`in_progress → completed|blocked`；已完成步骤不可直接重置，必须先创建新的结构 revision。直接完成仍需满足真实工具证据和依赖门禁，避免无价值的额外状态调用。
- `completed` 必须引用当前 Session journal 中成功的 Tool Call ID；验证步骤还必须引用成功的 `purpose=verification` 结果。依赖未完成时不得启动或完成后续步骤。
- 所有新字段可缺省迁移旧 Session；恢复后批准 revision、步骤进度和证据引用保持一致。

### 2. 有界局部重规划

- 对同一执行动作的连续失败达到 Runtime 现有重试上限，或模型通过 `propose_replan` 明确提出替代方案时，Runtime 可进入 Plan 模式并持久标记阻塞原因。
- 每个 Work Plan 最多接受两次结构性重规划；达到上限后明确阻塞并说明需要用户介入，不继续自动循环。
- 新 Plan 必须通过现有 schema/dependency 校验，递增 `revision` 并清除 `approvedRevision`/Act 批准状态。
- 重规划只生成待用户批准的方案，不自动执行工具；用户批准新 revision 后才能重新进入 Act。
- 普通一次性工具失败仍可以在现有 Loop Budget 内修复，不强制重规划。

### 3. Checkpoint Diff 与恢复安全

- `preview` 返回 restore/remove 路径及有界 unified text hunks；超大/二进制/敏感内容只显示路径和省略原因，不返回文件内容。
- Diff 只比较 Checkpoint 中已有的安全文本快照与当前 Workspace 文件；不把 Resource、忽略文件、秘密、Checkpoint 存储目录或 Workspace 外路径纳入结果。
- 每份 diff 和整个响应都有上限；超过上限时以明确的截断标记返回，不静默省略。
- CLI 与远程 CLI 用相同结构展示差异。`restore-confirm` 仍为显式破坏性确认；不恢复 Git index，不执行 `git reset`。

## 实施步骤

1. 扩展 WorkPlan schema：进度 revision、证据引用、重规划计数；实现旧版本规范化和转换合法性校验。
2. 在 ToolRuntime/ChatSession 将成功 Tool Call、Workspace mutation 和 verification 结果写入可验证 journal 证据；实现 Act 下仅改进度、不改结构的受限更新。
3. 将完成门禁接入 Plan：拒绝未完成步骤、缺少证据的完成状态、依赖未满足的状态转换；确保报告结论不能越过 Runtime 进度状态。
4. 实现有界重规划状态机：失败触发/提案、模式回退、次数限制、新 revision 批准门禁及持久化恢复。
5. 为 Checkpoint 生成脱敏、有界 unified diff；统一本地与远程 CLI 输出，并保留路径、二进制、秘密和大小限制。
6. 添加 Session Store/Runtime 重启测试，证明 Plan revision、progressRevision、批准状态、step evidence、重规划计数及 Checkpoint 可在恢复后读取。
7. 执行全量类型检查、自动测试、生产构建和真实多步骤对话验收；修复失败后全量复跑。

## 自动测试与验收目标

### WorkPlan

- 结构变更递增 `revision` 并撤销批准；进度变更只递增 `progressRevision` 并保留当前批准。
- 进度不可倒退/跳级，依赖未完成时不能开始后续步骤。
- 伪造、失败、未知 Session 或跨 Session 的 Tool Call ID 不能作为完成证据。
- 验证步骤必须引用成功 verification 事件；失败验证不能完成步骤。
- Session schema 旧版本迁移；保存、关闭、恢复后所有状态精确一致。

### Replan

- 工具失败达到既有重试阈值后最多回到 Plan 并产生一次待批准 revision；批准前工具不可执行。
- `propose_replan` 不能直接执行或完成；修订必须满足 schema、拓扑和 revision 校验。
- 第三次重规划被 Runtime 拒绝并形成明确 blocked 状态；重启后限额不重置。
- 失败后修复验证通过不触发不必要重规划；不同错误签名不会错误合并。

### Checkpoint

- 修改/新增/删除内容显示正确的有界差异与文件状态；内容为秘密、二进制或超限时仅返回路径和省略原因。
- `.git`、`.isla-local/checkpoints`、Resource、被忽略路径、符号链接和 Workspace 外部文件不泄漏或被恢复覆盖。
- 本地及远程 CLI 均能读懂差异；预览不修改文件，未经独立确认的恢复被拒绝。
- 恢复不修改 Git index；被排除的二进制/超限/敏感文件保留原状。

### 真实多步骤对话及严格评分

使用临时真实 Workspace，其中至少包含两个可验证步骤（诊断并修复缺陷、运行测试并审阅差异），完整经历 Plan、用户批准、Act、至少两步进度与证据、验证、Review 和 Session 关闭/重新载入。

评分为 10 个二元门槛，每项 10 分：

1. 初始 Plan 对齐任务且持久化；
2. Act 只能通过显式批准的结构 revision 进入；
3. 步骤进度与成功 Tool Call 证据一致；
4. 依赖/进度门禁拒绝越序或无证据完成；
5. Plan、批准与步骤状态在 Session 恢复后不丢失；
6. Checkpoint 在跨步修改前创建且重启后可查询；
7. Diff 能显示真实文本变化并对秘密/二进制/超限内容脱敏；
8. 修复步骤以成功写入证据完成，且目标文件实际符合修复预期；
9. Review 中运行的验证真实通过且最终结果与证据一致；
10. 无秘密输出、越界修改或 Resource 数据访问。

及格线：**10/10（100 分）**。任何安全边界、未经批准执行、状态恢复、步骤证据或最终验证项失败均直接判不及格。模型 Provider 若不可用，自动测试仍必须通过；真实验收记为未完成，不得以模拟响应替代。

## 本次实施记录

### 实施与验收记录（2026-10-27）

- 已实现步骤 1–6：Plan 进度与结构 revision 分离、按 step ID 更新并验证真实 Session journal 证据、受限重规划、Checkpoint unified diff/脱敏/上限、本地与远程展示，以及持久化与门禁测试。
- 自动验收：最终 `node scripts/verify.mjs` 通过；类型检查、Runtime 构建、173 个测试文件通过（7 个跳过）、712 项测试通过（13 项跳过）、Resource UI 生产构建通过。
- 已按用户要求将本机 `bailian` Profile 模型切换为 `qwen-plus-2025-12-01`，保留 API Key 与其他配置；本机模型切换本身不纳入 Git。
- 真实多步骤对话：最终严格评分 **100/100**。Plan 持久化与显式批准、成功 Tool Call 证据、跨进程恢复、change 步骤与实际源码修复、Checkpoint 差异和秘密脱敏、真实 `node --test` 通过、Review 与最终结论一致、无秘密或越界修改全部通过。验收在提升权限的 Node 24 运行环境完成；两个 Session 进程间增加了 45 秒冷却，以适应 Provider 限流。
- 最终全量自动验收：`node scripts/verify.mjs` 通过；173 个测试文件通过（7 个跳过）、712 项测试通过（13 个跳过），Runtime 与 Resource UI 构建成功。
- 测试入口：`node validation/run-v074-dialogue.mjs`（要求 Node.js 24；Windows 提升权限环境需明确选择 Node 24 可执行文件，避免 PATH 中旧版 Node）。
- 已知环境问题：当前直接使用 `node --import tsx --test ...` 在 Windows 启动时遇到 `uv_os_get_passwd returned ENOMEM`；项目自带 `scripts/verify.mjs` 清洁验证正常通过。
- 验收期间曾遇到模型鉴权/限流、受限执行环境 `spawn EPERM`、管理员 PATH 旧版 Node 和临时 fixture 的 ESM 加载问题；均已排除，不再阻塞验收。
