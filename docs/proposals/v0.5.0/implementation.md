# v0.5.0 实施计划

## 1. 执行原则

- v0.5.0 是一个完整版本方向，不拆成多个对外版本；内部仍按可独立验收的 Batch 顺序推进。
- 每个 Batch 完成后保持主分支可构建、可测试、可回退。
- 先固定契约和可复现样本，再实现 UI；Web UI 不成为唯一自动化入口。
- Resource Service 与 Isla Host 是两个独立进程，任何一方的长任务、崩溃或重启都不得阻塞另一方。
- 不为尚不存在的第二个平台建立通用下载器框架；百度网盘是首个且唯一的具体实现，其他平台只保留产品占位说明。
- 不整体重构现有 Runtime。只增加 Worker 模型角色和一个窄的结构化推理入口。

## 2. Batch A：契约、样本与配置冻结

状态：已完成（2026-10-09）。实现位于 `src/resource/`，离线验证位于 `tests/resource/` 与 `tests/fixtures/resource-cases.ts`。

目标：把设计文档转成可执行契约，避免前后端和两个进程各自猜测。

工作项：

1. 为 `api.md` 中的请求、响应、错误和事件建立 TypeScript schema；
2. 建立 Resource 独立配置 schema，包括监听地址、Isla endpoint、Worker Profile、managed roots、并发池和安全上限；
3. 建立脱敏 fixtures：普通分享、带提取码、多个密码候选、重命名压缩包、MP4 尾部 RAR、分卷、RAR5；
4. 固定 Job、Artifact、Event 和 File Ledger 的 SQLite migration；
5. 固定 API 版本前缀、错误码与 revision 并发控制语义。

停点：schema、migration 和 fixtures 可离线验证；尚不启动真实下载。

完成证据：Resource 定向测试 12/12 通过；项目全量测试 488 通过、11 个按环境跳过；TypeScript 类型检查通过。Batch A 未注册服务入口、未调用模型、未启动下载，也未改变现有 Runtime 行为。

## 3. Batch B：Isla Worker 模型角色与结构化推理

状态：已完成基础停点（2026-10-09）。结构化路由已接入 Resident Host；实际 Profile 到第二 Provider 的生产装配留在 Batch C 的服务启动装配中。

目标：让 Resource 使用第二个可配置模型，同时不把它变成第二套 Agent Runtime。

工作项：

1. 在 Profile/Config 中增加显式模型角色：`primary` 与 `worker`；
2. Worker 复用现有 Provider、模型目录、凭据解析和能力声明；
3. 增加 `POST /api/v1/inference/structured`；
4. Worker 请求禁用 Tool、Session、Memory 和 Agent Loop，只做有界结构化生成；
5. 增加输入、输出、超时、取消、脱敏诊断与 schema 校验；
6. 未配置 Worker 时明确返回稳定错误，不静默占用主模型。

停点：Fake Provider 与真实可选 Provider 都能返回符合 schema 的结构化结果；主会话无回归。

完成证据：Worker Profile 选择、结构化推理服务、Host Bearer 路由、未配置角色错误和 Fake Provider 校验已通过；定向测试 33/33、全量测试 494 通过、11 个按环境跳过，类型检查通过。Batch B 尚未调用真实百炼模型。

## 4. Batch C：Resource Service 最小骨架

状态：已完成基础停点（2026-10-09）。当前提供独立 Resource Service、SQLite 初始化、认证、公开配置和模拟 Job API。

目标：建立独立可启动、可恢复的服务边界。

工作项：

1. 独立进程入口、配置加载、健康检查和优雅关闭；
2. SQLite migration、Job/Event/Artifact/File Ledger repository；
3. API token、Origin 校验、请求大小限制和 managed-root ID 校验；
4. 最小 Web 页面：粘贴输入、选择输出根、查看任务列表、任务详情和事件；
5. SSE 重连与事件游标；
6. Windows 与 Linux 路径处理不进入 API 表面。

停点：无需下载器即可创建模拟 Job、观察状态、重启恢复和取消。

完成证据：Resource Service 测试 3/3 通过；全量测试 497 通过、11 个按环境跳过；类型检查通过。当前服务不会启动下载器、目录扫描或解压流程。

## 5. Batch D：输入解析与人工确认

状态：已完成规则解析基础停点（2026-10-09）。当前创建任务会持久化规则结果并进入 `preview/waiting_user`；Worker 消歧和真实下载仍未启动。

目标：把自然语言分享信息转换为确定的执行输入。

工作项：

1. 先做确定性规则解析：URL、提取码、常见密码标记、文件名提示；
2. 规则结果不足时调用 Isla Worker；
3. 合并并去重密码候选，保留来源和优先级；
4. 高置信度自动进入队列，歧义输入进入 `awaiting_confirmation`；
5. Web 与 API 都可确认、修订或取消；修订必须携带 revision。

停点：所有输入 fixtures 均产生稳定、可审计的解析结果，不触发真实下载。

完成证据：规则解析、密码候选拆分、多链接歧义、无链接警告和预览等待已通过；Resource 定向测试 22/22、全量测试 500 通过、11 个按环境跳过，类型检查通过。

## 6. Batch E：持久化调度、租约与并发池

状态：已完成调度基础停点（2026-10-09）。当前 Scheduler 已独立验证，尚未接入百度 runner。

目标：支持多个任务同时下载，并在崩溃后安全续跑。

工作项：

1. 实现持久队列、stage lease、heartbeat、超时回收和重试预算；
2. 建立相互独立的 `download`、`inspect`、`extract`、`inference` 并发池；
3. 下载默认并发至少为 2，并可在配置范围内调整；
4. 实现公平调度，避免单个 Job 的大量 Artifact 长期占满全部槽位；
5. 取消传播到当前外部进程，并等待 quiescence 后才报告终态；
6. 进程重启后回收陈旧租约，不重复发布已完成产物。

停点：使用 fake runners 证明两个下载可真正重叠执行，其他池不会被下载阻塞。

完成证据：download/inspection/extraction/inference 四个池独立；两个下载任务峰值并发为 2；单任务取消、Lease heartbeat 与过期回收通过。Scheduler 测试 3/3、全量测试 503 通过、11 个按环境跳过，类型检查通过。

## 7. Batch F：百度网盘具体下载实现

状态：已完成命令适配与下载 Runner 基础停点（2026-10-09）。真实登录和真实分享下载尚未执行。

目标：打通唯一的真实资源来源。

工作项：

1. 先做受控可行性验证：登录态、分享解析、文件枚举、下载、取消、错误识别；
2. 选定一个具体 runner，并记录版本、安装方式和 Linux/Windows 差异；
3. runner 只接收经过校验的参数，不接受任意 shell 字符串；
4. 下载到 Job staging 目录，完成前不暴露为最终 Artifact；
5. 对鉴权失效、提取码错误、限流、文件不存在和网络失败映射稳定错误码；
6. 保存必要诊断，但不保存 Cookie、token 或完整私人分享正文。

决策门：若候选 runner 无法同时满足 Windows 与 Linux 的核心路径，停止实现并向用户提交具体替代方案；不得借机抽象多平台接口。

当前候选观察：`bdpan-storage` Releases 页面当前列出 `baidu-drive v1.7.5`，并以外部 Skill 安装方式提供能力。正式接入前必须固定版本、下载其发布资产并通过命令探测/版本校验；禁止直接依赖“latest”或未经校验的命令参数。

当前实现：`BaiduDownloadRunner` 只负责把结构化分享下载请求映射为 Skill 规定的 `bdpan download` 参数，并解析脱敏后的 JSON 成功字段；不会负责登录、解压、发布或跨平台路径推断。

停点：Windows 上至少两个真实任务并发下载成功，取消和失败可复现。

## 8. Batch G：Managed Roots 与周期扫描

状态：核心路径已完成（2026-10-15）。`POST /scans` 可持久化文件夹 watch、立即递归发现内容签名为归档的文件，并通过 File Ledger 按路径、大小和 mtime 去重；后台定时器恢复 SQLite 中的 watch，连续稳定观察后自动创建并启动 `archive-organizer` Job。尚待真实大目录、断续写入和进程重启压力验收。

目标：让 Resource 长期“养在”用户指定目录中，自动接收新文件并整理。

工作项：

1. 配置一个或多个 managed root，每个 root 使用稳定 ID；
2. 周期 reconciliation 是事实源，文件系统事件仅用于提前唤醒扫描；
3. 使用文件大小、mtime、稳定观察窗口和 ledger 防止读取仍在写入的文件；
4. 同一文件重复发现不重复建 Job；内容变化后按新 revision 处理；
5. 手工粘贴任务与目录发现任务共用同一状态机；
6. 输出目录可从允许的 managed roots 中选择，禁止任意路径提交。

停点：Windows 与 Linux 的创建、重命名、断续写入、重启和重复扫描行为一致。

## 9. Batch H：识别、解压与安全边界

状态：核心闭环已完成。真实 `SevenZipTool` 与 `ArchiveOrganizer` 支持文件头识别、`7z t` 完整性测试、归档条目路径穿越检查、隔离 staging 解压、符号链接/文件数/单文件/总大小/膨胀率校验，以及同盘 rename/跨盘 copy 的发布。`archive-organizer` Job 可通过独立 extraction pool 运行到 `completed`；百度下载成功后会转入独立解压池。失败 Job 保存安全恢复点，并可携带 revision 原任务重试。

人工恢复已覆盖缺少/错误解压密码、分享码、登录、验证码、风控、缺卷和可替换分享文本。成功解压密码进入本机频率库；真实 AES ZIP 已验证无密码停点、用户补充、同 Job 恢复和下一 Job 自动复用。

目标：覆盖首版承诺的全部复杂压缩场景。

工作项：

1. 基于内容签名识别，不信任扩展名；
2. 检测重命名压缩包、MP4 尾部 RAR、RAR5 和分卷集合；
3. 以 7zz 为主，按证据使用 unrar fallback；
4. 按用户候选、解析候选和受控默认候选顺序尝试密码；
5. 解压到隔离 staging，检查路径穿越、符号链接、文件数、总大小和膨胀率；
6. 缺卷、错误密码、损坏、工具缺失和疑似炸弹分别进入稳定错误/人工处理状态；
7. 只有完整验证通过的目录才可发布。

停点：测试样本矩阵全部通过；错误样本不会污染输出目录。

## 10. Batch I：原子发布、整理与恢复

目标：形成用户能直接使用的完整输出。

工作项：

1. 生成确定的输出目录名和冲突策略；
2. 同文件系统优先原子 rename，跨文件系统使用 copy、校验、finalize；
3. 记录发布 manifest、来源 Job、文件清单和安全摘要；
4. 清理 staging 使用有界、可恢复策略，不能删除 managed root 中的用户原文件；
5. 实现失败后重试、人工补充密码、补卷后继续和服务重启恢复；
6. Web 展示最终路径、文件清单、失败原因和建议动作。

停点：粘贴输入后能取得完整解压目录，且重启、冲突和跨盘输出可验证。

## 11. Batch J：Web UI 收口与双平台验收

状态：独立 Resource Web 页面已完成首个可操作版本（2026-10-15）。`/resource` 提供百度下载、文件解压/整理、受管目录选择、双通道队列、人工修正、确认、取消与安全阶段重试；同源页面使用 HttpOnly 会话 Cookie，自动化 API 保留 Bearer Token。真实 Chromium 已验证无效分享文本修正与工具切换。主聊天三栏整合、SSE、产物清单以及 N100 Linux 最终验收仍未完成。

目标：交付 v0.5.0 唯一完整用户路径。

工作项：

1. 完成桌面 Web 布局：左侧对话记录、中间主对话、右侧工具箱与队列；
2. Resource 首版允许独立复制粘贴窗口，不要求主 Agent Tool 调用；
3. 明确下载并发、阶段进度、等待确认、取消、重试和产物入口；
4. Windows 完成开发验收；
5. N100 Linux 完成最终部署、重启、真实下载、完整解压和并发验收；
6. 更新安装、配置、故障排查和隐私说明，完成版本元数据与发布门禁。

停点：`testing.md` 的 P0 与真实验收全部通过，才允许标记 v0.5.0 完成。

## 12. 可后置但不阻塞 v0.5.0 的项目

- 将 Resource API 注册为 Isla Tool；
- 从主对话直接创建、查询和取消 Resource Job；
- Web UI 的移动端适配；
- 第二个资源平台；
- 通用插件 SDK、动态加载和插件市场；
- 多用户、公网部署与远程身份体系。

这些项目只有在核心粘贴到完整解压路径稳定后才重新评估。
