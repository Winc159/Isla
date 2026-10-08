# v0.4.8 实施步骤

## 执行原则

- 先记录 `git status`，保留用户已有改动。
- 复用 `ToolCapability`、`ToolRegistry`、`ToolRuntime`、Approval、Agent Loop 和现有 Capability Policy。
- 每批只加入一个可独立验证的能力；到达停点后再继续。
- 不顺手收口 v0.4.7 Browser 未完成项。
- 不执行 `git commit` 或 `git push`。

## Batch A：Manifest、Provider 与 Catalog

1. 新增最小 `CapabilityManifest`、`CapabilityProvider`、Availability 和原因码类型。
2. 实现 Host-owned `CapabilityCatalog`：注册、按 ID 查询、有界搜索、稳定排序、重复 ID 拒绝。
3. 为现有内置 Capability Factory 增加静态 Provider 包装；不要修改每个 Tool 的执行实现。
4. Manifest 描述和关键词设置长度/数量预算，不包含 Tool Schema 与秘密。

停点：Catalog 可以列出内置 Capability 摘要；重复 ID、无效 Manifest、超预算摘要均确定性失败；现有 Tool Runtime 测试不变。

## Batch B：Availability 与现有策略桥接

1. 将 Profile allow/deny、Provider tool-calling、平台、配置依赖投影为统一 Availability。
2. 保留现有 Skill/MCP 过滤语义，不能出现新默认授权。
3. 将 Browser、Web、Project、Command、Context、Session History、Skill、User Question、Task State 和 MCP 分配稳定 Capability ID。
4. 扩展 `/capabilities` 和 NDJSON 只读结果，但保持旧字段兼容。

停点：相同 Profile 下 Catalog 可用性与 v0.4.7 实际可用能力一致；不支持 Tool Calling 的模型明确显示不可用。

## Batch C：Task Activation State 与 Activator

1. 增加 versioned `CapabilityActivationStateV1` 并接入 Session 持久化。
2. 实现统一 Activator，Runtime 和模型元工具必须走同一路径。
3. 激活时重新检查 Catalog、Availability 和策略；未知或陈旧 ID 失败。
4. 恢复旧 Session 时迁移为空激活状态；恢复新 Session 时重新验证已激活项。

停点：激活幂等、恢复可重建、Profile 收紧后旧激活失效；不改变 Tool Approval。

## Batch D：逐 Model Step Snapshot

1. 把固定 Tool Definition 选择移到每次 `generateModel` 前。
2. 根据常驻项、Task 激活项和 Runtime Resolver 生成当前 Step 的 Capability 集合。
3. 从已激活 Provider 创建或复用 `ToolCapability`，构造当前 Step Registry view。
4. 生成不可变 Step Snapshot，并让请求使用其准确 Tool Definition。
5. 保持 Loop Budget、Completion Gate、失败/循环计数和取消信号连续。

停点：同一 Turn 中激活后下一 Step 获得新工具；上一 Step 请求快照不漂移；激活不重置预算。

## Batch E：确定性 Resolver

1. 定义最小常驻集合：Capability Routing、User Question、Task State。
2. 从当前用户输入、Task State 和本 Turn 已成功 Tool 使用中选择候选。
3. 对 Project、Browser、Web、Command、Context、Session History、Skill 和 MCP 增加显式、可测试规则。
4. 应用数量、schema bytes 和 token 预算；排序和 tie-break 固定。
5. 没有可信匹配时只保留常驻集合，不回退暴露全部工具。

停点：简单问答无业务工具；项目问题不含 Browser/Shell；网页问题有 Browser 但无 Shell；所有判断可由原因码解释。

## Batch F：发现元工具

1. 实现 `capability_search`，只查询 Manifest 摘要。
2. 实现 `capability_activate`，成功后只改变 Task Activation State。
3. 实现 `capability_status`，投影安全状态。
4. 三个工具使用严格参数验证、结果预算、AbortSignal 和现有 Journal/ToolRuntime 路径。
5. 明确提示激活在下一 Model Step 生效，且不会授予内部 Tool Approval。

停点：Runtime 未命中时，模型可搜索、激活并在下一 Step 调用目标 Tool；未知 ID 不形成重试循环。

## Batch G：MCP 投影

1. 为每个 Profile 已配置 MCP Server 建立一个 Provider/Manifest。
2. Manifest 使用 Server id、工具短摘要和 Availability；MCP instructions 继续视为不可信。
3. 未激活 MCP Capability 时不向模型发送其 Tool Schema。
4. 激活后复用现有 MCP Client、ToolRuntime、Approval 和调用超时。
5. Server 崩溃或 generation 变化时撤下能力并让下一 Snapshot 反映 unavailable。

停点：大量 MCP Tool 存在时默认请求 Schema 保持有界；匹配 Server 可被激活；首版不得宣称实现了 MCP 进程懒启动。

## Batch H：Journal 与诊断

1. 为 Journal 增加选择、拒绝、激活和 Snapshot 结构化记录或等价可重建字段。
2. 保存完整 Capability ID、原因码、Tool 数、schema bytes/token 估算和 hash。
3. 请求快照继续保存实际 Tool Schema；两者一致性可验证。
4. TTY 与 NDJSON 输出等价事实。
5. Context compaction 不能删除当前 Task Activation 与最近有效 Snapshot 事实。

停点：可从持久状态解释任一 Step 看到了哪些工具及原因；不记录 secret、Tool 参数值或网页正文。

## Batch I：回归、真实评估与文档收口

1. 执行 [`testing.md`](testing.md) 全部 P0/P1。
2. 使用内置 Project、Browser fixture 和多工具 MCP fixture 完成真实 Agent Loop。
3. 比较动态路由前后的 Tool 数、schema bytes、估算输入 token 和任务成功率。
4. 更新 README、roadmap、当前架构与 [`evaluation.md`](evaluation.md)。
5. 将外部参考按采用、暂缓、拒绝保留在设计文档，不复制源码或目录。

## Luna 必跑命令

每批：

```bash
npm run typecheck
npm run test -- --run <相关测试>
git diff --check
```

最终：

```bash
npm run typecheck
npm run test
npm run build
npm run verify
npm run pack:check
git diff --check
```

## 完成定义

只有以下全部成立才可声明 v0.4.8 完成：

- 每个 Model Step 使用独立、不可变、可重建的 Capability Snapshot。
- 简单问答不会加载无关业务工具。
- Runtime 预选和模型补充激活均可完成任务。
- Policy、Permission、Approval 和 Sandbox 无绕过。
- 激活不重置 Agent Loop 状态。
- Context compaction 与 Session 恢复不丢失激活事实。
- 大 MCP Catalog 不再默认进入每个模型请求。
- TTY、NDJSON、Journal 和实际 Provider 请求事实一致。
- 全量自动化门禁通过。
