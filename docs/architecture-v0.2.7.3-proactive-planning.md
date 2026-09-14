# Isla v0.2.7.3 架构基线：主动建议与真实 Web 闭环

状态：部分实施；前置决策方案经真实评估后由 v0.2.7.4 取代
日期：2026-09-14  
目标名称：Proposal-First Planning and Real Web Closure

## 1. 唯一目标

v0.2.7.3 修复 v0.2.7.2 真实旅行对话暴露出的同一个交付缺口：Agent 已具备阶段式决策和 Web Search，却会持续要求用户拍板，无法在信息足够时采用可见假设、提出一版建议并完成 `web_search → web_fetch → synthesize`。

后续结论：本版完成的 Web 安全衔接、诊断和测试能力继续保留；`understand → answer/clarify/execute` 前置闸门无法稳定保证 Tool 可见性，控制流由 `docs/architecture-v0.2.7.4-action-loop.md` 接替。

本版目标流程：

```text
understand
  → 仅在真正阻塞时 clarify（有界）
  → 信息足够或用户委托选择时 execute
      → web_search
      → 对已发现来源按策略 web_fetch
      → synthesize 一版可修改的完整建议
  → 用户不满意时基于反馈重规划
```

本版不建设旅行专用规划器，也不追求首次方案完美。验收标准是“足够开始、明确假设、先交付一版、允许迭代”。

## 2. 真实问题与证据

真实 CLI 对话连续 9 次进入澄清，用户已经提供出发地、目的地、日期、人数、预算倾向、游玩偏好和到达时间，Agent 仍继续询问具体景点、高速路径和驾驶员轮换。主要问题不是用户信息不足，而是控制策略把可由 Agent 推荐的选择错误地当成阻塞条件。

同时观察到：

- “你好”会出现多次 `MODEL_REQUEST_SUCCEEDED`，日志没有 phase，无法区分 decision、fallback、tool loop 和 synthesis；
- `PROVIDER_EMPTY_RESPONSE` 后会走额外 decision fallback/repair，但日志只显示 `withTools=false`；
- debug 日志写 stderr、spinner 写 stdout，两个流在同一终端互相穿插；
- 真实 Web smoke 在提示中人为要求“查找当前可引用来源”，不能证明自然旅行请求会触发 Search；
- smoke 只断言 Search 成功，没有断言 Fetch、证据引用、完整交付或澄清轮数；
- Search 结果 URL 不自动满足 Fetch allowlist，预先配置固定域名无法稳定覆盖真实搜索发现的页面。

## 3. 设计原则

1. **澄清只解决阻塞项。** 不知道哪个景点最好、走哪条可选路线、住宿档次细节，通常是 Agent 应提出建议的内容。
2. **用户可以委托判断。** “你挑”“按你说的”“不懂”“没有特别要求”等表达意味着允许采用合理默认值，不得继续要求同类拍板。
3. **先给可修改方案。** 有一条合理路线即可执行和综合，不要求穷举所有偏好后才开始。
4. **假设必须可见。** 未确认选择进入 `assumptions`，最终回答简短列出，不升级为用户事实。
5. **澄清轮数有界。** 同一 Task 默认最多一个正常澄清 Turn；只有出现新的硬冲突或安全阻塞时允许第二次，绝不无限追问。
6. **Web Search 自然触发。** 路线、开放状态、节假日政策等需要当前外部事实时，由 evidence requirement 驱动 Search，不依赖用户说出“搜索”。
7. **Search 与 Fetch 安全衔接。** 只有本 Turn 成功 Search 返回的精确 HTTPS URL 可成为临时 Fetch 候选，且仍需 URL 安全检查和独立网络 Approval。
8. **可观测性描述阶段。** 每个模型请求必须能看出 phase 和原因；debug 模式不保留动态 spinner。

## 4. “足够开始”的判定

### 4.1 阻塞问题

只有缺失后无法形成任何合理可执行版本，或错误假设会造成明显风险的问题才阻塞。例如：

- 起点或终点完全未知；
- 可用时间范围完全未知；
- 用户给出的日期、终点或硬性要求互相冲突；
- 请求涉及不可逆外部动作而缺少必要授权；
- 健康、安全、法律等高风险条件无法合理假设。

### 4.2 非阻塞未知项

以下通常转为假设或建议，不触发额外澄清：

- 具体景点由 Agent 推荐；
- 多条可行路线中选择一条主线；
- 未说明的住宿档次采用与预算描述一致的中间档；
- 未说明是否轮换驾驶时按单驾驶员保守安排；
- 广州具体城区已知时，不再追问街道级落点；
- 用户表示“不懂、没有偏好、你决定”的项目。

### 4.3 最小旅行 readiness

旅行规划在具备以下事实后应进入 execute：

- 可识别的起点和终点；
- 出发日期或季节；
- 总天数或最晚到达时间；
- 大致人数；
- 至少一个总体偏好，或者用户明确委托 Agent 选择。

驾驶员数量、预算和细分景点可改善方案，但不是每次都必须阻塞。缺失时采用保守假设并展示。

## 5. 决策契约调整

保留 `answer | clarify | execute`，不增加新的工作流分支。对 `TaskBrief` 增加最小进度元数据：

```ts
interface TaskBrief {
  readonly goal: string;
  readonly confirmedConstraints: readonly ConfirmedConstraint[];
  readonly openQuestions: readonly string[];
  readonly assumptions: readonly string[];
  readonly clarificationTurns: number;
}
```

规则：

- `openQuestions` 只保存阻塞项；偏好未知但可默认时直接进入 `assumptions`；
- `answer` 不得携带 `openQuestions`；若 Provider 产生这种矛盾状态，Runtime 将其归一化为一次组合 `clarify`，不检查任务领域或用户关键词；
- `answer` 只用于不需要规划、工具和外部事实的即时回复；多步交付、比较、研究和方案制定统一进入 `execute`，由模型自主决定所需 Tool 序列；
- `clarificationTurns` 由 Runtime 维护，模型不能任意降低；
- 首次 `clarify` 最多一个组合问题，问题必须说明为何阻塞，并提供可接受的默认路径；
- 用户回答、拒绝回答或委托 Agent 选择后，Runtime 要求下一次 decision 只能是 `answer` 或 `execute`；
- 第二次 clarify 仅在当前用户消息引入新的冲突或安全阻塞时允许；超过上限时用已有事实和保守假设推进；
- Runtime 仍校验 confirmed constraint 的 user message 来源，不做通用语义证明。

Runtime 不使用领域词或“委托选择”关键词正则。模型根据完整上下文在结构化决策中判断哪些信息阻塞、哪些选择已被用户委托；Runtime 只校验结构、事实来源和澄清次数上限。这样同一机制可用于旅行、采购、研究、编码等任务，避免为每个领域累积关键词。

决策解析失败时统一回退到普通回答路径，不根据用户文本猜测任务类型。正常澄清已发生一次后，如果模型仍返回 `clarify`，Runtime 以已有目标、当前用户补充和可见默认假设进入 `execute`；是否搜索仍由 evidence requirement 与可用 Tool 决定。

## 6. 主动建议输出

进入 synthesize 后，完整规划至少包含：

1. 一条明确推荐的主路线；
2. 与时间范围一致的逐日安排；
3. 每日驾驶强度的保守估算；
4. 本轮外部来源支持的当前事实及 URL；
5. 采用的关键假设；
6. 最多两个最有价值的可调整方向，而不是继续列出待用户拍板清单。

用户后续否定某个景点或地区时，开始新 Turn 更新 TaskBrief 并重规划。否定不是失败，也不要求用户重新填写完整需求。

日期歧义不得静默扩写。例如“2.6号到也行”不能直接解释为“2 日至 6 日均可”；如果上下文不能唯一确定，可进行一次短澄清，或明确写出采用的解释并允许用户纠正。

## 7. Web Search 与 Fetch 的真实衔接

`web_search` 是稳定的 Tool 契约，DeepSeek 官方 Search 只是本版第一个 provider adapter，不进入 Agent Loop 核心。后续可增加 Google、Bing、Brave、Tavily 或自建检索 provider，由配置选择；不同 provider 都必须归一化为相同的 query、sources、provider content 和 failure code。模型只看到 `web_search`，不依赖具体搜索引擎。

本版不为尚未接入的搜索服务提前增加配置枚举，但保留 `WebSearchProvider` 接口；新增 provider 时应独立实现、独立测试，不能在 `session.ts` 中增加 provider 分支。

v0.2.7.3 增加可选的、默认关闭的策略：

```json
{
  "tools": {
    "webFetch": {
      "enabled": true,
      "allowSearchResultUrls": true
    }
  }
}
```

当该项开启时：

- 仅本 Turn 成功 `web_search` details 中出现的精确规范化 HTTPS URL 获得临时候选资格；
- 资格不扩展到同域名其他路径、重定向目标、子域名或下一 Turn；
- Fetch 仍执行 scheme、credential URL、DNS、公网 IP、重定向、大小、超时和取消检查；
- Fetch 仍产生独立 `network` Approval，用户拒绝后不得联网；
- 重定向后的每一跳仍需原有策略允许；临时资格不自动授权未知重定向；
- 配置关闭时保持现有精确 allowlist 行为；
- 不恢复生产默认 `"*"`，也不把 Search 成功等同于 Fetch 已获授权。

这条桥梁只解决“先发现、再读取”的现实矛盾，不建立跨 Turn Web 信任缓存。

## 8. 模型请求与 CLI 可观测性

`generateModel` 的调用方必须传入阶段和原因：

```ts
type ModelRequestPhase =
  | "legacy"
  | "understand"
  | "decision_fallback"
  | "decision_repair"
  | "execute_tools"
  | "synthesize";
```

诊断示例：

```text
[debug] MODEL_REQUEST_SUCCEEDED: phase=understand;attempt=1;elapsedMs=710;withTools=false
[warning] MODEL_REQUEST_FAILED: phase=understand;attempt=1;code=PROVIDER_EMPTY_RESPONSE
[debug] MODEL_REQUEST_SUCCEEDED: phase=decision_fallback;attempt=1;elapsedMs=659;withTools=false
```

约束：

- `attempt` 只表示同一请求的 Provider retry；fallback/repair 必须使用不同 phase，不能伪装成 retry；
- Journal request snapshot 的 `promptVersion` 更新为 `v0.2.7.3`，并记录 phase；
- debug log 不包含 prompt、用户原文、API Key、header 或 Provider 原始响应；
- CLI `logLevel=debug` 时禁用动态 spinner，使用稳定的逐行日志；normal/quiet 保持现有 spinner；
- 一次 Turn 的调用数可由 phase 序列解释，不能只显示多个 `withTools=false`。

本版不顺便实现 streaming，也不建设完整 tracing 平台。

## 9. 真实验收场景

自然输入，不显式命令 Agent 搜索：

```text
用户：国庆从重庆渝北提一辆车，想边玩边自驾回广州天河，怎么安排比较好？
Agent：最多提出一次关于可用天数/最晚到达时间的组合问题，不询问具体景点让用户拍板。
用户：10 月 1 日出发，3 个人，6 号到即可，想在湘西多玩，其他你推荐。
```

预期：

```text
understand → execute
tool_start(web_search)
tool_end(web_search, ok=true)
tool_start(web_fetch)
tool_end(web_fetch, ok=true)
synthesize → response_end(completed)
```

最终回答应直接给出一版重庆—湘西—广州的逐日方案，明确单驾驶员等假设，引用本轮真实来源；用户无需先决定张家界、凤凰、芙蓉镇和具体高速组合。

## 10. 明确不做

- 旅行专用路线算法、地图导航 API、实时路况或精确油费引擎；
- 自动订票、预订、支付或登录态浏览；
- 无限制动态扩大 Fetch allowlist；
- 跨 Turn 保存 Search URL 授权；
- 通用偏好问卷、Planner DSL 或多 Agent；
- 用大量关键词规则替代模型决策；
- 将所有复杂任务强制为零澄清；
- 解决 DeepSeek 服务端所有空响应原因或更换 Provider。

## 11. 完成信号

只有同时满足以下条件才可宣布 v0.2.7.3 完成：

1. 同一任务不会连续无界 clarify；用户委托选择后必须推进；
2. 旅行 readiness 足够时直接执行，非阻塞未知项进入 assumptions；
3. 真实自然对话最多一次正常澄清后进入 Search；
4. Search 发现的精确 URL 可在显式策略、URL 安全检查和独立 Approval 下 Fetch；
5. 真实 NDJSON 完成 Search → Fetch → Synthesize，并交付逐日建议；
6. 最终 URL 可追溯到本轮 Search/Fetch details；
7. debug 日志包含 phase，且不与 spinner 混行；
8. 空响应 fallback/repair 的调用数和原因可解释、受界限约束；
9. 默认测试完全离线，真实测试仍需显式授权；
10. typecheck、全量测试、build、pack 和 diff check 通过；
11. 不泄露凭据、私人会话、Provider 原始 payload；
12. package version 与旧 Web Fetch 默认策略仍按独立收口决定处理；
13. Runtime 核心不存在旅行领域或“委托选择”短语正则；多领域任务共用结构化决策和有界澄清规则。
