# Isla v0.1.6 Tool Runtime 与 Approval

## 目标

在保持单 package、CLI 优先和现有只读文件能力可用的前提下，建立最小的 Tool Runtime 边界，并为后续敏感能力提供可验证的 Approval 入口。

本版本完成 Tool Runtime、Approval、最小文件沙盒和第一个敏感 Tool `write_text_file`。Shell、网络和外部消息仍不实现。

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

Tool Runtime 默认使用 `never`，因此没有显式接入审批服务时，敏感动作会被拒绝。`ask` 的默认答案为拒绝。非交互环境无法询问时拒绝。Tool 不直接读取终端，CLI 通过 `CliApprovalService` 提供 raw 单键交互。

交互式 CLI 的审批选项为：

- `y`：批准本次调用；
- `n`、Enter 或 Esc：拒绝本次调用；
- `a`：当前 Isla 进程内自动批准同一工具和权限的后续调用，不写入永久配置。

### 初始权限预设

只提供两个预设：

```ts
readonly:  filesystem-read allow; filesystem-write deny; command-execute deny; network deny
workspace: filesystem-read allow; filesystem-write ask; command-execute ask; network ask
```

当前 `list_directory` 与 `read_text_file` 使用 `filesystem-read`，`write_text_file` 使用 `filesystem-write`。`workspace` 预设自动允许读取，写入仍需审批。

### 最小文件沙盒

`SandboxPolicy` 负责文件能力的执行边界，不依赖 Prompt 判断安全性：

- 所有路径必须是项目根目录下的相对路径；
- 拒绝绝对路径和 `..` 目录穿越；
- 对已存在路径解析真实路径，阻止符号链接逃逸；
- 对新建文件检查真实父目录和目标文件名；
- 禁止 `.env`、环境变体文件和常见 SSH 私钥；
- `write_text_file` 可创建父目录、创建新文件或覆盖文本文件；
- 写入仍受 `filesystem-write` 权限和 Approval 控制。

这是文件级边界，不是容器或操作系统级隔离；当前没有 Shell 或任意进程执行能力。

### 写入意图路由

当用户明确表达创建、写入、保存、修改或编辑文件的意图时，`ChatSession` 为支持 Tool Calling 的 Provider 请求 `write_text_file`。如果模型没有返回对应 Tool Call，不把自然语言中的“已写入”视为事实，而返回未执行说明。

当前 Tool Loop 上限为 8 轮，避免模型无限调用工具。

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

- Shell、删除、网络和外部消息 Tool；
- 容器级或操作系统级 Sandbox；
- Cordis、waterfall、scoped layers 和多 package；
- Tool 并行执行、后台任务、PTC、MCP、子 Agent；
- 动态插件扫描、安装、卸载和插件市场；
- SQLite、数据库迁移、长期记忆和跨设备同步；
- OpenAI 与 Local Provider 的完整 Tool API 扩展，除非出现真实需求；当前强制 `tool_choice` 仅接入支持该协议的 Provider。

## 实施顺序

1. 新增 PromptRegistry，保持当前 prompt 输出行为。已完成。
2. 新增 ToolRegistry，并将 project-files 改为 Runtime 安装的 Capability。已完成。
3. 新增 ToolRuntime，Agent Loop 只依赖它，并把失败规范化为 Tool 结果。已完成。
4. 引入 ApprovalService、CLI 实现、策略和两个权限预设。已完成。
5. 实现最小文件沙盒和 `write_text_file`，覆盖创建、覆盖、路径和符号链接边界。已完成。
6. 增加写入意图强制路由、Provider `tool_choice` 和 8 轮 Tool Loop 上限。已完成。
7. 补齐 Session Event 的调用、审批和结果记录，并验证模型请求可重建。尚未完成。

## 重新评估条件

- 出现第二类需要权限判断的 Tool 时，重新检查 `ToolPermission` 是否足够；
- 需要恢复中断中的 Tool Loop 时，升级事件持久化和重放契约；
- Capability 数量造成 Prompt 或 Tool definitions 明显膨胀时，再引入能力路由；
- 出现真实跨 Provider Tool API 需求时，扩展 Provider 契约。
