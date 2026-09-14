# Isla v0.2.7.3 Luna 实施顺序：主动建议与真实 Web 闭环

状态：部分实施；未完成项迁移至 v0.2.7.4
架构依据：`docs/architecture-v0.2.7.3-proactive-planning.md`

## 0. 实施纪律

- 先确认架构，再修改生产代码；
- 每批先补失败测试，再做最小实现；
- 不执行 commit、push 或 npm 发布；
- 默认测试不访问公网或真实 Provider；
- 真实评估只在用户再次明确授权后执行；
- 不记录真实 API Key、完整 transcript、header 或 Provider payload；
- 保留用户现有 `.gitignore`、`.npmrc` 和其他未提交改动；
- 若实现需要新增旅行专用 schema、第二 Search Provider 或通用工作流框架，停止并重新讨论。

## 1. 批次 A：冻结真实失败基线

目标：把当前失败变成可重复断言，而不是只依赖人工 transcript。

修改：

- `tests/core/agent-loop.test.ts`
- `tests/smoke/real-ndjson.test.ts`（仅调整默认 skip 的 driver）

先写失败测试：

- 已补充起终点、日期、人数、到达期限和“其他你推荐”后，不得再次 clarify；
- “不懂、你挑、按你说的”会推进到 execute；
- 非阻塞景点偏好进入 assumptions；
- 日期歧义不能被扩写成未经确认的范围；
- 同一任务澄清轮数有界；
- 原真实 driver 当前只断言 Search，不足以宣称闭环通过。

本批不修改生产实现。

## 2. 批次 B：TaskBrief 澄清进度

目标：Runtime 能重建同一任务已经澄清过几次。

修改候选：

- `src/core/agent-loop.ts`
- `src/core/session.ts`
- `src/session-store.ts`
- 对应 Session v3、Journal 和 compaction 测试

实现：

- `TaskBrief.clarificationTurns`，旧 Session 缺失时规范化为 `0`；
- Runtime 在提交 `needs_user` 时递增，模型输出不能降低该值；
- `/new` 和新 Session 清零；
- context compaction 保留该值但不把 assumptions 转为 confirmed；
- parser 继续接受旧测试 fixture，避免无意义迁移破坏。

验收：持久化、恢复、继续对话和旧 Session 兼容测试通过。

## 3. 批次 C：Proposal-first 决策策略

目标：把“缺信息就问”改成“只有阻塞才问”。

修改：

- `src/prompts/base.ts`
- `src/core/agent-loop.ts`
- `src/core/session.ts`
- `tests/core/agent-loop.test.ts`
- Prompt 组合测试

实现顺序：

1. decision policy 明确定义 blocking 与 non-blocking unknown；
2. clarify 最多一个组合问题，并给出默认推进选项；
3. 用户委托选择时，下一 decision 禁止 clarify；
4. 首次澄清后的正常补充要求下一 decision 优先 execute；
5. 只有新冲突或安全阻塞允许第二次 clarify；
6. 达到上限时把剩余非安全问题投影到 assumptions，并发起一次受约束的 decision repair；
7. 删除当前仅依赖“补充/数字/预算”等正则的强制推进特例，替换为可测试的通用进度规则和极小委托意图下限。

停止条件：如果必须靠大量旅行词表才能通过，说明契约仍不清晰，应回到设计而不是继续堆正则。

## 4. 批次 D：主动综合策略

目标：最终回答给出一版建议，而不是另一组选择题。

修改：

- `src/prompts/base.ts`
- `tests/prompts/*`
- `tests/core/agent-loop.test.ts`

实现：

- synthesize 必须选择一条推荐主线；
- 最多列两个可调整方向；
- assumptions 单独、简短展示；
- 驾驶员未知时保守估算；
- 用户后续否定建议时更新 TaskBrief 并重新 execute；
- 禁止把“可修改建议”写成“已确认事实”。

## 5. 批次 E：Search result 的单 Turn Fetch 资格

目标：在不使用 `"*"` allowlist 的情况下完成真实 Search → Fetch。

修改候选：

- `src/config.ts`
- `src/web/policy.ts`
- `src/tools/web-fetch.ts`
- `src/core/session.ts` 或现有 Tool Runtime 上下文边界
- `tests/config*.test.ts`
- `tests/web/policy.test.ts`
- `tests/tools/web-fetch.test.ts`

实现：

- 增加默认 false 的 `webFetch.allowSearchResultUrls`；
- 从当前 Turn 成功 `web_search` details 建立规范化精确 URL 集合；
- Fetch policy 接收只读的 Turn-local candidate set；
- 候选只匹配精确 URL，fragment 规范化，不扩展域名或路径；
- Approval、DNS、公网 IP、redirect、timeout、size 与 cancel 检查保持原样；
- Turn 完成、取消或失败后清空候选；
- Session 持久化保留工具事实，但不把候选恢复为未来 Turn 的权限。

验收：关闭配置完全兼容；开启后只能读取本 Turn 已发现且用户批准的 URL。

## 6. 批次 F：阶段化诊断和 debug CLI

目标：每次模型调用都能解释，debug 输出不破坏终端。

修改：

- `src/core/session.ts`
- `src/core/journal.ts`
- `src/core/request-snapshot.ts`
- `src/application.ts`
- `src/cli.ts`
- 对应 diagnostic/CLI/Journal 测试

实现：

- `generateModel` 必须接收 `phase`；
- 诊断增加 phase，保留 attempt、elapsedMs、withTools 和安全错误码；
- structured empty fallback、decision repair 使用独立 phase；
- snapshot 记录 phase，`promptVersion=v0.2.7.3`；
- debug 模式不启动 spinner；normal 保持 spinner；
- 不输出 prompt、query、用户输入和原始响应。

验收示例：一次无 Tool 简单回答与一次完整 Agent Turn 的 phase 序列都可精确断言。

## 7. 批次 G：离线端到端回归

目标：使用 Fake Provider/Fake Search/Fake Fetch 验证完整行为。

场景：

1. 首轮旅行请求只问一个组合问题；
2. 用户补充“6 号到、湘西为主、其他你推荐”；
3. decision=execute，assumptions 含单驾驶员/推荐景点；
4. Search 返回两个 HTTPS URL；
5. 仅其中一个精确 URL获得临时 Fetch 候选；
6. Approval 后 Fetch 成功；
7. synthesize 返回 6 天逐日方案和来源；
8. 用户说“不去张家界”后直接重规划，不重新询问全部条件。

失败分支覆盖 Search 空结果、Fetch 被拒绝、URL 不匹配、redirect 越界、取消和 Provider 空响应。

## 8. 批次 H：真实 NDJSON driver 收紧

目标：driver 证明自然交互闭环，而不是提示工程过关。

修改：

- `tests/smoke/real-ndjson.test.ts`
- 执行后新增 `docs/evaluation-v0.2.7.3-proactive-web.md`

变化：

- 第二轮不再包含“查找当前可引用来源”；
- 断言同一任务最多一次正常 clarify；
- 必须等待并批准 Search 与 Fetch 两个独立 Approval；
- 必须断言两个 Tool 均成功且顺序正确；
- `response_end.outcome=completed`；
- 最终文本包含逐日结构、关键假设和至少一个本轮来源 URL；
- 最终文本不得继续要求用户逐个选择景点才开始；
- 日志按 phase 解释模型调用，不以调用次数本身判失败。

若 Provider/Search/Fetch 任一真实能力不可用，driver 必须输出脱敏分类结果，不能把一次偶发通过当作完成。

## 9. 批次 I：完整门禁与文档收口

按顺序执行：

```text
npm run typecheck
npm test
npm run build
npm run pack:check
git diff --check
git status --short
```

检查：

- 默认测试无公网；
- npm 包不包含 `.env`、`.npmrc`、Session、Memory 或真实日志；
- 未引入通用 Planner、旅行算法或第二 Provider；
- 真实评估前后临时 Profile/Session/Memory 可清理；
- 不修改 package version 和 Web Fetch 历史默认策略，除非用户单独确认；
- 未 commit、未 push。
