# Isla v0.2.3 实施清单：可验证的项目知识与行动闭环

## 1. 执行约束

以 `docs/architecture-v0.2.3.md` 为唯一架构基线。每批只加入一个可独立验证的能力，完成本批测试后停止，不提前实施下一批。

- `StoredSession.messages` 是唯一对话正文事实源；
- 默认测试完全离线；
- 不读取真实 Session、Memory、`.env` 或真实日志；
- Journal 不记录 Tool 参数、文件正文或 Tool Result；
- 不改变 Approval、Permission、Sandbox 语义；
- 不增加 Shell、网络、MCP、并行 Tool、后台任务或子 Agent；
- 不执行 Git add、commit、push；
- 必须扩大核心契约时先停止并与用户确认。

## 2. 实施前审计

编码前阅读并确认：

1. `src/sandbox/policy.ts` 的路径、秘密和符号链接规则；
2. `src/tools/types.ts`、`registry.ts`、`runtime.ts` 的 Tool 契约；
3. `src/tools/project-files.ts` 的当前文件能力；
4. `src/core/session.ts` 的 Tool Loop 与请求形成位置；
5. `src/core/journal.ts`、`request-snapshot.ts` 的 action 与快照；
6. `src/protocol/runner.ts` 的 NDJSON 生命周期；
7. `src/memory/search.ts` 的归一化经验，但不得耦合 Memory Store；
8. `docs/dsh-reference-review.md` 的采用、暂缓和拒绝。

## 3. Batch A：项目检索服务契约

目标：建立纯离线、只读、不接模型的 `ProjectSearchService`。

任务：

1. 新增 `src/project-search/types.ts`，定义 Query、Source、Result 和 Service；
2. 新增集中常量，固定文件、结果、字符和上下文上限；
3. 实现参数验证和稳定错误；
4. 结果只返回 workspace 相对路径；
5. 不注册 Tool，不改 ChatSession、Journal 或协议。

测试：空查询、非法限制、合法子目录、1-based 行号、默认/显式限制、空结果。

硬失败：服务读取模型历史、Memory 或 Session；结果含绝对路径；绕开 SandboxPolicy。

停点：契约与单元测试通过后停止。

## 4. Batch B：文件发现与安全过滤

目标：稳定枚举 workspace 内可检索文本文件。

任务：复用或安全扩展 SandboxPolicy；忽略 `.git`、`node_modules`、`dist`、`coverage`；排除秘密；拒绝绝对路径、穿越和 symlink；跳过二进制、超大及不可读普通文件；按相对路径稳定排序；区分可跳过与必须失败。

测试：普通/嵌套目录、忽略目录、秘密、二进制、超大文件、绝对路径、穿越、文件/目录 symlink、Windows 大小写。

硬失败：扫描 `.git` 或 `.env`；跟随 symlink；错误泄漏绝对路径或内容。

停点：安全测试通过后停止。

## 5. Batch C：匹配、排序、片段与 source ID

目标：让固定 fixture 的结果可重复、可定位、可比较。

任务：实现 NFKC、大小写和空白归一化；英文 token 与中文二字片段；路径/文件名/正文匹配；明确排序；相邻命中合并；有限 excerpt 与准确行号；`project:v1:` source ID；正确的 `truncated`。

测试：中文、英文、混合、标点、路径、文件名、正文、多 term、相邻命中、稳定排序、截断、ID 稳定与内容变化。

硬失败：依赖文件枚举偶然顺序；ID 含绝对路径或查询；相同输入结果不稳定。

停点：纯服务离线评测通过后停止。

## 6. Batch D：只读 search_project Tool

目标：经既有 ToolRuntime 暴露检索能力。

任务：新增参数仅为 `query` 和可选 `path` 的 Tool；permission 为 `filesystem-read`；注册到 ProjectFiles capability；更新 Prompt 指引；输出固定不可信边界、ID、路径、行号与 excerpt；沿用稳定错误。

测试：schema、registry、readonly preset、无需 Approval、非法参数、Sandbox、搜索后回答、搜索后读取完整文件。

硬失败：接受 glob/regex/绝对路径；绕过 ToolRuntime；搜索触发写入或 Approval。

停点：Tool 集成通过后停止，不提前处理 Snapshot。

## 7. Batch E：来源关联、Snapshot 与 Journal

目标：只记录真正进入 Attempt 的安全来源身份。

任务：从成功结果关联当前 Turn 来源；下一 Attempt 注入排序去重的 `retrievedSourceIds`；跨 Turn 清空；新增封闭 `project_retrieval` action；失败不记录成功 action；保持 Session 兼容。

测试：多搜索去重、跨 step 累积、跨 Turn 清空、失败、request hash、保存恢复和 Journal 隐私。

硬失败：Snapshot 与实际请求不一致；Journal 出现 query、path、excerpt、arguments 或 Tool Result；产生第二份正文事实源。

停点：Session 和 Snapshot 测试通过后停止。

## 8. Batch F：可信来源展示

目标：用户可核验结论，模型不能制造引用。

先比较：Runtime 直接附加当前 Turn 来源；或模型输出 source ID 后由 Runtime 严格过滤。默认优先前者，只有真实测试证明过度引用才改用后者并记录原因。

任务：仅在有效项目来源存在时展示；只显示相对路径和 1-based 行号；排序、去重、限制；不显示 hash、绝对路径或 excerpt；不捕获为 Memory。

测试：正常、重复、伪造、无来源、Tool 失败、文件变化、CLI/NDJSON 兼容。

硬失败：模型能引用本轮未检索路径；泄漏 hash/绝对路径；破坏普通问答。

停点：来源可靠性测试通过后停止。

## 9. Batch G：离线检索评测集

目标：形成质量门禁。

任务：创建虚构 fixture workspace；每例定义查询、必须命中、禁止命中和排序；覆盖中英文、混合、标点、路径、状态文档和代码；输出案例数、命中、误命中、截断与失败。

初始门禁：必须命中 100%，禁止命中 0 个。若算法演进需要调整，先记录理由，不得静默降级。不得调用 Provider、Embedding 或真实 workspace。

停点：评测稳定后停止。

## 10. Batch H：CLI/NDJSON 收口与文档

目标：保持正式机器边界稳定。

任务：沿用 `tool_start`/`tool_end`；不加 breaking event；错误只含稳定 code；`/trace` 只显示 source 数量；更新 README、roadmap、references、bugs、testing 和 DSH 评审。

测试：普通回答、搜索、无命中、Sandbox、Provider 失败、new_session、exit/EOF 和日志隐私。

硬失败：NDJSON 泄漏正文/参数；失败后空 `response_end`；trace 泄漏路径、查询或 excerpt。

停点：全量离线门禁通过后停止，等待真实验收授权。

## 11. Batch I：真实 DeepSeek NDJSON 验收

仅在用户明确授权后执行，使用临时无秘密 workspace：连续两轮搜索项目实现并核验路径行号；查询不存在内容且不编造；只读讨论不写入；写入 Approval 拒绝/批准；new_session 不泄漏旧 source；exit/bye 无空终态；检查 Session、Journal 和日志无秘密、query、excerpt 或 Tool Result。

失败先归类为检索、Prompt、Tool、Provider、Persistence 或协议，不用增加重试掩盖问题。

## 12. 最终门禁与交付

每批至少运行专项测试和 typecheck。最终运行：

```text
npm run typecheck
npm test
npm run build
npm run pack:check
git diff --check
```

交付记录测试文件数、通过/跳过数、真实验收状态、配置要求，以及未执行 Git add/commit/push。
