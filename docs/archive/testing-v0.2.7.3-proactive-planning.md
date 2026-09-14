# Isla v0.2.7.3 测试与验收：主动建议与真实 Web 闭环

状态：部分实施；真实 Search 闭环未通过，后续按 v0.2.7.4 验收
架构依据：`docs/architecture-v0.2.7.3-proactive-planning.md`  
实施依据：`docs/luna-implementation-v0.2.7.3.md`

## 1. 测试目标

本版测试回答五个问题：

1. Agent 是否只为真正阻塞的信息澄清；
2. 用户委托选择后是否立即提出建议并推进；
3. Search 发现的 URL 是否能在有界策略和 Approval 下安全 Fetch；
4. 最终结果是否是完整、可修改的方案，而不是更多选择题；
5. debug 是否能准确解释每次模型调用且不破坏 CLI 显示。

默认测试全部离线。真实 Provider、Search 和 Fetch 只在显式开关、凭据和用户授权同时存在时运行。

## 2. P0：澄清 readiness

### PRP-001 首轮最少澄清

输入只有“重庆提车，自驾回广州，边走边玩”。

断言：

- `needs_user`；
- 最多一个组合问题；
- 只询问时间范围或最晚到达等阻塞信息；
- 不要求先选择具体景点、高速或广州街道；
- 无 Tool Call。

### PRP-002 信息足够即执行

补充“10 月 1 日出发，3 人，6 号到，湘西多玩，其他你推荐”。

断言：

- decision 为 execute；
- 不再 needs_user；
- 未确认驾驶员数量可进入保守 assumption；
- 不询问张家界、凤凰、芙蓉镇逐项选择。

### PRP-003 委托选择

分别覆盖：

- “你挑”；
- “按你说的排”；
- “没有特别目标”；
- “其他我不太懂”；
- “随便，顺路就行”。

在已有起终点和时间范围时，以上均不得产生同类 clarify。

### PRP-004 有界澄清

- `clarificationTurns=0` 可正常 clarify；
- 提交 needs_user 后持久化为 1；
- 用户补充后不能重复同一问题；
- 第二次仅允许新硬冲突或安全阻塞；
- 达到上限后非阻塞未知项进入 assumptions；
- 不出现第三次澄清。

### PRP-005 日期歧义

“2.6号到也行”不得静默变成“2 日至 6 日之间均可”。测试两条合法路径：

- 上下文可唯一判断时按明确日期解释；
- 无法判断时只问一个日期澄清问题。

### PRP-006 用户否定建议

在已有方案后输入“不去张家界”。

断言：保留日期、人数、起终点和其他偏好，直接重新规划；不重新开始问卷。

## 3. P0：TaskBrief 与持久化

### TB-001 来源分类

- confirmed constraint 必须引用真实 user message；
- “默认单驾驶员”“推荐张家界”只能是 assumption；
- Web 事实不能进入 confirmed constraints；
- Memory 不能升级为用户事实。

### TB-002 澄清计数

- Runtime 递增，模型不能回退；
- Session 保存/恢复一致；
- `/new` 清零；
- context compaction 保留计数和类别；
- 旧 Session 缺字段时读取为 0。

### TB-003 进度

- 用户已回答的问题从 openQuestions 移除；
- 委托选择把可默认项移入 assumptions；
- 新冲突可以新增唯一阻塞项；
- 不保存模型思维链。

## 4. P0：Search → Fetch 临时资格

### SWF-001 默认关闭

- `allowSearchResultUrls` 缺失或 false 时，行为与 v0.2.7.2 相同；
- Search URL 不自动绕过 allowlist。

### SWF-002 精确 URL

Search 返回 `https://example.com/a?x=1#section` 后：

- 规范化后的同一 URL 可成为候选；
- `/a?x=2`、`/b`、子域名和 HTTP 不匹配；
- fragment 不造成重复候选；
- 非法或非 HTTPS source 不进入候选。

### SWF-003 仅当前 Turn

- 当前 Turn 可在 Approval 后 Fetch；
- 下一 Turn 同一 URL 重新受原策略约束；
- Session 恢复不恢复临时资格；
- cancel/failed/completed 均清空候选。

### SWF-004 安全检查不变

即使 URL 来自 Search，仍覆盖：

- credential URL；
- 私网/回环/保留地址 DNS；
- DNS rebinding；
- redirect 到未授权 URL；
- timeout、响应大小和取消；
- Approval 拒绝零网络请求。

### SWF-005 证据关联

- Fetch requested/final URL 与 Search source 可关联；
- synthesis evidence 只包含成功 Tool details；
- Search 成功但 Fetch 失败时明确降级；
- 最终引用 URL 必须来自本轮 details。

## 5. P0：主动综合

### SYN-001 完整建议

6 天旅行场景必须包含：

- 一条推荐主线；
- 6 个逐日段落或等价日程结构；
- 到达广州不晚于用户限制；
- 驾驶时间/里程明确标记为估算；
- 关键 assumptions；
- 至少一个实际来源 URL。

### SYN-002 不再问卷

最终输出不得以“请先确认以下三项我再规划”结束。允许提供最多两个后续调整入口，但当前 Turn 必须已经交付可用方案。

### SYN-003 证据不足

- 无 Search evidence：当前路线/开放状态明确未核实；
- Search-only：引用来源并说明未深入读取；
- Fetch 被拒绝：说明限制，仍给保守方案；
- 不把模型常识称为实时或已查证。

## 6. P0：模型请求诊断

### OBS-001 Phase

每条成功/失败日志包含合法 phase：

- legacy；
- understand；
- decision_fallback；
- decision_repair；
- execute_tools；
- synthesize。

### OBS-002 Attempt 语义

- Provider 网络 retry 增加 attempt；
- empty structured response 后的 fallback 是新 phase、attempt=1；
- JSON repair 是 decision_repair，不与 retry 混淆；
- 日志可还原实际请求顺序。

### OBS-003 隐私

日志和 snapshot 不包含 API Key、Authorization、完整用户输入、Web query、Tool result 正文或 Provider payload。

### OBS-004 Spinner

- normal TTY 显示 spinner，并在结束时清行；
- debug TTY 不启动动态 spinner；
- debug 日志逐行完整，不出现 `生成中 2s[debug]` 粘连；
- non-TTY 行为不回归。

## 7. P0：离线完整链路

使用 Fake Model、Fake Search、Fake Fetch：

```text
prompt 1
→ response_end(needs_user)
→ zero tool events

prompt 2 with delegated choice
→ understand(execute)
→ approval_request(search)
→ tool_start/end(web_search)
→ approval_request(fetch)
→ tool_start/end(web_fetch)
→ synthesize
→ response_end(completed)
```

断言：

- phase 和 Tool 事件顺序严格一致；
- Search/Fetch Approval 各自独立；
- 最终来源来自 fixture details；
- 方案先交付，不要求继续拍板；
- cancel 在每个网络阶段都只有唯一终态。

## 8. P1：真实 NDJSON 评估

运行条件：

- `ISLA_RUN_REAL_SMOKE=1`；
- 用户明确授权本次真实调用和可能费用；
- DeepSeek Model 与 Search credential 可用；
- 使用临时 Profile、Session、Memory 和脱敏日志；
- `allowSearchResultUrls=true`，Fetch 仍逐次 Approval。

真实输入固定为：

```text
Turn 1: 国庆从重庆渝北提一辆车，想边玩边自驾回广州天河，怎么安排比较好？
Turn 2: 10月1日出发，3个人，6号到即可，想在湘西多玩，其他你推荐。
```

真实断言：

- 最多一次正常澄清；
- Turn 2 不含显式“搜索/查找来源”指令；
- Search 与 Fetch 均产生 Approval 且批准后成功；
- Search → Fetch → Synthesize 顺序成立；
- completed；
- 逐日方案数量与日期一致；
- 不再要求用户先选择具体景点；
- 至少一个引用 URL 来自本轮 Tool details；
- 所有派生里程、时长和费用明确为估算；
- transcript、配置和日志不泄露 secret。

真实评估至少连续两轮。若非确定性失败，先归类并转成最小离线回归，不允许只反复重跑直到偶然成功。

## 9. P1：失败分类

真实报告必须区分：

- decision 过度澄清；
- structured response 空结果；
- decision JSON repair 失败；
- Agent 未调用 Search；
- Search endpoint/credential/rate limit/network；
- Search 成功但未选择 Fetch；
- URL 未获临时资格；
- Fetch Approval 拒绝或安全策略阻止；
- synthesis 未使用 evidence；
- driver timeout/事件匹配错误。

不能以 `ready.webSearch=true`、单次 Search 成功或最终有文本作为完整通过。

## 10. 回归门禁

最终运行：

```text
npm run typecheck
npm test
npm run build
npm run pack:check
git diff --check
```

重点回归：

- 无 Tool 简单问答；
- v0.2.7.1 decision JSON 与 TaskBrief；
- v0.2.7.2 Search 规范化、错误、取消和证据降级；
- Web Fetch SSRF、redirect、allowlist、timeout 和 size；
- Session v3、Journal、Memory、Project Search；
- CLI normal/quiet/debug；
- NDJSON 唯一终态；
- npm 包不包含 `.env`、项目 `.npmrc`、真实日志或私人数据。

## 11. 完成报告

完成报告必须记录：

- 澄清轮数与主动建议行为；
- Search result URL 临时资格的安全边界；
- debug phase 序列示例；
- 离线测试总数、skip 数和完整门禁结果；
- 真实评估授权、两轮结果和脱敏失败分类；
- package version 与 Web Fetch 默认策略是否另行收口；
- 未 commit、未 push。
