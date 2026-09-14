# Isla v0.2.4 评测记录

## Batch A：检索质量与行为基线

状态：已完成（仅冻结基线，尚未修改生产搜索算法）  
日期：2026-09-12

### 测试范围

本批扩展了 `tests/fixtures/project-search-cases.ts`，共 11 个排序案例，另有 2 个既有行为/截断测试，覆盖：

- 中文标点、中文完整短语与 bigram 降级竞争；
- 英文大小写、完整短语与单 term 竞争；
- 中英文混合查询；
- 文件名、相对路径和正文命中；
- primary term 全覆盖与部分覆盖；
- 路径范围缩小；
- 相同分数的稳定排序；
- 当前架构文档与历史文档竞争；
- 既有忽略目录、秘密文件和 limit 截断行为。

评测 helper 已能够记录每例的：

- top-1 路径；
- top-3 路径；
- forbidden 命中数量；
- files scanned；
- truncated；
- elapsed（暂未作为平台相关硬门禁）。

Batch A 只对 fixture 正确性、既有 must-include/must-exclude 和指标数量做硬断言，暂不把当前排序写成最终正确结果。最终 top-1/top-3 门禁在 Luna Batch E 启用。

### 基线结果

运行命令：

```text
npx vitest run tests/project-search-evaluation.test.ts
npm run typecheck
```

实际结果：专项文件 1 个通过，13 条测试通过；`npm run typecheck` 通过。11 个排序案例当前 top-1 命中 8/11（72.7%），既有 forbidden 命中为 0。top-1 失败如下：

- `完整短语优先于单 term`：当前返回 `docs/approval.md`，目标为 `docs/policy.md`；
- `primary term 全覆盖`：当前返回 `docs/session.md`，目标为 `src/journal.ts`；
- `中文完整短语优先`：当前返回 `docs/project.md`，目标为 `docs/source.md`。

其余排序案例的 top-1 均命中目标；相同分数案例当前已按相对路径稳定排序。当前实现的 top-3 结果已保留在本批临时评测输出中，Batch E 将把 `expectedTop3` 补齐为正式门禁。

### 已知待改进项

当前实现主要按文件发现顺序产生结果，且多个 query term 采用宽松匹配；因此以下案例是为 Batch E 预置的竞争门禁，而不是当前算法已通过的声明：

1. 完整短语应优先于单 term；
2. 文件名完整命中应优先于正文弱命中；
3. primary term 全覆盖应优先于部分覆盖；
4. 中文完整短语应优先于单一 bigram；
5. 相同分数必须按相对路径稳定排序。

## 后续记录规则

### Batch B：结构化 ToolOutput

状态：已完成（未修改 Session 来源关联）  
日期：2026-09-12

变更：

- `Tool.execute()` 兼容 `string | ToolOutput`；
- `ToolRuntime` 将两种成功结果归一化；
- `search_project` 返回 `content` 与封闭 `project_search` details；
- 其他字符串 Tool 保持原行为；
- details 只包含 source ID、相对路径、起止行、扫描数量和截断状态，不包含 excerpt、query 或参数。

验证命令：

```text
npm run typecheck
npx vitest run tests/core/tool-runtime.test.ts tests/tools/search-project.test.ts
```

结果：typecheck 通过；2 个测试文件通过；9 条测试通过。

### Batch C：结构化来源唯一入口

状态：已完成
日期：2026-09-12

变更：`ChatSession` 现在只从 `execution.details.type === "project_search"` 建立 source allowlist、Snapshot `retrievedSourceIds` 和 `project_retrieval` Journal action；不再从 Tool content 的 source ID、路径或截断文案恢复可信来源。来源映射改为按 source ID 保存，重复 ID 的不一致定位会阻断本轮。新测试证明其他 Tool 返回的伪造 source-like 文本不会污染来源状态。

验证命令：

```text
npm run typecheck
npx vitest run tests/core/project-search-session.test.ts tests/core/project-source-display.test.ts tests/core/request-snapshot.test.ts tests/core/journal.test.ts
```

结果：typecheck 通过；4 个测试文件通过；10 条测试通过。下一批为引用声明与最终来源展示（Batch D）。

### Batch D：严格引用声明与最终来源

状态：已完成  
日期：2026-09-12

变更：新增纯函数 citation 校验器，识别 `[[source:project:v1:<64位小写十六进制>]]` 标记；只接受当前 Turn 结构化 details 建立的 allowlist；合法和未知 marker 都会从最终 assistant 文本移除，只有合法 cited source 才进入 `ModelResponse.projectSources`。Prompt 增加引用规则；普通回答不要求标记。

验证命令：

```text
npm run typecheck
npx vitest run tests/core/project-source-display.test.ts tests/core/project-search-session.test.ts tests/core/session.test.ts tests/prompts/compose.test.ts tests/prompts/registry.test.ts
```

结果：typecheck 通过；5 个测试文件通过；30 条测试通过。已覆盖合法引用、未知引用、Tool 伪造 source-like 文本、跨 Turn allowlist 和最终文本清理。下一批为确定性评分与最终质量门禁（Batch E）。

### Batch E：确定性评分与最终质量门禁

状态：已完成  
日期：2026-09-12

变更：`search.ts` 现在先收集候选，再按完整路径/文件名、完整查询、primary term 覆盖率和中文 fallback bigram 计算整数 score，最后以 score、相对路径和行号稳定排序。搜索不再依赖文件发现顺序；Batch A 的 `expectedTop1` 已启用为硬门禁。

验证命令：

```text
npm run typecheck
npx vitest run tests/project-search.test.ts tests/project-search-evaluation.test.ts tests/project-search-types.test.ts tests/project-search-discovery.test.ts
```

结果：typecheck 通过；4 个测试文件通过；24 条测试通过。11/11 排序案例 top-1 命中（100%），既有 forbidden 命中为 0；Batch A 暴露的完整短语、primary term 全覆盖和中文完整短语三个排序失败均已修正。下一批为每来源预算与可重建截断（Batch F）。

### Batch F：每来源预算与可重建截断

状态：已完成  
日期：2026-09-12

变更：新增集中定义的 `maxSourceChars = 4,096`。候选先完成评分和排序，再执行每来源与整体预算；过长或超出剩余预算的候选会设置 `truncated` 并继续检查后续候选，避免单一长来源饿死后续短来源。source ID 仍基于实际进入 content 的最终 excerpt；本批未改变 `project:v1` 身份语义。

验证命令：

```text
npm run typecheck
npx vitest run tests/project-search.test.ts tests/project-search-evaluation.test.ts tests/tools/search-project.test.ts tests/core/project-search-session.test.ts
```

结果：typecheck 通过；4 个测试文件通过；20 条测试通过。新增长来源与后续短来源预算案例通过；既有排序、安全、Tool 和来源关联行为无回归。下一批为 Session、Journal、CLI 与 NDJSON 全链路回归（Batch G）。

### Batch G：Session、Journal、CLI 与 NDJSON 全链路回归

状态：已完成  
日期：2026-09-12

首次回归发现既有来源展示测试使用单字符查询 `x`，评分改造初版过滤了单字符 term，造成搜索兼容回归。已修正为保留所有非空 term；该修复没有放宽安全边界或改变 source ID 语义。

验证命令：

```text
npm run typecheck
npx vitest run tests/session-store.test.ts tests/session-store-v3.test.ts tests/core tests/cli tests/protocol.test.ts tests/protocol.e2e.test.ts tests/memory
```

结果：32 个测试文件通过；120 条测试通过；typecheck 通过。覆盖 Session v1/v2/v3、Journal、Snapshot、Core、CLI、NDJSON 子进程、Approval、Memory、来源展示和跨 Turn 来源清理。下一批为离线收口与文档（Batch H）。

### Batch H：离线收口与文档

状态：已完成（真实 Provider 验收待用户授权）  
日期：2026-09-12

最终离线门禁命令：

```text
npm run typecheck
npm test
npm run build
npm run pack:check
git diff --check
```

结果：

- typecheck：通过；
- 全量测试：44 个测试文件通过、4 个跳过；173 条测试通过、4 条跳过；
- build：通过；
- pack:check：通过，生成 dry-run 包内容仅含 `dist`、README 和 LICENSE；
- diff check：通过；仅有 Windows 工作区的 LF/CRLF 提示。

当时跳过项为真实 Provider smoke，原因是尚未获得授权。随后用户已授权并执行 Batch I；已同步 README、roadmap、DSH 参考评审和本评测记录；未执行 Git add、commit 或 push。

## 后续记录规则

Batch I 按 `docs/luna-implementation-v0.2.4.md` 顺序追加结果。每批保留命令、通过/跳过数量、基线对比、失败分类和未解决项；不得记录真实回答正文、API Key、真实 workspace 内容或私人日志。

### Batch I：真实 DeepSeek NDJSON 验收

状态：功能场景通过；引用 marker 的外部可观测性仍需复核，不宣布 v0.2.4 完全完成  
日期：2026-09-12

执行前提：用户已明确授权真实 API 请求。测试使用临时 workspace、临时 Session/Memory 目录，未执行 Git 写操作。

验证命令：

```text
$env:ISLA_RUN_REAL_SMOKE = "1"
node --env-file-if-exists=.env ./node_modules/vitest/vitest.mjs run tests/smoke/real-project-search.test.ts tests/smoke/real-ndjson.test.ts
```

首次并行运行结果：两个场景各出现一次失败——项目检索在 90 秒内未收到终态，完整 NDJSON 的长期记忆断言未满足。未发现确定性代码错误；失败未通过放宽断言处理。

独立重试结果：

- `real-project-search.test.ts`：1 个测试通过，约 2.6 秒；收到 `ready`、`search_project tool_start`、成功 `tool_end` 和 `response_end`，回答正确给出 `PROJECT-FACT.md` 及行号；
- `real-ndjson.test.ts`：1 个测试通过，包含两轮完整场景，约 22 秒；回答、记忆、目录检查、只读讨论、Approval 拒绝/批准、`new_session`、写入和退出均通过。

限制与待复核项：NDJSON `response_end` 在 Batch I-a 前只输出清理后的文本，不暴露 `projectSources` 或 citation marker；该缺口已由 Batch I-a 修复并通过真实项目检索断言。

### Batch I-a：NDJSON provenance projection 修复

状态：已完成
日期：2026-09-12

`response_end` 现在增加可选 `projectSources` 字段，仅投影 Runtime 已校验的 `{ path, startLine }`；无合法引用时省略字段。协议类型、runner、离线协议测试和真实项目检索提示词已同步。真实项目检索重试通过（约 3.1 秒），`response_end.projectSources` 断言通过；本次 Provider 先出现一次 `PROVIDER_TIMEOUT`，随后重试成功。

NDJSON 不输出 source hash、excerpt、query、Tool details 或绝对路径；旧客户端继续读取原有 `text` 字段即可。

## v0.2.4 收口结论

状态：已完成（未执行 Git add、commit 或 push）  
日期：2026-09-12

架构、Luna Batch A–I、Batch I-a 均已完成。离线门禁最终为 44 个测试文件通过、4 个跳过，173 条测试通过、4 条跳过；typecheck、build、pack check 和 diff check 通过。真实 DeepSeek 项目检索及完整两轮 NDJSON 场景通过，`response_end.projectSources` 真实投影通过。4 个跳过项仅为默认关闭的其他真实 smoke 场景，不构成 v0.2.4 失败。

## 失败定位与诊断优化

两次初始失败均未在独立重试中复现：项目检索重试约 2.6 秒通过，完整 NDJSON 两轮约 22 秒通过。因此当前证据更支持真实 Provider/子进程的瞬时无终态，而非确定性 Runtime 错误。长期记忆断言对应的离线 `captureExplicitMemory` 测试已覆盖同一中文句式和句末标点，故不能仅凭一次 `expected false` 判定生产记忆捕获缺陷。

已优化真实 smoke 的失败可观测性：项目检索超时现在附带最近事件和脱敏 stderr；长期记忆断言失败现在附带内容与 source 元数据摘要。两项诊断只在测试失败信息中出现，不写入生产日志、不放宽重试或验收断言。下次若复现，可直接区分 Provider timeout、协议终态缺失、Memory disabled、sessionId 不匹配或捕获时序问题。

## 真实 CLI 运行后的修复

用户在真实 Isla workspace 中查询 `ORBIT-731` 时，模型正确发现该字符串只存在于 smoke 测试代码中；但同时暴露出一个引用展示 bug：模型没有输出合法 citation marker，CLI 仍显示了本轮全部 retrieved 来源。原因是 Tool Loop 预先填充的 `projectSources` 在“无 cited”路径没有被清除。

已修复 `ChatSession`：无合法 cited source 时彻底移除 `ModelResponse.projectSources`，并新增“成功检索但回答不引用时不显示参考”回归测试。修复后 typecheck、来源展示/来源关联/协议专项共 17 条测试通过，`git diff --check` 通过。
