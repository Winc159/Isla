# Isla v0.3.0 架构：Bailian Provider and Model Discovery

状态：已实现并完成基线收口

前置基线：v0.2.9 Runtime Consolidation

日期：2026-09-15

## 1. 现实问题

Isla 当前直接支持 OpenAI、DeepSeek 与 Local Provider。阿里云百炼同时托管 Qwen、DeepSeek、GLM、Kimi、MiniMax 等模型，如果按模型家族建立 Provider，会把平台认证、地域地址、协议和模型差异重复实现，也无法合理承载百炼动态增长的模型目录。

当前 Profile config 与完整 env 配置又形成两套并列入口。继续为新 Provider 扩展两套字段会增加日常维护、文档和测试负担。

v0.3.0 因此解决三个已经出现的需求：

1. 以百炼平台而不是 Qwen 模型命名 Provider；
2. 以本地 Profile config 作为日常启动配置的唯一事实源；
3. 通过百炼官方模型 API 发现当前账号和地域可用模型，而不是在代码中维护静态列表。

## 2. 官方接口事实

百炼提供 OpenAI-compatible Chat Completions、OpenAI-compatible Responses、Anthropic-compatible Messages 与 DashScope 原生接口。v0.3.0 首条生产路径选择 Chat Completions，因为它与 Isla 当前完整消息历史、Tool Call/Result 配对和请求可重建契约直接匹配。

百炼官方提供 `GET /api/v1/models`，支持分页并返回模型 ID、模型作者、推理服务商、capabilities、features、上下文窗口与价格。地域、API Key、模型可用范围和 Base URL 相互关联，不能由 Runtime 猜测。

官方参考：

- https://help.aliyun.com/zh/model-studio/what-is-model-studio/
- https://help.aliyun.com/zh/model-studio/base-url
- https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions
- https://help.aliyun.com/zh/model-studio/list-models
- https://help.aliyun.com/zh/model-studio/qwen-function-calling

## 3. 身份与职责

三层身份必须分离：

```text
Provider platform: bailian
Protocol path: OpenAI-compatible Chat Completions
Model: qwen / deepseek / glm / kimi / minimax / other model ID
```

`BailianProvider` 负责：

- API Key 与 Base URL；
- Chat Completions 请求和响应转换；
- timeout、AbortSignal、usage 与错误归一化；
- Provider capability snapshot。

模型 ID 负责选择一次运行使用的模型。模型族差异只有在官方规则或真实请求证明存在时，才进入窄兼容策略；不得为每个模型创建 Provider，也不得预建完整模型策略框架。

## 4. 配置事实源

`~/.isla/config.json` 的 Profile 是正常用户启动的唯一配置事实源。Profile 保存完整启动快照，包括 provider、model、API Key、Base URL、workspace、runtime、memory、tools 与 appearance。

环境变量只用于：

- `--env` 显式开发/CI兼容入口；
- 真实 smoke 的显式开关；
- 测试配置路径与临时目录。

正常 Profile 启动不得隐式字段级合并 env；缺少必填字段必须在网络请求前失败。v0.3.0 不立即删除已有 `--env`，先把它降级为开发兼容入口，避免破坏现有脚本。

建议的 Bailian Profile：

```json
{
  "provider": "bailian",
  "model": "qwen3.8-max",
  "apiKey": "<local-secret>",
  "baseURL": "https://<workspace-id>.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
}
```

Base URL 必须显式配置；Isla 不硬编码北京地域、不推断 Workspace ID，也不在失败时切换共享域名、地域或 Provider。

## 5. Batch A：平台文本路径

Batch A 只增加 Bailian Chat Completions 普通文本回答：

```text
RequestContextBuilder
→ ModelStepRunner
→ BailianProvider.generate()
→ POST {baseURL}/chat/completions
→ 完整 ModelResponse
→ 现有 Agent Loop / Completion Gate / Session commit
```

初始能力声明：

```ts
{
  toolCalling: false,
  nativeStreaming: false,
  streamingToolCalls: false
}
```

Batch A 不发送 Tools，不产生假 delta，不接入 Responses API，也不改变 Session、Journal、NDJSON 终态和 Runtime 核心契约。

## 6. Batch B：模型目录

模型发现是应用层只读服务，不属于 `ModelProvider.generate()`，也不进入模型可见历史。

```ts
interface ModelCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly provider?: string;
  readonly inferenceProvider?: string;
  readonly capabilities: readonly string[];
  readonly features: readonly string[];
  readonly contextWindow?: number;
  readonly maxInputTokens?: number;
  readonly maxOutputTokens?: number;
}
```

模型目录要求：

- 调用地域对应的 `/api/v1/models`；
- 支持分页、名称搜索和确定性排序；
- 提供 TTY 与无 TTY 等价路径；
- 可保存不含凭据的最近成功缓存；
- 查询失败不阻断已配置模型启动；
- 不自动修改 Profile，不在会话中动态切换模型；
- 不把 price 或模型描述解释成固定免费额度；
- 不把目录中的 capability/feature 直接等同于已经真实验证的 Runtime Tool/streaming 能力。

普通启动不强制刷新目录。刷新必须由用户命令、首次模型选择或显式自动化请求触发。

## 7. Batch C：首个 Qwen Tool Calling

Batch C 选择一个官方明确支持标准 Function Calling、且用户配置中可用的 Qwen 模型，增加 one-shot Tool Loop：

```text
messages + tools + tool_choice
→ 完整 Chat Completion
→ structured tool_calls
→ 现有 Tool Runtime / Approval
→ assistant tool-call + tool result
→ 下一 Model Step
```

通过离线 fixture 与真实 smoke 后，该已验证路由才声明：

```ts
{
  toolCalling: true,
  nativeStreaming: false,
  streamingToolCalls: false
}
```

未知模型、存在额外请求字段要求的模型族或未通过验证的路径保持保守能力。GLM、Kimi 等真实差异出现时增加窄策略，不修改 Provider 身份。

## 8. Batch D：候选 streaming

Streaming 不属于 v0.3.0 前三批完成条件。只有同时满足以下条件才开始：

1. 官方协议给出目标模型的 SSE 事件形状；
2. 文本、Tool Call、usage、终态和取消具有离线 fixture；
3. 真实文本流通过；
4. Tool streaming 真实通过后才声明 `streamingToolCalls=true`；
5. 继续复用现有 `ModelStreamAssembler`，不复制 OpenAI Provider 后改名。

## 9. 共享协议代码边界

只有 DeepSeek 与 Bailian 实际共同使用且语义相同的纯转换才允许抽取，例如 Chat messages、Tool schema、tool choice、usage 与结构化 Tool Call 转换。Provider 特有的 endpoint、thinking、DSML、模型策略和错误上下文留在各自 Adapter。

不引入 Provider 基类、服务定位器、协议注册中心或多层继承。

## 10. 安全与隐私

- API Key 只存在于本地私有配置和内存中的已解析启动快照；
- 不输出 Authorization、完整 Provider payload、私人消息或完整模型目录响应；
- 模型目录缓存不保存凭据、请求 header 或账号标识；
- 真实请求必须同时具备显式开关、有效本地配置和用户授权；
- 需要用户配置时提供可复制模板，但不得要求用户把 API Key 粘贴到对话中；
- 用户只需在本地完成配置并告知“已配置”。

## 11. 非目标

- 不为每个模型创建 Provider；
- 不实现会话内动态模型路由；
- 不启用百炼智能模型路由；
- 不接入 Responses 内置 Web、MCP、Code Interpreter；
- 不接入 DashScope 原生生成协议；
- 不实现多模态、Embedding、Rerank、图像、音视频；
- 不新增并行 Tool、子 Agent、后台任务或通用 capability registry；
- 不把模型目录变成启动硬依赖；
- 不自动消费所谓免费额度，也不根据价格自动轮换模型。

## 12. 完成信号

v0.3.0 前三批完成需要：

1. Bailian 普通文本请求离线与授权真实 smoke 通过；
2. Profile 为文档和正常 CLI 的唯一日常配置入口；
3. 官方模型目录可由 TTY 与无 TTY 路径查询；
4. 目录失败不影响已配置模型启动；
5. 一个 Qwen 模型的 one-shot Tool Loop 通过离线与授权真实验证；
6. 能力声明与实际验证路径一致；
7. OpenAI、DeepSeek、Local、Session、Tool、取消、CLI 和 NDJSON 无回归；
8. typecheck、全量离线测试、build、pack、diff check 与隐私扫描通过；
9. 文档和实际 Batch 状态一致。

## 13. 实际落地说明

v0.3.0 最终落地包含 Bailian Chat Completions、one-shot Tool Loop、可选普通文本 streaming、官方模型目录、非敏感缓存、TTY/无 TTY/NDJSON 模型入口，以及只对下次启动生效的 Profile 模型保存。

与最初设计相比，当前实现存在一项已知偏差：`toolCalling` 目前按 Bailian Provider 声明为 `true`，尚未实现第 7 节设想的按模型 ID 和验证记录收窄能力。真实 Qwen 路径已经验证，但这不能证明 Bailian 目录中的所有模型都支持同一 Tool 协议。后续统一 Provider Model Catalog 或模型能力策略设计必须重新处理这一点；本次收口不扩大或重写现有契约。

普通文本 streaming 只有在 Profile `streaming=true` 时启用。由于 `streamingToolCalls=false`，带工具的请求由 `ModelStepRunner` 自动回退到稳定的 one-shot 路径，流中即使存在 Tool Call delta 解析能力也不会被当前 Agent Tool Loop 使用。
