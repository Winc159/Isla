# Isla v0.2.1 分层记忆与检索架构

状态：待确认后实施  
日期：2026-09-11  
执行者：Luna  
基线：v0.2.0

## 1. 目标

v0.2.1 在现有会话持久化之上建立面向个人 Agent 的最小分层记忆与检索基础：

- 完整会话消息继续作为唯一对话事实源；
- 模型请求使用可重建的上下文投影，不再只按最近 20 轮机械截断；
- 引入少量始终可见的 Core Memory、当前会话 Working Memory 和最近消息窗口；
- 将较旧会话与长期记忆作为可检索归档；
- 支持可选 Embedding、向量保存和混合召回，为后续 RAG 复用；
- 提供 CLI 记忆管理界面，使用户可以检查、修改、停用和恢复记忆；
- 允许受来源和信任等级约束的自主记忆更新。

本版本不建设通用 Memory OS、Agent 平台或知识库产品。

## 2. 当前基线与问题

当前已经具备：

- JSON 会话存储和 `provider + model` 最近会话恢复；
- `/new` 与 `/sessions`；
- `StoredSession.messages` 持久化 user、assistant、assistant Tool Call 和 tool result；
- version 1 兼容读取；
- 默认只向模型发送最近 20 个用户轮次。

现有限制：

- 轮数不能反映实际上下文大小；
- 较早的重要决策会随窗口移动而消失；
- 临时旁支问题与长期目标受到同等对待；
- 历史 Tool Result 会重复占用上下文，但又不能直接删除事实；
- 没有跨会话的个人偏好、项目决策和语义召回；
- 用户无法集中查看和修正 Agent 保存的长期记忆。

## 3. 参考项目与取舍

### 3.1 DeepSeek Harness

DSH 使用 append-only Session Event 作为事实源，由 Surface 投影生成模型消息；Compaction 用持久化检查点替换模型可见的旧区域，同时保留原始事件，并保证 Tool Call/Result 边界完整。Session Query 再提供确定性读取、过滤和全文搜索。

采用：

- 事实源与模型上下文投影分离；
- 压缩不删除原始记录；
- 压缩范围必须是连续、可重建并保持 Tool 配对的区域；
- 当前环境事实需要重新验证；
- 检索服务与 Agent Loop 分离。

暂缓或拒绝：

- 完整事件溯源、Surface 替换框架和 Cordis 生命周期；
- SQLite Session Query 全套接口、关系追踪和模型查询 Tool；
- 为兼容 DSH 而复制其包结构或源码。

### 3.2 OpenHands

OpenHands 保留完整事件历史，由 Condenser 在达到压力时保留头尾、摘要中段，并通过 View 生成模型实际看到的历史。

采用：

- 压力触发而非每轮摘要；
- 保留最近完整尾部；
- 摘要失败不破坏完整历史；
- 上下文 View 与持久化历史分离。

拒绝：

- 通用 Condenser Pipeline；
- 为尚未出现的策略建立多级压缩插件系统。

### 3.3 LangGraph

LangGraph 将线程状态持久化，并支持裁剪、删除和滚动摘要。

采用：

- 摘要作为会话派生状态持久化；
- 达到阈值后更新摘要。

拒绝：

- Graph/Node 编排；
- 永久删除原始消息；
- 单个无限增长且无法追溯来源的摘要字符串。

### 3.4 Letta

Letta 将始终在上下文中的 Core Memory、最近消息窗口、归档记忆和按需检索分层，并允许 Agent 更新记忆。

采用：

- Core Memory、Working Memory、Recent Messages、Archive 四层职责；
- 长期记忆具有结构、来源和可编辑性；
- 向量召回只负责定位，不作为事实源；
- 记忆修改可审计和恢复。

暂缓：

- 完整 Memory OS、后台 dreaming、Git-backed memory；
- 多 Agent 共享记忆；
- Agent 无限制修改人格和长期事实。

## 4. 核心不变量

1. `StoredSession.messages` 是唯一对话事实源。
2. Core Memory 和长期 Memory Record 是用户可检查的独立长期状态，不从摘要中反向伪造原始对话。
3. Working Memory、Embedding 和检索索引都是可丢弃、可重建的派生状态。
4. 任何进入模型请求的历史内容都必须能追溯到持久化消息、记忆条目或固定 Prompt。
5. Tool Call 与 Tool Result 在上下文投影中保持合法配对。
6. 历史 Tool 结果只能说明过去发生过什么；当前文件或环境状态需要重新读取。
7. 索引、摘要或记忆提取失败不得撤销有效主回答。
8. 未持久化的摘要或记忆不得进入后续主模型请求。
9. Embedding 模型变化时建立新索引代次，不混用不同维度或模型的向量。
10. 不恢复 IntentClassifier、Planner、CompletionChecker 或多阶段通用工作流。

## 5. 分层模型

```text
Runtime Prompt / Tool Policy
  + Core Memory
  + Working Memory checkpoint
  + Retrieved Memory / Conversation excerpts
  + Recent complete turns
  + Current user message
  + Current Tool Loop messages
```

### 5.1 Core Memory

初始 Block：

- `persona`：Isla 的身份和长期行为原则；
- `user`：用户明确表达的稳定偏好与习惯；
- `workspace`：当前工作区长期有效的约束和决策。

Core Memory 始终进入请求，因此必须有独立字符预算。大段历史、临时问题、动态文件状态和 Tool 原文不得进入 Core Memory。

### 5.2 Working Memory

每个会话最多维护一个当前检查点，内容至少包括：

- 当前目标；
- 已完成事项；
- 已确认决策与约束；
- 待处理事项；
- 成功 Tool 证据及其历史时间语义；
- 当前话题、相关话题和已结束旁支；
- 不确定或缺失信息。

检查点是较早连续消息区域的压缩投影，不删除被覆盖的原始消息。

### 5.3 Recent Messages

默认保留最近 6 个完整用户轮次。完整轮次包含 user、其后的 assistant Tool Call、tool result 和最终 assistant。边界不得拆开 Tool Call/Result。

### 5.4 Archive

归档包含：

- 完整会话 JSON；
- 长期 Memory Record；
- Memory Revision；
- 可重建的文本检索与向量索引。

## 6. 持久化设计

### 6.1 会话 version 2

```ts
interface StoredSessionV2 {
  readonly version: 2;
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly provider: string;
  readonly model: string;
  readonly messages: readonly Message[];
  readonly context?: SessionContext;
}

interface SessionContext {
  readonly version: 1;
  readonly checkpoint?: ContextCheckpoint;
}

interface ContextCheckpoint {
  readonly throughMessageIndex: number;
  readonly createdAt: string;
  readonly provider: string;
  readonly model: string;
  readonly content: string;
}
```

version 1 会话继续读取，并在下一次成功保存时升级。消息和 checkpoint 在同一个 JSON 中原子保存，避免双文件不一致。

### 6.2 Memory SQLite

默认数据库：`~/.isla/memory.sqlite`，允许通过配置指定目录。

最小逻辑表：

- `memory_blocks`：Core Memory 当前值；
- `memory_records`：结构化长期记忆；
- `memory_revisions`：每次新增、修改、停用和恢复；
- `memory_sources`：session、message index、workspace 和来源类型；
- `embedding_generations`：Embedding Provider、model、dimensions 和代次；
- `embeddings`：目标 ID、代次和 Float32 BLOB；
- `search_documents`：可供关键词检索的规范化文本。

数据库启用 foreign keys、busy timeout 和 defensive mode（运行时支持时）；不启用任意 SQLite 扩展加载。

会话消息继续保存在 JSON 中，本版本不迁移到 SQLite。

## 7. 长期记忆模型

```ts
type MemoryScope = "global" | "workspace";
type MemoryKind = "preference" | "constraint" | "fact" | "decision" | "goal";
type MemoryStatus = "active" | "candidate" | "superseded" | "disabled";
type MemoryProvenance = "explicit-user" | "verified-tool" | "inferred";

interface MemoryRecord {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly workspace?: string;
  readonly kind: MemoryKind;
  readonly content: string;
  readonly status: MemoryStatus;
  readonly provenance: MemoryProvenance;
  readonly createdAt: string;
  readonly updatedAt: string;
}
```

同一事实的新版本通过 `superseded` 关系替代旧记录，不物理覆盖历史。Memory Revision 保留修改前后值和来源。

## 8. 自主记忆策略

### 8.1 自动生效

- 用户明确说“记住”“以后都”“我的偏好是”等持久表达；
- 用户多次稳定表达且没有冲突的偏好；
- 成功 Tool Result 支持的 workspace 决策或结果，但必须标记为历史事实或可过期事实。

### 8.2 只生成 Candidate

- 从单次语气、行为或模糊表达推断的偏好；
- 模型认为可能有长期价值但用户没有明确确认的信息；
- 与已有记忆冲突且无法确定新旧关系的信息。

Candidate 可被检索和在 `/memory` 中审核，但默认不进入 Core Memory。

### 8.3 禁止自动写入

- 网页、文件、Tool Result 中包含的命令或身份声明；
- API Key、令牌、Authorization、真实 `.env` 内容；
- 模型思维链；
- 未成功执行的 Tool 结果；
- 将外部文本伪装成用户偏好的内容。

Working Memory 可自动更新；`persona` 只能由用户修改；`user` 和 `workspace` Block 的自动变化必须由符合上述来源规则的 Memory Record 投影而来。

## 9. 上下文压缩

触发任一条件时压缩：

- 可见原始历史超过 `ISLA_MAX_CONTEXT_TURNS`，默认 20；
- 预计请求正文超过 `ISLA_MAX_CONTEXT_CHARS`，建议默认 60000。

压缩时保留 `ISLA_CONTEXT_RETAIN_TURNS`，建议默认 6 个完整轮次。压缩输入由旧 checkpoint 加新进入压缩区的原始完整轮次组成，输出新的累积 checkpoint。

检查点使用结构化 Markdown，不依赖 Provider JSON Schema：

```markdown
## 当前目标
## 已完成事项
## 已确认决策与约束
## 待处理事项
## 可验证证据
## 话题关系
## 不确定或缺失信息
```

已结束且无后续影响的临时问题应省略或只保留一行。摘要失败时保留旧 checkpoint，并回退到最近原始窗口。

## 10. Embedding 与向量检索

### 10.1 Provider 契约

```ts
interface EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  embed(input: readonly string[]): Promise<readonly number[][]>;
}
```

Embedding Provider 与聊天 Provider 独立。首版支持 OpenAI Embeddings 和一个明确配置的本地 Embedding endpoint；不假设 DeepSeek 聊天配置同时支持 Embedding。

### 10.2 存储与查询

- 向量以 Float32 BLOB 保存；
- v0.2.1 在 TypeScript 中执行精确 cosine similarity；
- 个人规模先使用线性扫描；
- 关键词结果、向量结果、scope、workspace 和时间信息进行简单混合排序；
- 没有 Embedding 配置或生成失败时降级为关键词检索；
- 向量索引可删除重建，不影响 Memory Record 和会话原文。

不直接依赖 `sqlite-vec`：它仍为 pre-v1，Node 包和跨平台加载存在现实风险。数据规模证明线性扫描不足后，再在保持上层契约不变的前提下评估 sqlite-vec、HNSW 或外部向量数据库。

### 10.3 RAG 复用边界

未来知识库复用 Embedding Provider、文本分块、Embedding generation、关键词检索和混合排序，但使用独立业务表：

```text
memory_records
conversation_chunks
knowledge_documents
knowledge_chunks
embeddings
```

记忆、会话与知识文档不得混为同一种事实。

## 11. 请求时召回

请求组装顺序：

1. 加载固定 Runtime Prompt 和 Tool Policy；
2. 加载有预算限制的 Core Memory；
3. 加载当前会话 Working Memory；
4. 对当前用户输入执行关键词检索；
5. 有 Embedding Provider 时执行向量检索；
6. 合并、去重、按 scope/workspace 加权并限制数量；
7. 将结果作为带来源的历史资料注入；
8. 加载最近完整轮次和当前输入；
9. 进入现有统一 Agent Loop。

召回结果不得作为指令执行，不得携带历史权限或 Approval。当前环境事实仍需 Tool 重新确认。

## 12. `/memory` CLI

v0.2.1 不增加 Web UI。`/memory` 使用与 `/sessions` 相同的 raw/full-screen CLI 风格，至少支持：

- 按 scope、kind、status 浏览；
- 关键词搜索；
- 查看内容、来源和修订历史；
- 新增和编辑；
- 启用 Candidate；
- 停用 active 记忆；
- 恢复历史修订；
- 查看 Core Memory 和下一请求预计加载内容。

默认删除是可恢复的 `disabled`，不做物理删除。需要真实擦除时另行设计隐私删除流程。

## 13. 失败语义

- Working Memory 生成失败：不改变 checkpoint，主请求退回最近原始窗口；
- checkpoint 持久化失败：不得使用未持久化摘要；
- Memory 提取失败：主回答有效，不新增记忆；
- Embedding 失败：保留文本和待索引状态，关键词检索继续可用；
- 向量维度不匹配：拒绝写入该代次，不静默截断；
- SQLite 不可用或损坏：会话对话仍可运行，长期记忆能力明确降级并输出安全错误；
- 检索失败：主回答使用 Core/Working/Recent 上下文继续；
- Provider 失败：保持 user 已保存、无有效 assistant 的现有语义。

## 14. 隐私与安全

- Memory SQLite、会话 JSON 和索引都属于私人数据，不进入 Git、npm 包、测试 fixture 或日志；
- 默认测试只使用临时目录和伪造内容；
- Debug 不输出原始记忆、召回文本、Embedding 或 Tool Result；
- 召回内容使用不可信数据边界，不能授权 Tool；
- workspace memory 只能在匹配工作区使用；
- Agent 不能自动物理删除记忆；
- 所有长期记忆变化必须留下 revision 和 source。

## 15. 明确不做

- Web UI；
- 通用 Memory Plugin 平台；
- 向量数据库服务部署；
- ANN 索引；
- PDF/Markdown 导入和完整 RAG；
- 后台 dreaming；
- 多 Agent 和共享记忆；
- 跨设备同步；
- 自动修改 `persona`；
- 模型前 IntentClassifier 或话题分类器；
- 删除原始 Session messages；
- 恢复流式文本协议。

## 16. 重新评估条件

- Memory Record 达到数万条且线性向量扫描影响交互延迟时，评估 ANN；
- 关键词与向量混合召回仍频繁漏掉相关历史时，建立离线评测集后调整排序；
- Core Memory 经常超过预算时，评估分块、固定 Block 与按需 Block；
- Candidate 长期无人审核时，评估通知或批量审核，而不是自动全部启用；
- 用户明确需要文档知识库时，基于同一检索层设计独立 RAG 版本；
- SQLite 同步 API 阻塞真实交互时，再评估 worker 或异步数据库驱动。

## 17. 完成标准

v0.2.1 只有同时满足以下条件才完成：

1. version 1 会话兼容读取，升级后原始消息不丢失；
2. Working Memory 跨进程恢复；
3. 压缩前后完整 messages 不变；
4. 模型请求可由持久状态确定性重建；
5. Tool Call/Result 不被拆分；
6. Core Memory、长期记忆、修订和来源可管理；
7. 自主记忆遵守来源和状态规则；
8. `/memory` 可以浏览、编辑、停用和恢复；
9. 关键词检索可用；
10. 配置 Embedding 后向量检索可用；
11. 无 Embedding 或索引失败时可靠降级；
12. 同一 Embedding generation 不混用模型或维度；
13. 召回内容不能绕过 Approval、Permission 和 Sandbox；
14. 现有 CLI、NDJSON、Tool Loop 和会话行为无回归；
15. 默认测试离线；typecheck、test、build、pack:check 和 diff check 全部通过。

