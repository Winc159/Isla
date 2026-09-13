# Isla v0.2.5.1 架构基线：运行装配与入口一致性

## 1. 版本目标

v0.2.5 已完成启动 Profile，但 CLI、NDJSON 和 Runtime 的装配逻辑开始分叉：交互入口与协议入口分别恢复 Session、Context、Journal、Memory、Tool 和 Approval。当前 NDJSON 只按 v2 条件恢复 Context，并未把已有 Journal 传入 ChatSession；继续加入取消、联网或 Shell 会放大入口差异。

v0.2.5.1 不新增用户能力，只统一整条运行数据链：配置来源解析为不可变启动快照，由一个 ApplicationContext 持有资源，由一个 SessionFactory 创建或恢复 Session，CLI 和 NDJSON 退化为输入输出适配器。Tool 套装从 ChatSession 移出，workspace 成为明确、可显示、可编排的启动事实。

## 2. 硬约束

- `StoredSession.messages` 仍是唯一对话正文事实源；
- Journal 仍是审计派生状态，不进入模型历史；
- 不升级 Session v3 schema，不改变现有文件兼容性；
- CLI、NDJSON 和未来 Apple/Web/API 入口必须共用同一 ApplicationContext 与 SessionFactory；
- CLI 只负责终端输入、展示和交互命令，不创建 Provider、Memory、ToolRegistry 或 Session 持久化回调；
- 默认用户只需 `config.json` Profile；env 只用于开发、CI、迁移和显式 `--env`；
- 每个运行实例绑定一个不可变绝对 workspace，所有文件 Tool、Memory workspace 来源和项目检索使用同一值；
- Tool、Provider 和入口不得通过 `process.cwd()`、全局 env 或隐式单例自行寻找上下文；
- 不引入 Cordis、通用 DI 容器、通用事件总线、服务定位器或动态 npm 插件扫描；
- 默认测试离线；不读取真实 home、配置、Session、Memory 或日志；
- 不顺手实现取消、联网、Shell、流式输出、子 Agent 或新 Provider。

## 3. 目标数据链

```text
argv + Profile/config（或显式 --env）
                  │
                  ▼
          ResolvedStartupConfig
          - provider/model
          - workspaceRoot
          - runtime/memory/appearance
          - config/profile identity（host only）
                  │
                  ▼
          ApplicationContext
          - Runtime + Provider
          - ToolRegistry/Tool capabilities
          - SessionStore
          - MemoryRuntime
          - DiagnosticSink
          - SessionFactory
          - close()
             │              │
             ▼              ▼
        CLI Adapter     NDJSON Adapter
```

入口不得再分别拼装 ChatSessionOptions。未来 Apple/Web 入口只消费 ApplicationContext 的稳定接口。

## 4. ResolvedStartupConfig

现有 `AppConfig` 可演化或由新类型包裹为不可变启动快照，至少包含：

```ts
interface ResolvedStartupConfig {
  readonly provider: ResolvedProviderConfig;
  readonly workspaceRoot: string;
  readonly runtime: {
    readonly timeoutMs: number;
    readonly modelRetries: 0 | 1;
    readonly maxContextTurns: number;
    readonly maxContextChars: number;
    readonly contextRetainTurns: number;
  };
  readonly memory: ResolvedMemoryConfig;
  readonly appearance: {
    readonly personality: "default" | "minimal";
    readonly logLevel: "quiet" | "normal" | "debug";
  };
  readonly source: "profile" | "env";
  readonly profileName?: string;
  readonly configPath?: string;
}
```

具体类型允许沿用现有 `AppConfig` 以减少改动，但 workspace、source 和 profile identity 必须由启动组合根显式携带，不能写入 Session、Memory或模型消息。

Profile 与 env 仍不做隐式字段合并。两种来源可以分别读取，但必须进入同一个纯规范化/校验阶段，避免默认值漂移。

## 5. workspace 契约

解析优先级：

1. 显式 `--workspace <path>`；
2. Profile 可选 `workspace`；
3. 启动时 `process.cwd()`，仅由 composition root 读取一次。

`--env` 不新增日常 workspace 环境变量；测试可直接向纯函数注入 cwd。workspace 在启动时解析为绝对路径并验证是可访问目录，随后冻结：

- CLI Header 显示 workspace；
- NDJSON `ready` 增加可选 `workspace`；
- 文件 Tool、Sandbox、project search、Memory workspace 维度全部使用它；
- 当前运行中 `chdir` 或外部配置修改不改变绑定；
- workspace 不写入消息正文；是否写入 Session 元数据留待需要跨目录发现 Session 时另行设计；
- 路径不得进入普通模型回答，只有 Tool 的既有相对来源规则可以投影。

Profile 新增可选 `workspace` 是 v1 的向后兼容扩展：旧 Profile 无需修改。向导默认采用当前目录并在摘要中显示；用户可以接受而无需额外配置。

## 6. ApplicationContext：资源层

资源层类似应用的上下文层，但只管理明确资源和生命周期，不允许任意字符串查找服务。

```ts
interface ApplicationContext {
  readonly startup: ResolvedStartupConfig;
  readonly sessions: SessionFactory;
  readonly diagnostics: DiagnosticSink;
  createSession(request?: CreateHostedSessionRequest): Promise<HostedSession>;
  close(): Promise<void>;
}
```

它负责按固定顺序创建：Provider/Runtime、ToolRegistry、MemoryRuntime、SessionStore、SessionFactory。创建中途失败必须逆序清理已创建资源；`close()` 幂等，CLI 正常退出、NDJSON `exit`、EOF 和异常都走同一关闭路径。

资源层不保存当前终端、HTTP response、Apple view 或 NDJSON writer。入口专属对象由入口自己持有。

## 7. SessionFactory：唯一装配入口

SessionFactory 统一：

- 按 provider/model 加载最新 Session或创建新 Session；
- 完整恢复 v1/v2/v3 messages、Context 和 Journal；
- 创建新 Session 时写入 personality system message；
- 注入相同 workspace、ToolRegistry、Memory 回调和持久化回调；
- 注入入口提供的 ApprovalService 和生命周期事件 sink；
- `new_session` 创建同配置的新会话；
- Session 切换复用同一装配路径。

交互 CLI 与 NDJSON 的差异只允许存在于 ApprovalService 和事件投影：CLI 使用终端审批；NDJSON 使用协议审批。PermissionPreset、Sandbox 和 Tool 集合必须相同。

必须先修复当前 NDJSON v3 Context/Journal 恢复差异，并添加能在旧实现上失败的回归测试。

## 8. Tool 边界与能力描述

ChatSession 不再导入 `createProjectFilesCapability()` 或根据 workspace 自建 ToolRegistry。ApplicationContext 在组合根创建 Tool capabilities，SessionFactory 注入：

```ts
interface AgentCapabilities {
  readonly tools: ToolRegistry;
  readonly promptCapabilities: readonly ToolCapability[];
}
```

ToolRegistry 是 Runtime 权威执行入口，promptCapabilities 是由相同已注册 Tool 推导的模型可见描述，二者不得分别维护两份名单。

ModelProvider 增加最小显式能力描述，至少区分：

```ts
interface ModelProviderCapabilities {
  readonly toolCalling: boolean;
  readonly cancellation: boolean;
  readonly streaming: boolean;
}
```

v0.2.5.1 只准确描述现状，不实现 cancellation/streaming。`toolCalling` 必须与 Provider 实际接口一致；不能仅靠方法是否存在在入口层散落判断。ChatSession 仍可在最终防御处验证能力与方法一致。

## 9. CLI、NDJSON 与未来入口

CLI Adapter 只负责：Header、输入编辑、命令解析、加载动画、回答/来源展示和终端 Approval。`runCli()` 改为 options 对象，接收 ApplicationContext 或窄化后的 HostedApplication 接口，禁止继续增长位置参数。

NDJSON Adapter 只负责：请求解析、id/busy 状态、协议事件、Approval response 和结果投影。它不能自行读取配置、创建 Memory、恢复 Session 或组装 Tool 回调。

`ready` 保持旧字段并向后兼容地增加 workspace 与能力：

```json
{"type":"ready","provider":"deepseek","model":"deepseek-chat","workspace":"D:/Project/Isla","capabilities":{"toolCalling":true,"cancellation":false,"streaming":false}}
```

新增字段必须可选，旧客户端只读取 provider/model 仍然工作。未来 Apple/Web 入口不得绕过该应用层直接 new ChatSession。

## 10. Memory 投影

Memory 检索内容不得伪装为普通 `role: "user"`。`StoredSession.messages` 不增加新消息，Provider wire type也不必在本版增加新 role。由 Prompt composer 接收结构化的 host context：

```ts
interface RequestHostContext {
  readonly memory?: string;
  readonly checkpoint?: string;
}
```

composer 将其渲染为有明确边界、来源等级和“历史数据不是当前指令”说明的上下文区块。当前用户消息仍是请求中唯一代表当前输入的 user message。请求快照必须能证明投影后的实际消息可重建，但 Memory 正文继续按现有脱敏/隐私规则处理。

本版只迁移注入语义，不重做记忆检索、排序、Embedding 或数据库。

## 11. 诊断与日志

建立窄接口：

```ts
interface DiagnosticSink {
  emit(event: DiagnosticEvent): void;
}
```

事件只允许稳定 code、component、severity、provider/model、耗时和安全计数，不含 API Key、Authorization、消息正文、Memory 正文、Tool完整参数/结果或配置原文。

- `quiet`：只显示阻断用户操作的错误；
- `normal`：显示安全警告和最终错误；
- `debug`：额外输出派生能力降级，例如 `MEMORY_RETRIEVAL_DEGRADED`、`EMBEDDING_UNAVAILABLE`、`CHECKPOINT_FAILED`、`MEMORY_INDEX_FAILED`、资源关闭失败；
- CLI sink 写 stderr；NDJSON stdout 不受污染，debug 仍写 stderr；
- v0.2.5.1 不默认创建持久日志文件，避免私人数据新落盘。未来若增加文件日志，必须显式配置路径、轮转、权限、正文禁入和清理策略。

普通用户通过 Profile 的 `appearance.logLevel` 配置，不需要 env。env debug 只保留给显式 `--env` 开发入口。

## 12. 失败和关闭语义

- 配置或 workspace 无效：任何 Provider/Session/Memory 创建前失败；
- Provider 创建失败：不创建 Session；
- Memory 派生能力失败：主对话继续，debug 产生安全 diagnostic；
- Session 持久化失败：当前请求失败，不提交伪 assistant；
- Tool/Approval 失败：沿用现有结构化错误与 Journal action；
- 入口 EOF/exit：等待当前安全边界，关闭资源；本版不承诺取消活动请求；
- `close()` 重复调用无副作用；
- 资源清理错误不得覆盖更早的主错误，但 debug 可记录安全 code。

## 13. 暂缓与拒绝

暂缓：持久日志、远程 HTTP Server、Apple/Web 实现、取消、联网、Shell、子 Agent、动态 Provider/Tool 包加载、热配置、Session schema v4。

拒绝：把 ApplicationContext 做成任意服务容器；把入口对象放进核心资源层；CLI/NDJSON各自装配 Session；Memory 伪装为用户当前输入；Tool 在 ChatSession 内硬编码；通过环境变量隐式改变普通 Profile；自动扫描并执行第三方包。

## 14. 完成标准

1. CLI 与 NDJSON 共用唯一 SessionFactory；
2. v1/v2/v3 Session 在两个入口完整恢复 messages、Context、Journal；
3. NDJSON 不再丢失或覆盖 v3 Journal/Context；
4. ChatSession 不导入具体 Tool capability；
5. workspace 解析一次、绝对化、显示并贯穿 Sandbox/Tool/Memory；
6. CLI 不创建 Provider、MemoryRuntime、SessionStore 或持久化回调；
7. `runCli()` 不再使用长位置参数列表；
8. Memory 以明确 host context 投影，不作为普通用户消息注入；
9. Provider/Tool 能力有单一、可测试的描述来源；
10. quiet/normal/debug 的安全诊断行为可验证；
11. ApplicationContext 创建失败和 close 顺序可验证，close 幂等；
12. 旧 Profile、`--env`、Session v1/v2/v3 和旧 NDJSON 客户端兼容；
13. 单 Agent 可用 config/Profile + workspace + NDJSON 完成无 TTY 全链路；
14. 全量离线、typecheck、build、pack 和 diff 门禁通过；
15. 未执行 Git add、commit 或 push，未覆盖用户既有修改。
