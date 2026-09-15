# Isla v0.2.9 实施顺序：Runtime Consolidation

状态：待确认  
架构依据：`docs/proposals/v0.2.9/architecture.md`

每个 Batch 必须能够独立验证。不得跨 Batch 顺手增加 Local、Context Budget、Shell、MCP、并行 Tool、子 Agent或后台任务。

## 0. 前置停点

开始实现前必须确认：

- v0.2.8 当前门禁仍通过；
- 当前工作区没有来源不明的修改；
- v0.2.9 架构、非目标和完成信号已由用户确认；
- 现有 CLI、NDJSON、Session Event 与 Journal 的实际轨迹已记录；
- 不使用真实 Provider 凭据作为默认测试依赖。

停点：只做只读审计，不修改生产代码。

## 1. Batch A：冻结能力与事件契约

预计修改：

- `src/core/types.ts`
- `src/core/events.ts`
- `src/protocol/types.ts`
- 对应类型与协议测试

步骤：

1. 定义最小 `ProviderCapabilities`；
2. 定义 model step start/delta/end 事件；
3. 明确 step、attempt、provisional 和 result 字段；
4. 明确 Turn 终态与 model step 终态的区别；
5. 保留现有协议请求和权威终态类型；
6. 定义安全诊断允许字段。

停点：仅增加类型、验证和 Fake 轨迹，不接 CLI 或真实 Provider。

## 2. Batch B：提取 ModelStepRunner

预计修改：

- 新增 `src/core/model-step.ts`
- `src/core/session.ts`
- `src/core/model-stream.ts`
- `src/core/request-snapshot.ts`
- 核心测试

步骤：

1. 把一次模型 Step 的单次 attempt 执行从 `ChatSession` 提取；
2. 保持 one-shot 与 streaming 归一化结果不变；
3. 保持每次 retry 使用独立的 runner attempt 和 assembler；retry policy 与 Journal 暂由 `ChatSession` 保持；
4. 通过窄 observer 输出 model step 事件；
5. 继续使用现有 RuntimeError 与 request snapshot；
6. 确保 runner 不执行 Tool、不判断 Completion Gate、不写最终 assistant；
7. 对比提取前后的 Session、Journal 和 Provider 请求快照。

停点：全部核心回归通过；CLI/NDJSON 尚不消费新事件。

## 3. Batch C：提取 RequestContextBuilder

预计修改：

- 新增 `src/core/request-context.ts`
- `src/core/session.ts`
- `src/core/context.ts`
- `src/prompts/compose.ts`
- 上下文与 Prompt 测试

步骤：

1. 统一 legacy 与 agent step 的请求装配入口；
2. 集中历史 projection、checkpoint、Memory、TaskBrief 和 capability prompt；
3. 保持当前字符/Turn 选择语义不变；
4. 保持 Memory、checkpoint 和 TaskBrief 的信任边界文案；
5. 返回完整不可变 `ModelRequest`；
6. 证明相同状态产生相同请求快照；
7. 不新增 tokenizer、Context Budget 或新的 LLM 摘要。

停点：现有请求 snapshot 和真实 Agent 语义不变，或只发生已确认的稳定版本字段变化。

## 4. Batch D：Provider capability snapshot

预计修改：

- `src/core/types.ts`
- `src/providers/openai.ts`
- `src/providers/deepseek.ts`
- `src/providers/local.ts`
- `src/application.ts`
- `src/session-factory.ts`
- Provider 与配置测试

步骤：

1. 每个 Adapter 明确声明实际能力；
2. 启动配置关闭 streaming 时同步关闭对应能力；
3. DeepSeek streaming Tool Calls 默认保持 false；
4. Local 不新增 Tool Calling，实现现状如实报告；
5. Runtime 路径只消费 capability snapshot，不用方法存在性作唯一事实；
6. 启动摘要和协议 ready 使用同一快照；
7. 不进行网络能力探测。

停点：所有能力组合由离线表驱动测试覆盖，生产行为不扩张。

## 5. Batch E：进程内 Model Step 观察

预计修改：

- `src/core/events.ts`
- `src/core/model-step.ts`
- `src/core/session.ts`
- `src/core/journal.ts`
- 事件与 Journal 测试

步骤：

1. streaming attempt 输出 start、delta、end；
2. one-shot attempt 输出 start/end，但不输出 delta；
3. Tool Calls 只在完整组装后进入后续执行；
4. retry、failed、cancelled 具有独立 step end；
5. Journal 只保存安全元数据和聚合计数；
6. observer 不记录 reasoning、Tool arguments 或完整正文；
7. 取消后等待 quiescence 再报告 Turn 终态。

停点：FakeProvider 可证明所有轨迹，CLI/NDJSON 尚未改变。

## 6. Batch F：NDJSON 增量事件

预计修改：

- `src/protocol/types.ts`
- `src/protocol/runner.ts`
- `src/protocol/writer.ts`
- 协议单元与 subprocess e2e

步骤：

1. 映射 model step start/delta/end；
2. 保持每行完整 JSON 和严格串行；
3. 对慢 sink 使用现有有界背压边界；
4. 旧客户端忽略新事件后仍可完成请求；
5. `response_end` 继续携带完整最终文本；
6. completion rejection、retry 和 Tool Step 不产生额外 Turn 终态；
7.取消后没有迟到 delta。

停点：Protocol subprocess e2e 全部通过，stdout 无诊断污染。

## 7. Batch G：TTY CLI 增量展示

预计修改：

- `src/cli.ts`
- 必要的窄 CLI renderer 文件
- CLI 输出测试

步骤：

1. 仅 TTY + native streaming 实时显示；
2. 明确暂态文本与最终提交边界；
3. Tool Step、retry、completion rejection、失败和取消时完成换行；
4. 非 TTY 保持一次性稳定输出；
5. quiet/debug 不与正文混写；
6. Unicode chunk 不损坏；
7. one-shot 不做人工切片。

停点：交互与非交互输出测试均通过，不改变命令行为。

## 8. Batch H：错误与诊断收口

预计修改：

- `src/core/errors.ts`
- `src/application.ts`
- `src/core/journal.ts`
- CLI/协议错误映射
- 对应测试

步骤：

1. 为现有稳定错误建立领域分类；
2. 保留兼容错误码；
3. 审计 `UNKNOWN`，只替换已有明确归属的场景；
4. 对 CLI 与 NDJSON 统一成功、blocked、cancelled 和 error；
5. 为 model step 添加安全 usage/耗时/delta count 诊断；
6. 执行正文、Tool 参数、payload 和凭据泄漏测试。

停点：不借错误整理改变 retry、Approval 或安全策略。

## 9. Batch I：版本、文档与配置收口

预计修改：

- `package.json`
- `README.md`
- `docs/current/*`
- `docs/roadmap.md`
- `docs/dsh-reference-review.md`
- `docs/references.md`
- 必要配置示例

步骤：

1. 统一 v0.2.9 版本和能力声明；
2. 将已完成设计迁入 `docs/current/`；
3. 将 v0.2.8 保留在 proposal/archive 历史；
4. 明确 Context Budget、Local Tool Calling 等暂缓项及重评条件；
5. 更新 CLI/NDJSON streaming 使用说明；
6. 确认所有链接可解析且没有过期“当前基线”声明。

停点：文档只描述已经实现并验证的能力。

## 10. Batch J：v0.2 最终回归

离线门禁：

```text
npm run typecheck
npm test
npm run build
npm run pack:check
git diff --check
git status --short
```

另执行：

- Protocol subprocess e2e；
- CLI TTY/非 TTY 输出测试；
- Provider fixture；
- Session 恢复、Memory、Approval、Web 和取消回归；
- 凭据、Authorization、完整 Provider payload、reasoning 与私人正文扫描；
- 文档和 package 版本一致性检查。

真实 Provider 评估只在用户明确授权后运行并分 Provider 报告。未授权时不得用真实网络结果替代离线门禁。

## 11. 实施纪律

- 每次只开始一个 Batch；
- Batch 完成后先运行对应测试并汇报 diff；
- 改变核心契约或扩大非目标范围前停止并与用户确认；
- 不执行 Git add、commit 或 push，除非用户另行明确要求；
- 不保存真实凭据、私人会话或完整 Provider payload。
