# Isla v0.1.6 Tool Runtime 与 Approval

## 目标

在保持单 package、CLI 优先和现有只读文件能力可用的前提下，建立最小的 Tool Runtime 边界，并为后续敏感能力提供可验证的 Approval 入口。

本版本先完成结构和只读路径的迁移，不新增写文件、Shell、网络或其他敏感 Tool。

## 采用

### Prompt Registry

Prompt 由静态 `PromptRegistry` 管理。每个 section 声明唯一 `id`、排序值和 `render(context)`，组装时按 `order` 稳定排序。

当前 section 保持最小范围：

- identity：基础人格；
- runtime-policy：运行时行为约束；
- capability sections：已安装能力的使用说明。

现有 `composeRequestMessages()` 的外部行为保持不变：没有能力时保留原始会话 system message；启用能力时增加 Isla 的基础 system sections 和能力说明。

### Tool Registry

Runtime 持有 `ToolRegistry`，Capability 通过插件上下文注册 Tool 和 Prompt，不再由 `ChatSession` 创建具体文件 Tool。

```ts
interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema;
}

interface Tool {
  readonly definition: ToolDefinition;
  readonly permission: ToolPermission;
  execute(argumentsJson: string, context: ToolExecutionContext): Promise<ToolResult>;
}
```

注册表只负责注册、按名称查找和导出当前可见 definitions；不负责动态加载、作用域覆盖或依赖注入。

### Tool Runtime

所有模型 Tool Call 统一经过以下流程：

```text
查找 Tool
→ 解析并校验参数
→ 检查权限策略
→ 必要时请求 Approval
→ 执行 Tool
→ 规范化结果
→ 回填 Agent Loop
```

执行结果不得让 Tool 异常直接穿透 Agent Loop：

```ts
type ToolExecutionResult =
  | { readonly ok: true; readonly content: string }
  | {
      readonly ok: false;
      readonly code:
        | "UNKNOWN_TOOL"
        | "INVALID_ARGUMENTS"
        | "PERMISSION_DENIED"
        | "USER_REJECTED"
        | "EXECUTION_FAILED";
      readonly message: string;
    };
```

失败结果作为 tool message 回填模型，由模型决定是否修正、改用其他 Tool 或说明失败。

### Approval

Approval 是用户同意，Sandbox 是执行边界；两者不互相替代。

```ts
type ToolPermission =
  | { readonly kind: "none" }
  | { readonly kind: "filesystem-read" }
  | { readonly kind: "filesystem-write" }
  | { readonly kind: "command-execute" }
  | { readonly kind: "network" };

type ApprovalPolicy = "never" | "ask" | "always";

interface ApprovalRequest {
  readonly toolName: string;
  readonly permission: ToolPermission;
  readonly summary: string;
  readonly details?: string;
}

type ApprovalDecision =
  | { readonly approved: true }
  | { readonly approved: false; readonly reason?: string };
```

策略语义固定为：

- `never`：拒绝需要 Approval 的动作；
- `ask`：每次请求用户确认；
- `always`：在既定执行边界内自动允许。

Tool Runtime 默认使用 `never`，因此没有显式接入审批服务时，敏感动作会被拒绝。`ask` 的默认答案为拒绝。非交互环境无法询问时拒绝。Tool 不直接读取终端，CLI 通过 `ApprovalService` 提供交互实现。

### 初始权限预设

只提供两个预设：

```ts
readonly:  filesystem-read allow; filesystem-write deny; command-execute deny; network deny
workspace: filesystem-read allow; filesystem-write ask; command-execute ask; network ask
```

当前 `list_directory` 与 `read_text_file` 使用 `filesystem-read`，并受项目根目录、路径规范化、目录穿越和明显秘密文件限制。

本版本不提供 `danger-full-access`，也不把用户批准一次解释为永久开放权限。

### Session Event

模型可见内容必须能从 Isla 会话状态重建。v0.1.6 引入最小事件类型：

```ts
type SessionEvent =
  | UserMessageEvent
  | AssistantMessageEvent
  | ToolCallEvent
  | ToolResultEvent
  | ApprovalEvent;
```

Provider 请求由事件投影生成：

```text
Session events → projectModelMessages() → ModelRequest
```

现有持久化格式暂不立即升级为数据库；事件先作为进程内会话状态和 JSON 可兼容结构演进。用户消息只有在进入会话状态后才调用 Provider；只有有效且成功持久化的最终 assistant 回答才成为对话历史的一部分。

## 暂缓

- 写文件、Shell、删除、网络和外部消息 Tool；
- 真正的 Sandbox 实现；
- Cordis、waterfall、scoped layers 和多 package；
- Tool 并行执行、后台任务、PTC、MCP、子 Agent；
- 动态插件扫描、安装、卸载和插件市场；
- SQLite、数据库迁移、长期记忆和跨设备同步；
- OpenAI 与 Local Provider 的 Tool API 扩展，除非出现真实需求。

## 实施顺序

1. 新增 PromptRegistry，保持当前 prompt 输出行为。
2. 新增 ToolRegistry，并将 project-files 改为 Runtime 安装的 Capability。
3. 新增 ToolRuntime，Agent Loop 只依赖它，并把失败规范化为 Tool 结果。
4. 引入 ApprovalService、CLI 实现、策略和两个权限预设；为只读 Tool 保持自动允许。
5. 补齐 Session Event 的调用、审批和结果记录，并验证模型请求可重建。
6. 完成迁移后，再评估 `write_text_file` 作为第一个敏感 Tool。

## 重新评估条件

- 出现第二类需要权限判断的 Tool 时，重新检查 `ToolPermission` 是否足够；
- 需要恢复中断中的 Tool Loop 时，升级事件持久化和重放契约；
- Capability 数量造成 Prompt 或 Tool definitions 明显膨胀时，再引入能力路由；
- 出现真实跨 Provider Tool API 需求时，扩展 Provider 契约。
