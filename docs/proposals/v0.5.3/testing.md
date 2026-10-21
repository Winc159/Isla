# v0.5.3 自动化验收与发布门禁

## 1. 验收目标

完成标准不是“提高步数或增加 Tool”，而是 Isla 能把请求转为可审计任务契约，在执行中发现能力，按真实进展持续工作，在安全边界内并行独立读取，并且只有满足交付物、证据和验证条件后才完成。

## 2. P0 不变量

1. 所有模型可见消息可由 Session 重建；
2. 每个 Tool Call 最终恰有一个 Result；
3. 未批准动作不执行；
4. TaskContract 不保存思维链和秘密；
5. 实际 Tool Schema 与 Capability Snapshot 一致；
6. 并行安全未明确返回 true 即串行；
7. Tool Result 按模型 Call 顺序入历史；
8. pending、未恢复错误、paused/blocked 不得 completed；
9. 硬预算只暂停或阻塞；
10. 历史 Session 和 CLI/NDJSON/Host 不回归。

## 3. Task 与 Decision

| ID | 场景 | 预期 |
|---|---|---|
| TASK-001 | 简单事实/闲聊 | answer 快速路径，无业务 Tool |
| TASK-002 | 单步只读任务 | execute，有界 deliverable/criterion |
| TASK-003 | 多目标任务 | 所有交付物进入 Contract |
| TASK-004 | 可假设歧义 | 显式假设后继续 |
| TASK-005 | 重大歧义 | clarify/needs_user |
| TASK-006 | 用户修订 | revision 前进，旧目标不驱动动作 |
| TASK-007 | 旁支问题 | 回答后主任务可恢复 |
| TASK-008 | 非法 JSON | 最多一次修复后安全收敛 |
| TASK-009 | 伪造来源索引 | validator 拒绝 |
| TASK-010 | secret sentinel | 不持久化、不泄漏 |
| TASK-011 | 旧 Task 状态 | 保守迁移，不猜未知条件 |
| TASK-012 | Session 恢复 | revision/status/steps 一致 |

## 4. Capability Routing

| ID | 场景 | 预期 |
|---|---|---|
| CAP-001 | 生产 Session | Resolver 在真实 Step 前调用 |
| CAP-002 | 简单任务 | 最小能力，Schema 小于全量基线 |
| CAP-003 | 代码任务 | 选择 project/tool/task 能力 |
| CAP-004 | 初始漏选 | search/activate 找回 |
| CAP-005 | 激活 | 下一 Step 生效 |
| CAP-006 | 恢复 | activation 恢复 |
| CAP-007 | Profile deny | 稳定原因码，不可激活 |
| CAP-008 | Schema 预算 | 确定裁剪，核心能力保留 |
| CAP-009 | 中文 query | 正确召回 |
| CAP-010 | 不可信内容诱导扩权 | 不扩大权限 |
| CAP-011 | MCP 崩溃 | 陈旧能力撤下 |
| CAP-012 | 无能力 | needs_user/blocked，不编造 |

## 5. Progress、预算与完成

| ID | 场景 | 预期 |
|---|---|---|
| LOOP-001 | 12 Step 后仍有新证据 | 自动继续 |
| LOOP-002 | 超过旧 40 Step 后完成 | 合法 completed |
| LOOP-003 | 硬上限未完成 | paused + checkpoint |
| LOOP-004 | paused 后继续 | 不重复成功副作用 |
| LOOP-005 | 连续空搜索 | 不算 progress，换策略后收敛 |
| LOOP-006 | 重复读取 | repeatedObservation=true |
| LOOP-007 | Tool ok 无新信息 | 不算 progress |
| LOOP-008 | 能力激活 | capabilityExpanded=true |
| LOOP-009 | 修改+验证 | 进展状态正确 |
| LOOP-010 | 重复失败 | blocked/failed |
| LOOP-011 | Approval 拒绝 | 不重试、不完成 |
| LOOP-012 | wall clock | 收敛、checkpoint、paused |
| LOOP-013 | 取消 | cancelled，所有 Call 闭合 |
| LOOP-014 | max tokens | 不被错误降级为 completed |
| DONE-001 | criteria/evidence 全满足 | accepted |
| DONE-002 | pending step | 拒绝并继续 |
| DONE-003 | required evidence 缺失 | 不得声称核实 |
| DONE-004 | 证据域错配 | 修正或继续 |
| DONE-005 | 修改未验证 | 拒绝完成 |
| DONE-006 | 失败后成功恢复 | 允许完成 |
| DONE-007 | 最后失败链未恢复 | blocked/failed |
| DONE-008 | Call 无 Result | 先闭合协议 |
| DONE-009 | 同因二次拒绝 | 非完成终态，不无限提醒 |
| DONE-010 | 文本声称完成但 Contract active | outcome 非 completed |

## 6. 并行调度

| ID | 场景 | 预期 |
|---|---|---|
| PAR-001 | 四个安全 read | 确实重叠且不超 cap |
| PAR-002 | cap=1 | 串行等价 |
| PAR-003 | safe/safe/exclusive/safe | barrier 正确 |
| PAR-004 | 完成顺序 3/1/2 | 入历史仍 1/2/3 |
| PAR-005 | classifier 缺失/抛错 | exclusive |
| PAR-006 | 一个调用失败 | 兄弟结果保留、全部闭合 |
| PAR-007 | scheduler 失败 | drain 并补齐 Result |
| PAR-008 | 派发前取消 | ABORTED_BEFORE_DISPATCH |
| PAR-009 | 执行中取消 | 收敛后 Session 可用 |
| PAR-010 | 写/命令/Browser/Task | 始终 exclusive |
| PAR-011 | MCP read | 声明和本地策略均允许才并行 |

## 7. 新 Tool

### Web

- Bailian 主模型可使用独立 Search Provider；未配置时 unavailable；错误凭据不泄漏；Search URL 只有 Fetch/Browser 后才算正文证据；取消/超时/空结果安全收敛；切换主 Provider 不改变 Search。

### Git

- status/diff/log/show 有界正确；非 Git 稳定不可用；路径不逃逸；参数不能注入写命令；大输出明确截断。

### System

- 平台/架构/Node/Isla 结构化返回；代理只返回配置 presence/脱敏 origin；环境值、凭据、完整敏感命令行不输出；各平台缺项安全降级；更深权限转 run_command Approval。

## 8. 安全、兼容和性能

- 覆盖所有历史 Session migration fixture；
- Task/Checkpoint/trace/diagnostic/评估摘要通过 secret sentinel 扫描；
- npm 包不含 `.isla-local`、Session、评估原文、数据库或配置；
- Approval、Sandbox、read-before-edit、Web SSRF/DNS pinning、Browser vault 无回归；
- activation 不等于 approval，并行不绕过实时权限检查；
- 四个 200ms 安全 read 应有事件重叠，目标总时间不超过 550ms；
- cap=1 保持串行；
- 简单 answer 不注入业务 Tool Schema；
- 初始 Schema bytes 相比全量基线至少降低 40%，且召回测试全过。

## 9. 回归与发布阻断

必须运行 `npm run typecheck`、`npm run test`、`npm run build`、`npm pack --dry-run`，并单报 Task/Loop、Routing、Scheduler、新 Tool、CLI/NDJSON/Host、migration 和各平台结果。

以下任一项阻断：Resolver 仍只在单测；pending 可 completed；预算丢状态；并行产生悬空/乱序/越权；失败链 completed；新 Tool 泄密或越界；真实评估只跑一次或只用 Fake；通过放宽安全门禁换取分数；旧 Session 不可恢复；npm 包包含私人材料。
