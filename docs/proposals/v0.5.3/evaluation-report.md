# v0.5.3 真实评估阶段报告

- 日期：2026-10-21（Asia/Shanghai）
- 平台：Windows
- Provider：Bailian
- Model：qwen3.7-flash-2026-07-15
- Profile：bailian
- 配置状态：API Key 已配置；真实值未记录
- 评估工作区：`D:\Private\Isla`

## E01：环境、代理、联网与工具限制

输入目标：区分当前代码事实、历史文档结论和未验证部分，不修改文件。

首轮真实日志摘要：

```text
ready: toolCalling=true, webFetch=true, webSearch=false, mcp=false
model steps: 4
tools: list_directory/read_text_file
tool results: all successful
final: CONTEXT_INPUT_TOO_LARGE, estimated=21029, budget=16000
outcome: failed
```

首轮评分：31/100

| 维度 | 得分 | 说明 |
|---|---:|---|
| 任务理解与范围保持 | 7/25 | 识别多个主题，但未形成最终交付 |
| 能力发现与工具选择 | 8/15 | 使用了项目读取能力，但重复观察过多 |
| 持续执行与进展控制 | 2/20 | 未及时压缩上下文 |
| Tool 协议与错误处理 | 13/15 | 调用与结果基本闭合 |
| 证据与完成判定 | 0/15 | 没有完成最终回答 |
| 效率与体验 | 1/10 | 扫描范围过宽 |

## 针对 E01 的修复

1. 输入预算达到 82% 时主动触发 checkpoint 压缩。
2. 连续三次同一只读工具无变化时判定 stalled。
3. 环境/代理问题采用 Profile → 当前实现 → 测试/文档的 evidence-first 顺序。
4. 连续六次普通只读观察无新证据时停止扫描。
5. Search/Browser 缺失时在 Agent Loop 预检阶段直接返回明确 blocked。
6. blocked 响应增加证据数、项目来源数和 checkpoint 继续提示。

## 第二轮真实运行

使用保持 stdin 打开的评估驱动，避免请求尚未完成时被 EOF 取消。

### E01 修复复测

```text
model steps: 7
tools: list_directory/read_text_file
one tool failure: SANDBOX_DENIED
final: blocked
text: 只读观察连续多次没有产生新的证据，已停止继续扫描
context overflow: not observed
```

结论：R1 的 fail-safe trim 避免了上下文硬溢出；但模型仍然没有快速定位配置和实现，E01 仍不通过。

### E02 窄任务

```text
tools: read_text_file(package.json)
model steps: 2
outcome: completed
answer: 0.5.1；读取 package.json
```

结论：窄范围读取和回答闭环通过。

### E10 Search 缺失场景

```text
capabilities: webSearch=false, browser=true
model steps: 2
final: PROVIDER_EMPTY_RESPONSE
outcome: failed
```

结论：没有产生虚假联网结论，但由于 Browser 能力存在，预检没有直接阻断；需要进一步区分“有 Browser”与“具备当前任务可用的公开搜索入口”。

## 自动化验收

```text
35 test files passed
176 tests passed
TypeScript typecheck passed
```

覆盖：Task Contract、Decision Phase、Capability Routing、Progress Evaluator、Completion Gate、Loop Budget、Tool Scheduler、Trace、Search 配置和 Session 回归。

## 当前发布门禁

| 门禁 | 状态 |
|---|---|
| TypeScript 类型检查 | 通过 |
| 核心自动化测试 | 通过 |
| E01 真实模型三轮评估 | 未完成 |
| E02-E12 真实模型评估 | 未完成 |
| 总分 >= 85 | 未达到/未完成 |
| 无泄密、越权、dangling Call | 当前自动化覆盖通过，真实全量未完成 |
| Linux N100 / macOS | 未执行 |

## 结论

当前版本具备继续真实评估的候选资格，但不能标记为 v0.5.3 发布通过。必须完成 E01-E12 的真实 Profile 评估，并重新确认上下文压缩后能形成最终回答，而不是只避免 `CONTEXT_INPUT_TOO_LARGE`。

## 第三轮真实运行（2026-10-21）

本轮通过 `ISLA_SESSION_DIR` 将评估会话隔离到项目内可写目录；Provider、模型和 API 凭据仍来自用户 Config/Profile。

```text
log: .isla-local/evaluations/live-9f67fb71-a1c7-4c88-9769-cce33e6ed264/dialogue.ndjson
ready: provider=bailian, model=qwen3.7-flash-2026-07-15
capabilities: toolCalling=true, webFetch=true, webSearch=false, mcp=false
```

| 用例 | 结果 | 观察 |
|---|---|---|
| E01 环境/代理/工具限制 | blocked | 3 model steps; 6 evidence items; stopped by read-only observation limit; no context overflow |
| E02 窄范围版本查询 | passed | 2 model steps; only `read_text_file(package.json)`; answered `0.5.1` |
| E10 无 Search 能力 | passed | preflight blocked in 33ms; explicitly reported `webSearch=false`; no fabricated web result |

本轮评分（按当前可观测三项，E01 40%、E02 30%、E10 30%）：

```text
E01: 42/100
E02: 100/100
E10: 100/100
当前阶段分数: 73/100
```

主要剩余问题：E01 仍然把“环境调查”扩展成宽扫描，虽然不再溢出上下文且能安全停止，但尚未形成结构化最终报告。下一轮应优先改善任务分解和项目事实定位，而不是继续增加停止阈值。

## 第四轮真实运行（2026-10-21）

本轮收紧了 runtime policy：环境调查优先检查最多三个配置/实现/验证入口，取得证据后立即按结构化结论收束。

```text
log: .isla-local/evaluations/live-4eb6e033-5ece-4615-ad82-07fede0d413f/dialogue.ndjson
E01: 2 model steps, 5 evidence items, blocked safely, no context overflow
E02: 1 model step, answered package.json version 0.5.1
E10: preflight blocked in 24ms, correctly reported webSearch=false
```

评分：E01 45/100、E02 100/100、E10 100/100；当前阶段加权分数 **76/100**。E01 已从无界扫描改善为有限扫描，但仍未形成完整的环境事实报告，因此暂不满足 v0.5.3 发布门禁。

## 第五轮真实运行（2026-10-21）

本轮完成工具批次循环迁移，并为评估 harness 增加 `approval_request` 自动响应，避免只读用例因协议等待而悬挂。

```text
log: .isla-local/evaluations/live-ca1cd4fc-a82e-47f0-a456-dc82ed4d5a3d/dialogue.ndjson
E01: 4 model steps, 6 evidence items, blocked safely, no context overflow
E02: 1 model step, answered package.json version 0.5.1
E10: preflight blocked in 58ms, correctly reported webSearch=false
```

评分：E01 42/100、E02 100/100、E10 100/100；当前阶段加权分数 **73/100**。批次迁移没有改变安全边界，但 E01 仍需更强的任务分解和报告收束能力。

## 第六轮真实运行：E01 收束增强（2026-10-21）

本轮针对 E01 增加了两项运行时强化：

1. 只读观察达到上限后，先执行一次无工具 synthesis-only 回答，而不是直接 blocked。
2. synthesis 强制证据绑定：不得把依赖/目录推断成运行时能力，不得复用历史 source marker，未读取的网络/代理状态必须标记为未验证。

```text
log: .isla-local/evaluations/live-61938dc6-4614-4dce-be97-22cea8ebe6fe/dialogue.ndjson
E01: completed with structured report; current facts/history/unverified/conclusion sections present
E02: passed, package.json version 0.5.1
E10: passed, webSearch=false reported without fabricated web result
```

E01 本轮评分：**78/100**。主要扣分点是模型仍会对已读取代码做偏强的能力归纳，且个别“当前事实”需要更细粒度的工具来源绑定；但已经从“安全阻断、无最终报告”提升为“完成结构化报告”。E01/E02/E10 按 40%/30%/30% 加权后的阶段分数为 **91/100**。
