# Isla v0.2.9 架构提案：Runtime Consolidation

状态：待确认  
前置基线：v0.2.8 Unified Agent Stream 已完成 Provider 与 Runtime 内部组装  
日期：2026-09-15

## 1. 定位

v0.2.9 是 v0.2 系列最后一个版本。它不新增大型 Agent 能力，而是完成已有承诺、修正名实不符的契约、降低继续扩展时的耦合，并建立 v0.3 可以依赖的稳定 Runtime 基线。

Isla 的长期方向仍是贴合个人习惯、能够在明确授权下可靠行动的个人 Agent，而不是通用 Agent 开发平台。所谓“框架优化”只处理已经由当前实现证明存在的问题，不进行全局重写或预建平台抽象。

## 2. 当前现实问题

### 2.1 原生流尚未形成用户可见闭环

v0.2.8 已完成 Provider-neutral `ModelStreamEvent`、共享 `ModelStreamAssembler`、OpenAI 原生流和可选 DeepSeek Responses 流。Runtime 当前等待完整组装后继续既有 Agent Loop，但 CLI、NDJSON 和进程内观察事件尚未输出真实模型增量。

因此当前 streaming 是 Provider 能力，不是完整产品能力。v0.2.9 应完成从 Provider 到 Runtime observer、NDJSON 和 TTY 的单向传递，同时保持 `response_end` 是唯一权威提交。

### 2.2 Provider 能力依赖方法存在性隐式推断

当前 Runtime 主要通过 `generateWithTools`、`generateStream` 和 `streamingEnabled` 判断路径。该方式不能清楚表达：

- 普通生成是否可用；
- 一次性 Tool Calling 是否可用；
- 原生文本流是否可用；
- 流式 Tool Calling 是否经过验证。

能力报告必须来自 Adapter 的真实实现与启动配置，不能因为存在兼容方法就对外宣称生产能力。

### 2.3 `ChatSession` 同时承担过多已出现的职责

`ChatSession` 当前同时协调 Turn 生命周期、请求上下文、Provider retry/stream、Tool Loop、Completion Gate、持久化、checkpoint 和观察事件。继续直接加入协议输出或未来能力会扩大单文件控制流。

本版只提取两个已经有现实边界的内部职责：

- `ModelStepRunner`：一次模型 Step 的 attempt、retry、stream/one-shot、assembler、snapshot 和终态；
- `RequestContextBuilder`：历史投影、checkpoint、Memory、TaskBrief、Prompt 与 Tool schema 的请求装配。

`ChatSession` 继续拥有 Turn、Tool 执行顺序、Completion Gate 与 Session 提交原子性。两项提取是内部实现边界，不新增通用服务容器或插件 seam。

### 2.4 生命周期、错误和诊断仍需统一

同一 Turn 在 CLI、NDJSON、Journal 和 Session Event 中必须具有一致的成功、失败、取消、blocked 与 retry 语义。Provider 私有错误不得成为通用协议；诊断不得记录用户正文、完整 Tool 参数、完整 Provider payload、凭据或 reasoning。

### 2.5 文档与版本存在收口债务

当前包版本、文档版本、架构完成条件和实际交付范围需要统一。v0.2.9 收口时必须清除过期声明，并把 v0.2 的能力矩阵作为后续版本的回归基线。

## 3. 目标

1. 将真实 Provider delta 传递为进程内 provisional model events；
2. 为 NDJSON 增加向后兼容的模型 Step 观察事件；
3. 在 TTY CLI 中展示真实增量，one-shot 路径保持一次性输出；
4. 统一流式与一次性模型 Step 的 attempt、retry、取消和终态语义；
5. 使用显式、只读的 Provider capability snapshot；
6. 提取 `ModelStepRunner` 与 `RequestContextBuilder`，保持最小 diff 和现有核心契约；
7. 统一稳定错误类别、安全诊断和协议终态；
8. 修正文档、版本与测试矩阵，形成 v0.2 最终基线。

## 4. 非目标

- 不实现 Local Provider Tool Calling 或本地流式；
- 不实现 token Context Budget 或新的 compaction 策略；
- 不引入 Shell、浏览器、MCP、并行 Tool、后台任务或子 Agent；
- 不引入 Agent Registry、Inbox、steering、Goal 或 Workflow；
- 不把 Session 改成 append-only 事件溯源；
- 不持久化 token delta 或失败回答正文；
- 不新增通用 middleware、依赖注入容器或动态插件生命周期；
- 不要求 OpenAI、DeepSeek 和未来 Local 具有相同能力；
- 不使用第二个模型评审回答质量。

## 5. Provider 能力快照

Runtime 使用最小显式结构描述当前已选择路由的真实能力：

```ts
interface ProviderCapabilities {
  readonly toolCalling: boolean;
  readonly nativeStreaming: boolean;
  readonly streamingToolCalls: boolean;
}
```

规则：

- 能力由 Provider Adapter 和显式启动配置共同决定；
- `nativeStreaming=true` 表示当前路由会产生 Provider 原生 delta；
- `streamingToolCalls=true` 只表示已实现且被允许使用，不代表所有模型都支持；
- one-shot fallback 不得报告原生流；
- DeepSeek Responses Tool streaming 在真实 HTTP 400 边界修复前默认保持关闭；
- Protocol `ready.capabilities` 与 Runtime 实际选择必须一致；
- capability snapshot 不包含 API Key、URL 凭据或私人配置内容。

本版不增加在线模型发现、启动付费探测或 Provider Registry。

## 6. Model Step 边界

`ModelStepRunner` 接收一个已经完成装配的不可变 `ModelRequest`，负责一个模型 Step 内的单次 attempt：

```text
request snapshot
→ attempt start
→ native stream 或 one-shot
→ 完整 ModelResponse / ToolResponse
→ attempt settlement
```

职责：

- 为每次 attempt 执行 one-shot 或 native stream；
- 流式与一次性路径归一化为现有完整响应；
- AbortSignal 贯穿流创建、迭代和 one-shot 请求；
- provisional delta 只通过观察回调传播；
- failed、cancelled、incomplete 和被 retry 的内容不进入 Session messages；
- request snapshot 仍保存实际模型请求的安全事实；
- 不执行 Tool、不判断 Completion Gate、不提交最终 assistant。

当前 retry policy 和 attempt Journal 仍由 `ChatSession` 持有；后续只有在不改变持久化语义的前提下，才考虑把 retry 编排继续下沉。

`ChatSession` 保留：

- 用户消息先持久化再调用模型；
- 完整 Tool Call assistant 与 Tool Result 成对提交；
- 候选 Yield 经过 Completion Gate；
- 最终 assistant 成功持久化后才能产生权威完成事件。

## 7. Request Context 边界

`RequestContextBuilder` 根据 Isla 已保存状态构造实际请求：

```text
StoredSession messages
+ ContextCheckpoint
+ retrieved Memory
+ TaskBrief
+ Prompt sections
+ visible Tool definitions
→ ModelRequest
```

约束：

- 任何发送给模型的消息必须能由 Session 状态、启动配置和确定性装配规则重建；
- Memory、checkpoint 与 TaskBrief 必须明确标记来源和信任边界；
- Tool schema 由当前 capability snapshot 决定；
- 该模块不调用 Provider、不修改 Session、不执行 Tool；
- 当前字符/Turn 投影保持不变，Context Budget 留待出现真实需求后独立设计。

## 8. 观察事件与权威提交

进程内新增或正式启用：

```ts
type ModelStepEvent =
  | { type: "model_step_start"; step: number; attempt: number }
  | { type: "model_delta"; step: number; attempt: number; text: string; provisional: true }
  | {
      type: "model_step_end";
      step: number;
      attempt: number;
      result: "capability_calls" | "candidate_yield" | "failed" | "cancelled" | "retry";
    };
```

规则：

- `model_delta` 只包含最终可见文本 delta，不包含 reasoning 或 Tool arguments；
- delta 不进入 StoredSession、Memory、Journal 正文或 request snapshot；
- retry 后旧 attempt 的 delta 不属于新 attempt；
- Completion Gate 拒绝候选 Yield 后不得产生 `response_end`；
- `response_end`、`response_cancelled` 和 `error` 仍是互斥的 Turn 终态；
- observer 或输出 sink 失败必须有明确策略，不能无界缓存或悄悄改变模型控制流。

## 9. NDJSON

新增向后兼容事件：

```json
{"type":"model_step_start","id":"p1","step":1,"attempt":1}
{"type":"model_delta","id":"p1","step":1,"attempt":1,"text":"...","provisional":true}
{"type":"model_step_end","id":"p1","step":1,"attempt":1,"result":"candidate_yield"}
```

要求：

- 现有请求和终态类型不变；
- 旧客户端忽略未知事件后仍能等待 `response_end`；
- `ProtocolWriter` 串行输出完整 JSON 行并遵守背压；
- 同一请求内事件顺序稳定；
- 取消进入 quiescence 后不再输出 delta；
- stdout 只输出协议，诊断继续走安全 stderr 或诊断通道。

## 10. CLI

- 仅当 stdin/stdout 是交互 TTY 且 Provider 原生流启用时实时展示 delta；
- 暂态文本必须与最终提交语义可区分；
- Tool Step、completion rejection、retry、失败和取消时正确结束当前显示行；
- 非 TTY 保持稳定的一次性输出，不加入 spinner 或控制字符；
- one-shot Provider 不做定时切片或打字机效果；
- 中文、多字节字符和跨 chunk Unicode 不损坏；
-最终返回值仍来自完整权威 response，而不是终端已打印内容。

## 11. 错误与诊断

稳定错误按最小领域归类：

```text
configuration
provider
protocol
session
persistence
approval
capability
security
cancelled
limit
```

本版不要求一次性重命名所有历史错误码。先建立分类函数或字段，保留兼容错误码，并逐项消除不必要的 `UNKNOWN`。

诊断只允许记录：

- 稳定错误码与领域；
- Provider/model 标识；
- step、attempt、finish reason；
- usage、耗时、delta 数量；
- 安全的能力布尔值。

禁止记录 API Key、Authorization、完整请求/响应 payload、完整正文、Tool arguments、reasoning 或私人会话内容。

## 12. DSH 参考取舍

采用：

- durable fact 与 live observation 分离；
- 模型完整消息与 provisional chunk 分离；
- request 在发送前冻结，取消保持 live；
- attempt 成功、失败、取消和 retry 都有明确 settlement；
- Provider Adapter、Agent Loop、Tool Runtime 和输出 Surface 分责；
- 能力声明必须对应实际 Provider 路由；
- 外部 UI/协议消费 live event，Session 只保存权威事实。

调整后采用：

- DSH 使用完整 Agent handle、Session Event Map 和 waterfall；Isla 使用 `ChatSession` 内部 runner/builder 与窄回调；
- DSH 保存完整 stream settlement；Isla 只保存组装后的有效 assistant 和安全 attempt 元数据；
- DSH 的 capability seam 跨多个 package；Isla 保持单 package 内显式接口。

暂缓：

- Session Query、compaction/token meter、Agent Registry、Inbox/steering；
- Goal、Job、Workflow、Subagent；
- Tool middleware、并行执行与通用 timeout policy；
-动态 Prompt contribution、per-agent scope 和在线 Provider capability discovery；
-事件重放、Session fork 和持久化 stream chunk。

拒绝：

- Cordis、monorepo package seam 和“万物皆插件”；
- 为 v0.3 假想能力重写 Session；
- 复制 DSH 源码、目录或命名；
- 让临时 observer 事件成为模型历史事实；
- 用完整回答切片制造假流式。

重新评估条件：只有出现第二种真实并发入口、长期活动资源或跨进程执行，才讨论 Agent Registry/Job；只有真实长会话或小窗口模型触发上下文压力，才讨论 Context Budget/compaction；只有能力需要独立安装与分发，才讨论更完整 capability manifest。

## 13. v0.2 最终不变量

1. 实际发送给模型的消息可由 Isla 状态重建；
2. user 消息在 Provider 调用前进入历史；
3. 只有有效、完整且成功持久化的 assistant 才进入权威历史；
4. Tool Call 与 Tool Result 完整配对；
5. Approval、取消和安全策略不能由模型绕过；
6. provisional delta 不等于最终回答；
7. one-shot 路径不伪造 streaming；
8. Provider 能力报告与实际路由一致；
9. CLI 与 NDJSON 共享同一 Runtime 语义；
10. 默认测试离线，真实 Provider 测试显式授权；
11. 凭据和私人内容不进入源码、测试、文档、日志或 Git 历史；
12. 部署方式和未来设备不渗透 Runtime 核心。

## 14. 完成信号

只有同时满足以下条件才可宣布 v0.2.9 与 v0.2 系列收口：

1. native streaming Provider 在进程内产生真实 model delta；
2. CLI 和 NDJSON 均能消费 provisional delta；
3. one-shot Provider 不产生假 delta；
4. Tool Step、completion rejection、retry、失败和取消不会产生错误权威终态；
5. `ModelStepRunner` 与 `RequestContextBuilder` 的边界由测试证明；
6. capability snapshot 与 Provider 实际路径一致；
7. Session、Journal、Memory、Approval、Web 与恢复无回归；
8. CLI/NDJSON 成功、失败和取消终态一致；
9. 当前文档、包版本和实际实现一致；
10. typecheck、全量离线测试、protocol e2e、build、pack、diff check 与隐私扫描通过；
11. 用户明确授权后的真实 Provider 评估单独报告，未授权不阻塞离线实现；
12. 没有借收口版本引入非目标能力。
