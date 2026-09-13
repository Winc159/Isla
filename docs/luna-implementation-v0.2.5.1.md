# Luna：Isla v0.2.5.1 运行装配与入口一致性实施清单

## 1. 唯一架构基线

以 `docs/architecture-v0.2.5.1.md` 为唯一实施基线。开始前完整阅读根目录 `AGENTS.md`、本架构、`docs/testing-v0.2.5.1.md`、v0.2.5 架构与收口、`src/cli.ts`、`src/main.ts`、`src/core/session.ts`、`src/session-store.ts`、Tool/Memory/Protocol 模块。

若需要升级 Session schema、改变消息事实源、实现取消/联网/Shell/子 Agent、引入通用 DI/事件总线、持久日志或动态插件加载，停止并请求确认。

## 2. 全程规则

- 先记录 `git status --short`，保护全部未提交修改；
- 每次只完成一个 Batch，专项测试和 typecheck 通过后停点；
- 先写能暴露当前分叉的失败测试，再修实现；
- 默认测试完全离线，路径全部来自临时目录或显式依赖注入；
- 不读取真实 config、env、Session、Memory 或日志；
- 不使用真实 Key、私人正文或逼真凭据；
- 不改变现有 Tool、Approval、Sandbox、Memory 和来源安全语义；
- 不执行 Git add、commit、push 或破坏性 Git 操作。

## 3. Batch A：锁定分叉并修复 v3 恢复

目标：用测试证明 CLI/NDJSON 当前恢复差异，先完成最小修复。

1. 构造含 checkpoint、历史 Journal 和完成 Turn 的 v3 Session；
2. 分别经交互 Session 创建路径和 NDJSON `createSession` 路径恢复；
3. 断言第一次新请求的 request snapshot包含相同 checkpoint 投影；
4. 断言旧 Journal 保留，新 Turn sequence连续；
5. 断言保存后没有用空 Journal 覆盖原记录；
6. 将 NDJSON 恢复条件从 v2 特判改为基于规范化 StoredSession能力；
7. 完整传入 Journal；
8. 暂不重构其他装配。

专项测试：Session v1/v2/v3、protocol、request snapshot、journal。停点报告必须展示修复前会失败的断言。

Batch A 实施记录：新增 `projectStoredSession()` 作为入口共享的恢复投影，按字段存在性保留 v1/v2/v3 的 context 与 journal；回归测试见 `tests/core/session-projection.test.ts` 和 `tests/protocol-profile.e2e.test.ts`。

## 4. Batch B：ResolvedStartupConfig 与 workspace

目标：建立唯一启动快照和显式 workspace。

1. 定义或包裹 `ResolvedStartupConfig`；
2. Profile 增加可选 workspace，旧 v1 文件保持兼容；
3. 参数 parser 增加 `--workspace <path>`，禁止空值、重复和模糊参数；
4. 实现纯 `resolveWorkspace(explicit, profile, cwd)`；
5. 优先级固定为显式参数、Profile、注入 cwd；
6. 解析绝对路径并验证目录，不跟随配置变更；
7. 不从普通 env 隐式读取 workspace；
8. 向导摘要显示 workspace，默认接受当前目录；
9. CLI Header 显示 workspace；
10. NDJSON ready 可选增加 workspace，保持旧客户端兼容。

专项测试覆盖 Windows/POSIX 风格路径时以当前平台 path API 为准，不伪造不可验证的跨平台 filesystem 行为。

Batch B 实施记录：新增 `--workspace`、Profile 可选 workspace 和纯 `resolveWorkspace()`；启动时解析为绝对 realpath，CLI Header 与 NDJSON `ready` 可显示绑定目录，文件 Tool/Memory 回调在当前入口路径使用该绑定值。专项测试见 `tests/workspace.test.ts` 与 `tests/cli-args.test.ts`。

## 5. Batch C：ApplicationContext 与资源生命周期

目标：把运行资源创建和关闭从 CLI 移到应用层。

1. 新增小型 application 模块；
2. 由 composition root 用 ResolvedStartupConfig 创建 Provider/Runtime、Tool能力、SessionStore、MemoryRuntime、DiagnosticSink、SessionFactory；
3. ApplicationContext 不引用 readline、stdin/stdout 或协议 writer；
4. `close()` 幂等；
5. 创建中途失败逆序释放；
6. 关闭错误不覆盖主错误；
7. 保留现有 Provider 工厂，不在本批做 Provider Registry重构；
8. main 只负责参数/配置、创建 application、选择入口、finally close。

专项测试使用 fake disposable 记录创建与关闭顺序，不打开真实 SQLite、网络或终端。

Batch C 实施记录：新增 `src/application.ts` 的最小 ApplicationContext，统一持有 Runtime、SessionStore、MemoryRuntime 和 DiagnosticSink，并提供幂等 `close()`；main 的 CLI/NDJSON 分支共用该资源实例。SessionFactory 与 Tool 迁移留在后续批次。

## 6. Batch D：统一 SessionFactory

目标：所有入口只通过一个工厂创建、恢复、切换 Session。

1. 提取现有 `createPersistentSession()` 与 NDJSON 内联装配的共同逻辑；
2. 工厂持有启动快照、SessionStore、MemoryRuntime、Tool能力；
3. 入口提供 ApprovalService 和事件 sink；
4. 统一恢复 messages、context、journal；
5. 统一 onSessionStateChanged、Memory retrieve/index/candidate 回调；
6. 统一创建新 Session 的 system prompt；
7. `/new`、`/sessions`、NDJSON `new_session` 使用同一工厂；
8. 删除两份入口内联装配；
9. 迁移后 Batch A 等价测试继续通过。

硬失败：工厂读取 stdin/stdout；入口仍直接调用 `runtime.createSession()`；v3 Journal/Context再次分叉。

Batch D 实施记录：新增 `src/session-factory.ts`，CLI 与 NDJSON 共用同一 Session 装配函数，统一 messages/context/journal、workspace、Memory 回调、持久化回调、Approval 和 Tool 生命周期回调。专项回归 19 条通过。

Batch E 实施记录：新增 `ChatSessionOptions.capabilities` 和 Runtime 透传，SessionFactory 显式注入项目文件 capability；CLI/NDJSON 主路径不再依赖 ChatSession 自动发现 workspace。为保持现有直接构造 ChatSession 的离线测试和外部调用兼容，暂保留 `projectRoot` fallback，后续在所有调用方迁移后删除该兼容桥。

## 7. Batch E：Tool 组合迁出 ChatSession

目标：ChatSession 只执行注入的 Agent Loop能力。

1. 将项目文件 Tool capability 的创建移到 ApplicationContext；
2. 由同一注册过程产生 ToolRegistry和 prompt capability；
3. ChatSessionOptions 接收已装配 Tool环境或窄接口；
4. ChatSession 删除具体 Tool import和 `process.cwd()` fallback；
5. 无 Tool配置时稳定走普通对话；
6. DeepSeek现有 Tool Loop、Approval、Sandbox、结构化 details和 citation不变；
7. Provider增加最小 capability描述，准确声明现状；
8. 不实现新 Tool或动态加载。

专项测试：空 Tool、只读 Tool、写入审批、拒绝、沙盒、project search、伪造引用、Provider无 Tool Calling。

## 8. Batch F：Memory host context

目标：Memory不再作为普通用户消息注入。

1. 定义最小 `RequestHostContext`；
2. Memory Runtime仍返回派生文本或结构化值，但交给 prompt composer；
3. composer输出明确标记的历史数据区块；
4. 当前用户输入在投影中保持唯一当前 user语义；
5. host context不写回 StoredSession.messages；
6. Request Snapshot hash基于实际投影保持可重建；
7. 外部内容不能通过“历史记忆”身份提升为指令；
8. 不改变检索评分、Embedding或数据库。

专项测试必须检查角色顺序、正文事实源不变、失败降级和快照一致性。

Batch F 实施记录：新增 `RequestHostContext` 和 Prompt composer host context 区块；Memory 检索结果不再伪装成 `role: user`，当前用户输入保持唯一当前 user 语义，并保留不可信历史资料边界。28 条专项测试通过。

## 9. Batch G：CLI/NDJSON 纯适配器

目标：入口只负责交互与协议。

1. `runCli()` 改为 options对象或 HostedApplication窄接口；
2. CLI保留 Header、输入编辑、commands、loading和展示；
3. CLI不再 new SessionStore、MemoryRuntime、Provider或拼持久化回调；
4. NDJSON只管理协议状态、事件和 Approval response；
5. NDJSON不直接恢复 Session；
6. 两入口的 Provider/model/workspace/Tool集合来自同一启动快照；
7. 保持现有协议字段，新增 ready字段可选；
8. 为未来 Apple/Web入口写一个 fake adapter契约测试，证明无需导入 CLI即可完成会话。

Batch G 实施记录：新增 `runCliAdapter(options)`，main 通过 options/应用资源调用 CLI；保留旧 positional `runCli()` 作为兼容包装。CLI/NDJSON 核心回归 19 条通过。进一步删除旧包装和把所有命令状态迁移到 HostedApplication 留待后续收口。

## 10. Batch H：安全诊断

目标：派生失败可观察且不泄密。

1. 定义封闭 DiagnosticEvent union和 DiagnosticSink；
2. 将 Memory检索、Embedding、checkpoint、Memory index/candidate candidate、资源关闭的空 catch接入安全 code；
3. 保持派生失败不阻断主请求；
4. quiet只输出阻断错误；normal输出安全警告；debug输出完整安全诊断字段；
5. CLI和NDJSON诊断走 stderr，不污染协议 stdout；
6. 不记录消息、Memory正文、Tool参数/结果、配置原文或 Key；
7. 不新增默认日志文件；
8. Profile logLevel为普通入口，env只服务显式开发模式。

## 10.1 Batch H 实施记录

Batch H 已完成安全诊断接线：`ApplicationContext` 提供按 `quiet/normal/debug` 过滤的 `DiagnosticSink`，SessionFactory 将会话内部的 Memory、checkpoint 与索引降级事件统一转发到应用诊断通道；CLI 与 NDJSON 共用该通道。诊断只写入 stderr，不污染 NDJSON stdout，不写入会话正文，也不包含 API Key、原始提示词或模型回答。新增 sink 过滤测试，并通过 typecheck/build；Vitest 在当前 Windows 沙箱中曾因 esbuild `spawn EPERM` 无法启动，需在正常本机环境重跑专项测试。

## 11. Batch I：兼容、自动化与收口

最终收口检查已在受控权限下完成：`npm run typecheck`、`npm test`、`npm run build`、`npm run pack:check` 与 `git diff --check` 全部通过。离线测试为 55 个文件通过、4 个文件跳过；212 条测试通过、4 条跳过。跳过项均为真实 Provider/外部 smoke，不属于默认离线门禁。当前 package 版本仍为 0.2.1，未执行版本升级、Git add、commit、push 或发布。

1. 运行旧 Profile、env、Session v1/v2/v3迁移测试；
2. 运行 CLI与NDJSON等价矩阵；
3. 用临时 Profile + workspace + 本地 fake HTTP Provider完成无 TTY多轮对话、new_session、Tool、Approval和exit；
4. 证明 cwd变化不改变已绑定 workspace；
5. 扫描 stdout/stderr、Session、Journal、Memory、Snapshot、dist和pack中的秘密；
6. 更新 README、roadmap、DSH评审和 evaluation；
7. 最终执行：

```text
npm run typecheck
npm test
npm run build
npm run pack:check
git diff --check
```

8. 未经授权不运行真实 Provider；
9. 不执行 Git写操作。

## 12. 每批停点模板

- 本批目标与实际修改；
- 修改文件；
- 冻结契约；
- 专项测试通过/失败/跳过；
- typecheck结果；
- 尚未实施批次；
- 风险和偏差；
- 明确声明未执行 Git add、commit、push。

只有 Batch A～I全部完成且 testing文档P0全部通过，才可宣布 v0.2.5.1收口。
