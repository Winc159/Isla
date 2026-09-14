# Isla v0.2.7.3 → v0.2.7.4 新对话交接摘要

把本文件全文复制到新对话即可继续。

## 当前目标

在 `D:\Private\Isla` 继续开发 Isla。用户已确认进入 v0.2.7.4：取消前置 `answer | clarify | execute` Decision Gate，改为类似 DSH/OpenHands 的 Agent Loop。每个模型 Step 从一开始就看到全部可用 Tool；控制流只有两类结果：Capability Calls（执行后继续 Step）与 Yield To User（无 Tool Call，结束 Turn）。

必须先阅读：

1. `AGENTS.md`；
2. `docs/architecture-v0.2.7.4-action-loop.md`；
3. `docs/luna-implementation-v0.2.7.4.md`；
4. `docs/testing-v0.2.7.4-action-loop.md`；
5. `docs/architecture-v0.2.7.3-proactive-planning.md`；
6. `docs/architecture-v0.2.7.2-web-search.md`。

## 已确认的架构判断

- 不需要独立前置决策模型调用；
- 决策仍存在，但表现为每个 Step 的 Tool Call 或无 Tool Call文本；
- Ask User 与 Final Answer 都是 Yield，不是两个控制 Action；
- Completion Gate 只检查 required evidence、Tool 配对、Approval、安全、取消等硬不变量，不主观评审答案质量；
- Gate 拒绝时追加有界 Runtime Observation 并继续 Step；
- TaskBrief 保存目标、用户事实、假设和 blocker，但不决定是否能看到 Tools；
- Runtime 不允许出现旅行、自驾、广州或“你推荐/随便”等领域和措辞正则；
- Web Search 是通用 Tool，DeepSeek 官方 Search 只是首个 Provider adapter；后续 Provider 不应修改 Agent Loop；
- 不复制 DSH 的 Cordis、Agent Registry、Inbox、完整事件总线或包结构。

## v0.2.7.3 已完成的变动

工作区当前已有以下实现，必须保留并迁移：

- `TaskBrief.clarificationTurns` 旧 Session 兼容；
- proposal-first prompt 调整；
- phase 化模型诊断和 request snapshot；
- debug 模式关闭动态 spinner；
- Provider 未知 HTTP 错误不泄露响应正文；
- Search 结果精确 URL 的当前 Turn Fetch 资格；
- `webFetch.allowSearchResultUrls` 配置；
- Fetch 仍保留 HTTPS、SSRF、DNS、redirect、大小、timeout 和 Approval；
- NDJSON `tool_start` 可记录脱敏 query/url/callId；
- `tool_end` 记录 ok/code；
- 真实测试 timeout 输出完整工具诊断；
- 真实测试驱动可自动审批任意数量的网络调用；
- 相关 policy、web-fetch 和 agent-loop 单元测试；
- 三份 v0.2.7.3 架构、实施和测试文档。

## v0.2.7.3 已发现但未解决的问题

真实规划请求即使信息充分，仍可能被前置 Decision 判为 `answer`，导致：

```text
没有 web_search
没有 web_fetch
直接输出未经核实的具体路线和里程
```

增加 prompt、结构化 JSON repair 和 `submit_decision` 仍不能稳定解决，因为问题来自“Tool 可见性受前置分类控制”的结构本身。真实 smoke 因没有 Search 保持失败，这是正确的未完成信号。

此前一次真实测试显示的另一超时已定位为测试驱动 bug：模型调用了两次 Search，旧驱动把第二次 Search Approval 当成 Fetch Approval，真正 Fetch 未获审批，最终 `TURN_CANCELLED`。驱动现已改成循环处理所有网络 Approval。

## 当前代码中的过渡实现

以下内容属于 v0.2.7.4 应删除的过渡代码：

- `src/core/session.ts` 中 `runAgentLoop()` 的 understand/decision/repair/synthesize 链；
- `SUBMIT_DECISION_TOOL`；
- `TurnDecision` 生产解析；
- answer 携带 openQuestions 的归一化；
- clarificationTurns 强制 execute 的旧分支；
- `decision_fallback`、`decision_repair`、`synthesize` phase。

不要重新加入任何业务关键词正则。

## 最近验证状态

最近已通过：

```text
npm run typecheck
npm run build
npx vitest run tests/core/agent-loop.test.ts tests/web/policy.test.ts tests/tools/web-fetch.test.ts
```

相关测试为 20/20 通过。

最近真实 Web planning smoke 失败，失败原因是最终 response_end 前没有任何 `web_search` tool_start；模型直接输出了完整路线。这是 v0.2.7.4 要修复的核心验收。

## 工作区与安全约束

- 工作区已有用户及当前任务改动，可能同时存在 staged 和 unstaged 内容；不要 reset、checkout 或覆盖无关改动；
- `.gitignore` 有用户既有修改；
- 项目级 `.npmrc` 被忽略，仅 Isla 走 `http://127.0.0.1:10808`，不得写全局 npm/Git 配置；
- 未经用户明确要求，不执行 Git add、commit、push；
- 不输出或保存 API Key、Authorization、真实 Provider payload；
- 真实评估已获此前对本任务的授权，但新对话应再次确认是否执行可能产生费用的真实调用；
- 默认测试必须离线。

## 下一步

从 `docs/luna-implementation-v0.2.7.4.md` Batch A 开始：先写“首 Step 已有 Tools”“Tool Call 后继续”“无 Tool Call Yield”“required evidence completion rejection”失败测试，再把 `generateWithAvailableTools()` 提升为主路径。每批完成后运行 typecheck 和相关测试，不要一次性删除所有兼容路径。
