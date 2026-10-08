# v0.4.8 设计

## 1. 当前问题

Isla 已有 `ToolCapability`、Capability Factory、Tool Registry、Tool Runtime、Capability Snapshot 和 MCP Capability，但组合发生在 Session 创建阶段：

- `SessionFactory` 一次性创建内置、Browser 和 MCP Capability。
- `ChatSession` 构造时把全部允许的 Tool 注册进固定 Registry。
- Agent Loop 在开始时取得一次 Tool Definition 集合。
- 当前按意图缩减工具只在请求超过 token 预算时触发，是保护性回退，不是正常路由。
- MCP Host 启动时连接全部已配置 Server，并取得完整 Tool Catalog。

工具数量增长后，这会让无关 Schema 占用上下文、干扰模型选择，并把配置、权限、生命周期和可观测性挤在 Session Factory 中。

## 2. 外部参考与取舍

本设计参考以下原始资料，查看日期为 2026-09-29：

- [DeepSeek Harness Tool Schema Catalog](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/tool-catalog.md)
- [DeepSeek Harness Skill Registry](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/skill/README.md)
- [DeepSeek Harness model-facing Skill loader](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/tool-skill/README.md)
- [LangChain LLM Tool Selector Middleware](https://github.com/langchain-ai/langchain/blob/master/libs/langchain_v1/langchain/agents/middleware/tool_selection.py)
- [Semantic Kernel Function Choice filtering sample](https://github.com/microsoft/semantic-kernel/blob/main/python/samples/concepts/auto_function_calling/functions_defined_in_yaml_prompt.py)
- [AutoGen Workbench proposal](https://github.com/microsoft/autogen/issues/4721)
- [MCP SEP-1821 Dynamic Tool Discovery draft](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1821)

### 2.1 DeepSeek Harness

DSH 的 Tool Catalog 会通过真实插件启动生成完整 schema 文档；其 Skill 系统进一步区分摘要目录与正文加载：Registry 合并多个 Provider 的摘要，模型先看到有界目录，再按名称加载完整 Skill。Registry 负责合并、冲突和验证，Provider 负责来源与加载。

Isla 采用：

- Provider 与 Registry/Catalog 分责。
- 摘要发现与完整执行定义分离。
- 加载时重新验证，不能信任陈旧目录项。
- 目录失败不破坏其他可用 Provider。
- 稳定身份、确定性冲突处理和有界描述。

Isla 调整：

- 复用单 package 内现有 `ToolCapability`，不用 Cordis service graph。
- Catalog 是 Host-owned 只读事实；Task Activation 是 Session 内状态。
- 不提供模型可调用的插件安装、启停或 Profile 修改入口。

Isla 拒绝：

- 复制 DSH 插件树、bundle/overlay、HMR 和动态 npm 安装。
- “万物皆插件”以及为了 v0.4.8 拆成 monorepo package。

### 2.2 LangChain / Deep Agents

LangChain 的 Tool Selector Middleware 在每次模型调用前拦截请求，用候选工具名称和描述选择子集；Deep Agents middleware 也允许在调用前动态过滤 Tool。它证明动态暴露的正确边界是 Model Request，而不是 Session 创建。

Isla 采用每 Step 请求前过滤的边界，但首版不增加额外 LLM 路由调用。原因是额外模型调用会引入费用、延迟、解析失败和新的可观测性要求；Isla 先使用确定性 Resolver 与模型元工具补充发现。

### 2.3 Semantic Kernel

Semantic Kernel 支持通过 included functions 过滤本次 Function Calling 集合。Isla 采用“已注册能力与本次模型可见函数集合分离”的原则，不采用 Kernel/Plugin 容器。

### 2.4 AutoGen Workbench 与 MCP 动态检索

AutoGen Workbench 的工具池方案把列举、按上下文选择、查询和启停分开；MCP SEP-1821 则提出为 `tools/list` 增加 query，但截至本设计仍是无 sponsor 的 Draft。

Isla 采用 Workbench 的职责划分作为概念参考，但不引入动态 Tool 池抽象；MCP 首版继续兼容完整 `tools/list`，不依赖草案协议。只有标准稳定且真实 MCP 大目录证明 Host 侧过滤不足时再评估 Server-side search。

## 3. 核心模型

### 3.1 稳定身份

```ts
type CapabilityId = string;

// 示例
// builtin.project
// builtin.browser
// builtin.web
// builtin.context
// builtin.session-history
// builtin.skill
// mcp.filesystem
```

Capability ID 是 Journal、Activation State 和诊断中的持久身份。现有 Provider Tool 名在 v0.4.8 保持兼容，例如 `browser_open`、`read_text_file`、`mcp__filesystem__read_file`；首版不强制把完整 Capability Namespace 编码进模型可见 Tool 名，避免破坏 Provider 名称限制、旧 Session 和测试。

### 3.2 Manifest

```ts
interface CapabilityManifest {
  readonly id: CapabilityId;
  readonly version: string;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly toolSummaries: readonly CapabilityToolSummary[];
  readonly activation: "eager" | "lazy";
  readonly lifetime: "host" | "session" | "task";
  readonly requirements: CapabilityRequirements;
  readonly risk: "read" | "workspace-write" | "external-side-effect" | "secret";
}

interface CapabilityToolSummary {
  readonly name: string;
  readonly description: string;
}

interface CapabilityRequirements {
  readonly toolCalling?: true;
  readonly platforms?: readonly NodeJS.Platform[];
  readonly configKeys?: readonly string[];
}
```

Manifest 不包含 Tool JSON Schema、secret、cwd、命令参数、Skill 正文或 MCP 原始 instructions。`toolSummaries` 必须有数量和字符预算。

### 3.3 Provider

```ts
interface CapabilityProvider {
  readonly manifest: CapabilityManifest;
  status(context: CapabilityStatusContext): CapabilityAvailability;
  activate(context: CapabilityActivationContext): Promise<ToolCapability>;
}
```

Provider 是受信任的 Host 组合对象，不是可执行文件路径，也不接受模型提供的模块名。内置 Provider 包装当前 Capability Factory；MCP Provider 只包装 Profile 已明确配置且 Host 已发现的 Server。

### 3.4 Catalog

`CapabilityCatalog` 是 Host-owned，只负责：

- 注册受信任 Provider。
- 按稳定 ID 查询 Manifest 与 Availability。
- 有界关键词搜索。
- 确定性排序和重复 ID 拒绝。
- 输出安全诊断。

Catalog 不执行 Tool、不决定 Approval、不修改 Profile，也不持有 Task 激活状态。

## 4. Resolver 与策略

```ts
interface CapabilityResolution {
  readonly selected: readonly CapabilityId[];
  readonly rejected: readonly CapabilityDecision[];
  readonly reasons: readonly CapabilityDecision[];
}
```

首版 Resolver 只使用受信任状态：

1. 当前用户输入。
2. 当前 Task State 的 goal、steps 和已激活 Capability ID。
3. 本 Turn 已成功使用的 Tool 所属 Capability。
4. Profile allow/deny 与预算。
5. Provider tool-calling 能力、平台和配置状态。

优先级固定：

```text
deny / 不可用
→ Provider 与平台要求
→ 常驻 Capability
→ Task 已激活 Capability
→ 当前输入的确定性候选
→ 数量与 schema 预算
```

网页、Tool Result、Skill 正文和 assistant 自然语言不得作为策略指令。它们可以成为搜索 query 的普通数据，但不能扩大 allowlist 或风险等级。

首版路由使用显式关键词与 Tool/Capability 元数据。Embedding、独立路由模型和自动学习在真实评测证明规则不足前暂缓。

## 5. 激活状态

```ts
interface CapabilityActivationStateV1 {
  readonly version: 1;
  readonly task: readonly ActivatedCapability[];
}

interface ActivatedCapability {
  readonly id: CapabilityId;
  readonly activatedAtTurn: number;
  readonly reason: "runtime" | "model" | "user";
  readonly lastUsedAtTurn: number;
}
```

首版只实现 Task 级显式激活：

- 常驻 Capability 不写入 task 数组。
- Runtime 预选和 `capability_activate` 都通过同一 Activator。
- 激活是幂等的。
- Session 恢复时重新检查 Catalog、Profile 与 Availability；陈旧激活不能绕过当前策略。
- v0.4.8 不实现按时间自动卸载。Task 完成后新任务不继承非显式需要的激活项。

## 6. 三个元工具

### `capability_search`

输入：短 query，可选 limit，最大值由 Runtime 固定。

输出：Capability ID、短描述、状态、风险等级和是否需要配置；不返回 Tool Schema，不自动激活。

### `capability_activate`

输入：一个完整 Capability ID。

执行顺序：Catalog 查找 → Availability → Profile/Provider/平台过滤 → 激活 → 记录状态。成功只保证下一 Model Step 可重新考虑该能力，不代表具体 Tool 调用已获 Approval。

### `capability_status`

输入：可选 Capability ID。

输出：常驻、已激活、可用、不可用、禁止和需要配置的安全摘要。不得返回 secret 或原始配置值。

三个工具属于 `builtin.capability-routing`，始终可用，但只有 Provider 确认支持结构化 Tool Calling 时才对模型暴露。不支持 Tool Calling 时 CLI/NDJSON 给出明确诊断，不能声称动态能力可用。

## 7. 每 Model Step Snapshot

当前 Agent Loop 在循环前固定 `tools`。v0.4.8 改为每次 `generateModel` 前执行：

```text
resolve current state
→ activate/reuse trusted providers
→ build active Tool Registry view
→ compose immutable Step Snapshot
→ send exactly snapshot.toolDefinitions
```

Snapshot 升级时至少记录：

- 当前 Step。
- 完整 Capability ID。
- Tool 公开名。
- 选择来源与原因码。
- 拒绝/不可用原因码。
- Tool 数、schema bytes、估算 schema tokens。
- 稳定 hash。

请求快照继续保存实际发送的 `tools`，Capability Snapshot 保存选择语义。两者共同满足重建要求。Snapshot 变化不修改历史请求。

`capability_activate` 的 Tool Result 加入当前消息后，下一 Step 重新生成 Snapshot。激活不会创建新 Turn，也不会重置 Loop Budget、Completion Gate、重复调用计数或上下文预算。

## 8. 生命周期

- Host：BrowserRuntime、McpHost、Vault、CapabilityCatalog、Provider 对象。
- Session：Catalog 的只读视图、当前 Profile/Provider 能力事实。
- Task：Activation State。
- Turn/Step：Resolver 输入与不可变 Snapshot。

首版 MCP Host 仍按启动 Profile 连接 Server。只有 Tool Schema 按需暴露；不能把“Schema 未暴露”误写为“Server 未启动”。后续若实现 MCP acquire/release，必须单独设计 required Server、并发 Session、崩溃恢复和诊断语义。

## 9. Permission 与安全

顺序必须确定：

1. Catalog 中存在且 Provider 受信任。
2. Profile allow/deny。
3. Provider tool-calling、平台和配置要求。
4. Capability 激活。
5. Step Snapshot 预算。
6. Tool 调用时继续经过现有 Permission、Approval 和 Sandbox。

搜索结果、模型选择和用户批准某次 Tool 调用都不能修改前四项。Capability 激活不得提前批准其内部 Tool。

## 10. 可观测性

稳定原因码至少包括：

- `CAPABILITY_SELECTED_RESIDENT`
- `CAPABILITY_SELECTED_TASK_ACTIVE`
- `CAPABILITY_SELECTED_INTENT`
- `CAPABILITY_DENIED`
- `CAPABILITY_UNAVAILABLE`
- `CAPABILITY_REQUIRES_TOOL_CALLING`
- `CAPABILITY_REQUIRES_CONFIG`
- `CAPABILITY_PLATFORM_UNSUPPORTED`
- `CAPABILITY_BUDGET_EXCEEDED`
- `CAPABILITY_UNKNOWN`

TTY 与 NDJSON 应能回答：为何选中、为何拒绝、本 Step 注入多少 Tool、schema bytes/tokens，以及激活是否在下一 Step 生效。

## 11. 兼容与迁移

- 旧 Profile 未配置动态路由时，默认启用新路由，但保持现有 Capability allow/deny 语义。
- 旧 Session 无 Activation State 时从空状态迁移。
- Tool 名与 Tool 参数 Schema 首版保持兼容。
- `CapabilitySnapshot.version` 升级必须有旧版本读取策略。
- `/capabilities` 与 `capabilities_list` 保持只读，并扩展为 Catalog/Activation/Snapshot 视图，不移除旧字段。

## 12. 明确暂缓与偏离条件

暂缓：MCP 子进程懒启动、自动卸载、热更新、第三方本地插件清单、语义检索、独立路由模型、跨 Session 激活共享。

若实现需要以下任一行为，Luna 必须停止并先更新设计：

- 修改现有 Tool Permission/Approval 语义。
- 从网页或 Tool Result 解析策略变更。
- 运行时加载任意模块或安装依赖。
- 为动态路由重写 Provider 或整个 Agent Loop。
- 依赖 MCP SEP-1821 或其他未稳定协议。
- 在没有迁移策略时修改持久 Session/Journal 契约。
