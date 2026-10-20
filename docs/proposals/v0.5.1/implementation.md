# v0.5.1 Luna 实施计划

## 1. 执行目标

Luna 需要在不扩展产品范围的前提下，补齐 `Resource -> Isla Host -> 本地 3B resource-worker` 的生产链路，并把 Worker 的结构化建议接入分享文本解析、内容判断和命名。

本计划以 [`design.md`](design.md) 为契约，以 [`testing.md`](testing.md) 为验收门禁。若实现中需要改变现有 Session、Tool、Approval、Sandbox 或 Provider 核心契约，必须停止当前 Batch，先向用户说明原因并更新设计；不得顺手重构 Runtime。

## 2. 全程约束

- 每次只完成一个 Batch，并在停点执行对应测试；
- 先读当前源码和现有测试，不从 v0.5.0 文档复制已经过时的实现判断；
- 保持 Resource 无模型可运行；
- Worker 不得到 Tool、Session、Memory、主对话 system prompt 或文件权限；
- Resource 不读取 Provider API Key，也不加载 Provider SDK；
- 不改变现有下载、解压、密码库、人工介入和文件发布语义；
- 不实现主 Agent Resource Tool、主 WebUI、反馈、自更新或新下载平台；
- 不执行 Git commit 或 push；
- 任何真实模型输入和原始响应只保存在被忽略的本地评估目录，不能进入仓库。

## 3. Batch A：事实基线与缺口测试

目标：先用测试固定当前缺失的生产行为，防止把已有骨架误当成完成。

步骤：

1. 读取 `src/main.ts`、`src/application.ts`、`src/host.ts`、`src/resource-main.ts`、`src/resource/service.ts`、`src/resource/inference.ts` 和 Provider 创建路径；
2. 记录 workerProfile 从 Config 到 Provider 的当前断点；
3. 为以下缺口增加失败测试：
   - 正常 Host 装配可以绑定独立 Worker Provider；
   - Resource 使用配置的 endpoint/token 调用 Host；
   - `identify-content` 与 `suggest-title` 输出会执行运行时校验；
   - 规则不足时进入 Worker，规则充分时不调用；
   - Worker 失败后任务仍走规则/人工路径；
4. 确认测试夹具不包含真实链接、密码、Token、路径或私人文件名；
5. 不在本 Batch 修改生产行为。

停点：新增测试因明确缺失的生产能力失败；原有测试仍保持原基线，没有无关失败。

## 4. Batch B：补全三类结构化契约

目标：让每个 Worker 任务都有独立、完整且有界的输入输出验证。

步骤：

1. 在 `src/resource/contracts.ts` 增加 `ResourceContentInputV1`、`ResourceContentResultV1`、`ResourceTitleInputV1` 和 `ResourceTitleResultV1`；
2. 为三个 task 建立 task -> schema -> input validator -> output validator 的唯一映射；
3. 给 relativePath、数组长度、字符串长度、条目数量、总输入大小、枚举和 confidence 建立边界；
4. 拒绝绝对路径、`..`、不存在的目录引用和未知字段是否允许，必须形成一致策略并写入测试；
5. 修正 `ResourceStructuredInferenceService` 当前只校验 parse-result 的行为；
6. 非法 JSON 与 schema 错误统一映射现有稳定错误码，不暴露模型原文。

停点：三个 task 的合法/非法 fixture 均有单元测试；task/schema 不匹配、越界输入、幻觉路径和无效标题均被拒绝。

## 5. Batch C：Host 生产装配 Worker Profile

目标：让正常 Isla Host 启动路径真正创建独立 Worker Provider。

步骤：

1. 复用现有 Provider 创建逻辑，避免为 Worker 复制协议适配器；
2. 从 Config 的 `workerProfile` 解析 Provider、model、baseURL 和凭据；
3. 创建 `ResourceStructuredInferenceService` 并绑定到 Resident Host；
4. 固定每次响应中的 `ResourceModelSnapshotV1`；
5. 未配置 Worker 时保留 `ROLE_NOT_CONFIGURED`；配置无效或模型不可达时给出安全诊断；
6. 确认 primary 与 worker 为不同配置时，请求不会串线；
7. 关闭 Host 时收敛 Worker 请求，并复用 Provider 的既有关闭边界。

停点：Fake primary + Fake worker 的生产装配测试通过；一次主会话和一次结构化请求分别命中正确 Provider；未配置 Worker 不影响主会话。

## 6. Batch D：Resource Structured Inference Client

目标：Resource 只通过既有 HTTP 契约调用 Host，不接触模型实现。

步骤：

1. 新建位置遵循 `src/resource/` 现有结构，若文件名或位置存在歧义先向用户确认；
2. 客户端从 Resource Config 读取 `isla.endpoint` 与 `isla.token`；
3. 调用 `POST /api/v1/inference/structured`，设置 Bearer、JSON、超时与 AbortSignal；
4. 校验 HTTP 状态和成功/错误响应，不信任远端 JSON；
5. 对外返回稳定的成功结果或现有错误码；
6. 日志与异常不得包含 token、完整请求正文或模型原始响应；
7. 在 `resource-main.ts` 完成客户端注入，但此 Batch 暂不改变 Job 的调用策略。

停点：使用本地 fake Host 证明认证、成功、401、503、超时、取消、非法 JSON 和过大响应均可收敛；Resource 单独启动且 Host 不可用时仍能提供 Web/API 和规则能力。

## 7. Batch E：接入解析 Worker

目标：只在分享文本规则不足时调用 `resource.parse-share-text`。

步骤：

1. 把“规则是否足够”提取为可单测的确定性判定；
2. 规则充分时保持当前路径，不产生模型请求；
3. 规则不足时将 Job 置为 `parsing_model`，通过 inference pool 调用 Worker；
4. 合并时保持已验证规则字段优先，Worker 只补充或提出冲突；
5. 冲突、低可信或 `needsReview` 进入当前 Job 的人工确认，不新建 Job；
6. Worker 不可用、超时、取消、非法输出时保留规则结果；
7. 不把分享码和解压密码写入普通事件、日志或模型快照；
8. 用户 `replace_input` 后从同一 Job 重新执行规则判定，必要时重新调用 Worker。

停点：规则充分零调用、歧义输入一次调用、冲突人工确认、Worker 失败降级、取消收敛和同 Job 修订全部通过。

## 8. Batch F：接入内容判断 Worker

目标：让文件检查脚本在自身无法判断目录语义时调用 `resource.identify-content`。

步骤：

1. 从已验证的 staging manifest 生成相对路径摘要；
2. 对条目排序，限制数量、单项长度和总字节；超限时生成确定性摘要；
3. 不发送绝对路径、文件正文、密码、命令输出或秘密；
4. 只有脚本无法区分有意义目录与包装目录时调用 Worker；
5. 校验 Worker 引用的每个目录确实存在于输入；
6. Worker 结果只能影响目录语义建议，不能跳过路径安全、归档完整性或发布校验；
7. 不确定结果进入现有人工决策或保持原结构，不能擅自删除内容。

停点：系列目录保留、无意义包装目录建议、混合内容、不存在路径、超大 manifest 摘要和 Worker 失败降级测试通过。

## 9. Batch G：接入命名 Worker

目标：只有现有命名来源均不足时调用 `resource.suggest-title`。

步骤：

1. 保持“显式名称 -> 规则名称 -> Worker -> 文件名 -> 人工 -> 时间兜底”的既有顺序；
2. 显式名称或规则名称可用时不调用 Worker；
3. 输入只使用有界候选和已校验的 content summary；
4. Worker title 经过现有清理、无意义名称过滤和路径安全检查；
5. `source: "worker"` 保持 `needsConfirmation: true`；
6. Worker 返回空标题、非法标题或失败时继续文件名/人工/时间兜底；
7. 名称冲突继续使用当前人工介入，不由模型选择覆盖。

停点：调用条件、候选清理、中文名称、哈希/时间戳拒绝、冲突确认和降级测试通过。

## 10. Batch H：本地 3B 真实验收

目标：证明这套任务边界确实能由用户配置的本地 3B OpenAI-compatible 模型完成，而不是只对 Fake Provider 成立。

步骤：

1. 使用 Config/Profile 配置真实本地 3B 模型，不把主机、模型名或凭据写入仓库；
2. 在 `.isla-local/evaluations/v0.5.1/` 保存原始运行材料；
3. 使用脱敏固定用例分别执行 parse、identify 和 title；
4. 记录 schema 合格、事实一致、是否需要人工修正、延迟、失败和降级原因；
5. 完成至少一次 Resource Web/API 到 Worker 再回到同一 Job 的真实闭环；
6. 关闭 Worker 或配置错误后，复验 Resource 规则路径仍可完成；
7. 根据失败证据只调整 prompt、输入摘要或 schema，不增加 Tool、Session、Memory 或循环；
8. 把脱敏结论写入验收记录，原始输入输出保持在忽略目录。

停点：满足 `testing.md` 的发布门禁；若 3B 模型无法稳定完成某个任务，必须如实标记该任务未通过，不得用云端大模型结果替代。

## 11. Batch I：文档与发布收口

目标：让源码、测试和当前文档对 v0.5.1 的能力描述一致。

步骤：

1. 更新 `README.md` 的 Worker 配置和降级说明；
2. 更新 `docs/current/architecture.md`，删除仍以 0.4.8 为全部事实源且与 Resource 冲突的描述；
3. 更新 `docs/current/implementation.md` 和 `docs/current/testing.md` 的入口与测试导航；
4. 更新 `docs/roadmap.md`，区分 v0.5.0 的规则闭环与 v0.5.1 的 Worker 生产闭环；
5. 更新版本号前先获得用户确认；
6. 执行 typecheck、Resource 定向测试、全量测试、build 与 `npm pack --dry-run`；
7. 检查包内容不含 `.runtime`、`.isla-local`、配置、Token、私人输入和评估原文；
8. 不执行 commit 或 push。

停点：所有文档以当前源码为事实源；发布检查通过；工作区只包含本版本相关改动。

## 12. Luna 完成报告格式

每个 Batch 完成后报告：

1. 本 Batch 实际改变的行为；
2. 修改文件；
3. 执行的测试及结果；
4. 未完成项和下一 Batch；
5. 是否发现设计偏差、隐私风险或需要用户决策的问题。

最终报告必须明确区分：离线测试结果、真实本地 3B 结果、Windows 结果、N100/Linux 结果和未执行项。不得把 Fake Provider 通过表述为真实模型闭环通过。
