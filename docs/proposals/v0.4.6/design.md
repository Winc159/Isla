# v0.4.6 设计

## 1. 问题与原则

v0.4.3 已按轮次和字符数压缩历史，但字符预算无法表达模型的硬 Token 窗口，也没有为回答预留空间。百炼 `GET /api/v1/models` 已返回 `context_window`、`max_input_tokens` 和 `max_output_tokens`，当前 Isla 也已读取这些字段，但它们尚未参与请求预算。

本版遵守以下原则：

1. Session messages 仍是完整持久化事实源，预算只改变请求投影。
2. 模型硬限制、Profile 工作预算和运行时预留取更严格值。
3. 普通启动不为获取模型目录强制联网；缓存缺失时继续使用现有字符预算。
4. 估算结果必须标注为估算，不伪装成 Provider 精确计数。
5. 当前用户输入不能被静默截断；单次输入无法容纳时明确拒绝。

## 2. 模型限制契约

统一目录条目中的限制字段，不把百炼字段泄漏进 Session 核心：

```ts
interface ModelLimits {
  readonly contextWindow?: number;
  readonly maxInputTokens?: number;
  readonly maxOutputTokens?: number;
  readonly maxReasoningTokens?: number;
  readonly reasoningMaxInputTokens?: number;
  readonly reasoningMaxOutputTokens?: number;
}

interface ResolvedModelLimits extends ModelLimits {
  readonly source: "live" | "cache" | "stale" | "profile" | "fallback";
  readonly model: string;
  readonly fetchedAt?: string;
}
```

所有数值必须为正整数。未知、`null`、矛盾或无法验证的值按未知处理并产生非敏感诊断；不能以 `0` 代表无限制。

百炼目录负责投影官方字段。其他 Provider 只有在已有官方目录或真实需求时才增加适配，不为 OpenAI-compatible 接口猜测模型限制。

## 3. Profile 工作预算

在现有 `profile.runtime` 中增加可选字段：

```json
{
  "runtime": {
    "maxContextTokens": 12000,
    "maxOutputTokens": 2048,
    "contextReserveTokens": 512
  }
}
```

- `maxContextTokens`：Isla 允许发送的工作输入预算，不代表模型硬上限。
- `maxOutputTokens`：本次生成的最大 completion 预算。
- `contextReserveTokens`：为 Provider 包装、估算误差和协议字段保留的安全空间。
- 现有 `maxContextTurns`、`maxContextChars`、`contextRetainTurns` 继续有效，并与 Token 预算共同约束。

首版不自动把模型标称窗口全部用于工作上下文。若 Profile 未设置 Token 工作预算，但目录存在硬限制，使用保守默认工作预算；默认值作为命名常量并在实施前由固定测试锁定，不能散落为魔法数字。建议起点：输入 16K、输出 2K、安全预留 512；最终输入仍不得超过模型硬限制。

## 4. 有效预算解析

对每次启动得到不可变的 `ContextBudgetPolicy`，Session 中途不因目录刷新改变：

```text
effectiveOutput = min(
  profile.maxOutputTokens ?? defaultOutput,
  model.maxOutputTokens ?? infinity
)

windowInput = model.contextWindow
  ? model.contextWindow - effectiveOutput - reserve
  : infinity

effectiveInput = min(
  profile.maxContextTokens ?? defaultWorkingInput,
  model.maxInputTokens ?? infinity,
  windowInput
)
```

若无法得到任何可信 Token 限制，则 `tokenBudget` 为 unavailable，继续使用字符和轮次预算，不阻断启动。若解析结果小于等于零，配置失败并指出冲突字段。

目录来源优先级为：本次显式 refresh/live → 当前身份对应的有效 cache → stale cache（仅作提示和保守参考）→ Profile 工作预算 → fallback。API Key、Workspace ID 和目录请求头不得进入限制快照或诊断。

## 5. 保守 Token 估算

首版采用单一、确定、无依赖的估算器，而不加载厂商 tokenizer：

```text
contentEstimate = max(
  ceil(UTF-16 字符数 / 2),
  ceil(UTF-8 字节数 / 3)
)
```

消息角色、Tool Call ID、Tool arguments、Tool schema、response format、checkpoint、Memory、Task State 和其他请求时注入内容必须计入固定或结构化开销。最终报告同时给出 `estimatedTokens`、`maxInputTokens`、`reserveTokens` 和 `estimator: conservative-v1`。

该估算器用于提前保护和可重复测试，不宣称等于服务端 tokenizer。只有真实模型出现系统性误差并有官方 tokenizer 可复用时，才评估 Provider-specific estimator。

## 6. 请求前预算顺序

请求装配顺序固定为：

1. 从完整 Session 事实构建当前候选投影。
2. 应用现有轮次、字符和 checkpoint 规则。
3. 加入本次真实 Tool schema、Memory、Task State 等 host context。
4. 估算完整 `ModelRequest`，而不是只估算聊天正文。
5. 若超出 Token 工作预算，继续按完整 Conversation Unit 压缩已闭合旧轮次。
6. 若只剩系统约束和当前轮仍超限，返回稳定的 `CONTEXT_INPUT_TOO_LARGE`，不调用 Provider、不截断当前输入。
7. 将 `effectiveOutput` 作为 `maxCompletionTokens` 发送给 Provider。

不能拆开 assistant tool call 与对应 tool result。压缩失败时沿用 v0.4.3 的原始投影回退，但回退结果仍必须通过硬预算检查；不能为了“尽量回答”发送已知超限请求。

## 7. Provider 请求契约

`ModelRequest` 增加可选 `maxCompletionTokens`。Provider 只负责协议映射：

- 百炼/OpenAI-compatible 优先发送 `max_completion_tokens`；
- 已验证仅接受 `max_tokens` 的 Provider 由其 Adapter 明确映射；
- 不支持输出限制的 Provider 必须在 capability/诊断中说明，不能悄悄发送未知字段；
- Provider 返回 context-length 错误时归一化为稳定 limit domain，禁止对相同请求无意义重试。

本版不把采样温度、`top_p`、thinking budget 或模型路由混入上下文预算。

## 8. 用户可见诊断

扩展而不破坏现有命令：

- `/models info <model-id>`：显示目录来源、上下文窗口、最大输入、最大输出及已知 feature；未知字段显示“未提供”。
- `/context`：增加估算 Token、有效输入预算、输出预留、限制来源和最近一次压缩原因；不得展示私人正文。
- NDJSON/Resident Host 使用同一只读投影，不各自重新计算预算。

普通 `/models` 仍最多显示十行；普通启动不自动刷新目录。切换模型仍为下次启动生效，因此本次 Session 的预算快照不会漂移。

## 9. 兼容与失败语义

- 未配置新字段的旧 Profile 可继续启动。
- 旧模型目录缓存缺少限制字段时正常读取。
- 未知模型或无目录 Provider 继续受轮次/字符预算保护。
- 非法 Profile 数值在配置阶段失败，不推迟到模型调用。
- stale cache 必须可见，但不得比用户显式 Profile 上限更宽松。
- 限制解析与估算不写入 Session 正文，只进入非敏感状态和 Journal 元数据。

## 10. 偏离条件

若实施需要引入完整 tokenizer 包、为大量模型维护静态注册表、自动切换模型、修改 Session schema 或后台总结队列，应停止并重新确认范围。若真实评估证明保守估算仍频繁触发 Provider 超限，再单独设计 Provider-specific token counting。
