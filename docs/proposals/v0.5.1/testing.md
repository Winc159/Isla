# v0.5.1 验收与测试计划

## 1. 验收目标

v0.5.1 的完成标准不是“存在 Worker 类或接口”，而是以下真实闭环成立：

> Resource 先执行确定性规则；当分享文本、内容结构或名称无法确定时，通过 Isla Host 调用用户配置的本地 3B Worker；Worker 返回通过 schema 和事实校验的结构化建议；Resource 在同一个 Job 中采用建议、请求人工确认或安全降级；Worker 不可用时原有规则闭环仍可运行。

## 2. 测试分层

### 2.1 单元测试

- 三类输入输出 schema 与 task/schema 映射；
- 输入大小、数组数量、字符串长度、相对路径和枚举边界；
- 规则充分/不足的调用判定；
- 规则结果与 Worker 结果合并；
- content manifest 摘要与路径事实校验；
- title 清理、无意义名称过滤和确认策略；
- Worker 错误到 Resource 降级结果的映射；
- model snapshot 与秘密脱敏。

### 2.2 组件测试

- Config `workerProfile` 到独立 Provider 装配；
- Resident Host 认证、结构化调用、取消和错误响应；
- Resource inference client 的成功、401、503、超时、取消和非法响应；
- inference pool 并发限制；
- Resource Service 在 Host 不可用时保持健康和规则功能；
- Job stage、revision、事件和人工决策在 Worker 前后的连续性。

### 2.3 端到端离线测试

- Fake primary 与 Fake worker 明确分离；
- Web/API 创建 Job 后触发一次 Worker 并回到同一 Job；
- Worker 失败后继续下载或进入人工确认；
- 服务重启后不重复采用旧 revision 的 Worker 结果；
- 取消运行中的推理后 Job 收敛，不遗留 lease；
- 并发下载、解压与推理池互不阻塞。

### 2.4 真实本地模型测试

- 使用用户实际配置的 OpenAI-compatible 3B 模型；
- 不使用云端大模型代替发布验收；
- 原始输入、输出和时间记录保存在 `.isla-local/evaluations/v0.5.1/`；
- 仓库只保留脱敏场景、统计和结论。

## 3. 固定验收场景

### 3.1 分享文本解析

| ID | 场景 | 预期 |
|---|---|---|
| PARSE-01 | 唯一标准链接、明确分享码和标题 | 只走规则，Worker 调用次数为 0 |
| PARSE-02 | 混合自然语言、链接与密码分散 | 调用 Worker，输出通过 schema，合并后字段正确 |
| PARSE-03 | 多个链接无法确定归属 | 不擅自选择，进入人工确认 |
| PARSE-04 | Worker 返回与规则冲突的链接 | 规则事实不被覆盖，进入人工确认 |
| PARSE-05 | Worker 非法 JSON | 保留规则结果并降级，不使 Job 崩溃 |
| PARSE-06 | Worker schema 合法但引用输入外链接 | 事实校验拒绝，不自动执行 |
| PARSE-07 | Worker 超时或模型不可达 | 规则/人工路径继续 |
| PARSE-08 | 用户替换输入 | 同一 Job revision 前进，旧 Worker 结果不能覆盖新输入 |

### 3.2 内容判断

| ID | 场景 | 预期 |
|---|---|---|
| CONTENT-01 | `第一季/EP01...` | 识别 season，保留有意义目录 |
| CONTENT-02 | `未命名文件夹/视频/...` | Worker 可建议包装目录，但脚本校验后才提升内容 |
| CONTENT-03 | 多个同级系列目录 | 不错误折叠成单一目录 |
| CONTENT-04 | 视频、图片和说明文件混合 | 返回 bounded category/structure，不删除未知文件 |
| CONTENT-05 | Worker 引用不存在的目录 | schema 后事实校验拒绝 |
| CONTENT-06 | manifest 超过输入预算 | 生成确定性摘要，绝对路径和正文不进入请求 |
| CONTENT-07 | Worker 不可用 | 保持现有脚本结果或请求人工确认 |
| CONTENT-08 | 路径穿越或符号链接 | 在模型调用前由安全脚本拒绝，Worker 无权放行 |

### 3.3 命名建议

| ID | 场景 | 预期 |
|---|---|---|
| TITLE-01 | 用户已有显式名称 | 不调用 Worker |
| TITLE-02 | 规则已有有用中文标题 | 不调用 Worker |
| TITLE-03 | 下载名是长哈希 | Worker 给出有用候选，并要求确认 |
| TITLE-04 | Worker 返回纯时间戳或通用名 | 拒绝并继续兜底 |
| TITLE-05 | Worker 返回路径字符或绝对路径 | 清理或拒绝，不能逃出目标目录 |
| TITLE-06 | Worker 返回空标题 | 继续文件名、人工或时间兜底 |
| TITLE-07 | 目标名称冲突 | 进入现有冲突决策，不自动覆盖 |
| TITLE-08 | Worker 不可用 | Job 仍能完成或进入人工命名 |

### 3.4 模型与进程隔离

| ID | 场景 | 预期 |
|---|---|---|
| ROLE-01 | primary 与 worker 配置为不同 Provider | 两类请求分别命中正确 Provider |
| ROLE-02 | 未配置 workerProfile | Host 返回 `ROLE_NOT_CONFIGURED`，主会话可用 |
| ROLE-03 | Worker 服务离线 | Resource 增强降级，Resource API 与主会话可用 |
| ROLE-04 | Worker 请求运行时关闭 Resource | AbortSignal 生效并释放 inference lease |
| ROLE-05 | Worker 并发超过配置 | 请求有界排队，不无限并发或占用其他池 |
| ROLE-06 | Worker 输出包含额外说明文字 | 非法输出被拒绝或在一次有界格式修复后通过 |
| ROLE-07 | Worker 尝试请求工具 | 没有 Tool schema，输出不能触发执行 |
| ROLE-08 | Profile 修改但进程未重启 | 活动请求保持创建时快照，不发生中途切换 |

## 4. 本地 3B 真实评测集

评测集至少包含经过脱敏的：

- 6 条规则可完全解析的对照输入；
- 10 条需要自然语言消歧的分享文本；
- 8 组目录结构，其中包含季、合集、无意义包装目录和混合内容；
- 8 组命名输入，其中包含中文标题、哈希、时间戳、乱码和通用名称；
- 4 条应主动返回 `needsReview` 的不确定输入；
- 4 条错误或越界输出注入用例，用于验证服务端校验而不是模型能力。

同一固定集合至少连续运行 3 轮，以发现 3B 模型输出波动。记录：

- JSON 可解析率；
- schema 合格率；
- 事实一致率；
- 正确进入人工确认的比例；
- 错误自动采用次数；
- P50/P95 延迟；
- 超时、取消和 Provider 错误；
- 降级后 Job 是否继续。

不预先要求所有语义判断 100% 正确，但以下为硬门禁：

- 错误自动采用次数必须为 0；
- 越界路径、输入外事实和非法名称不得进入执行；
- 规则充分的对照输入不得无故调用 Worker；
- Worker 失败不得破坏原有可完成路径；
- 三类任务都必须至少有一个真实成功闭环；
- 评测结论必须如实列出需要人工修正的案例。

如果某类任务在 3 轮中频繁无法输出合法 schema，应停止发布该任务的 Worker 接入，保留规则路径，并记录需要缩小输入或 schema 的证据；不得用云端大模型通过掩盖本地 3B 失败。

## 5. 隐私与安全验收

- Worker 请求不包含主 Session、Memory、Tool schema 或主 system prompt；
- content/title 输入不包含绝对路径或文件正文；
- API Key、Bearer、百度 Token、分享码和解压密码不出现在日志、事件、错误、快照和测试输出；
- `parse-share-text` 为完成解析可以接收用户原始分享文本，但只能发送给用户明确配置的 Worker Profile，且不得写入普通诊断；
- 本地评估目录被 Git 忽略；
- `npm pack --dry-run` 不包含配置、数据库、评估原文或真实资源；
- Worker 不能绕过 managed roots、archive traversal、安全上限、人工确认和覆盖决策。

## 6. 降级与恢复验收

以下条件分别复验：

- Host 未启动；
- token 错误；
- workerProfile 未配置；
- 本地模型服务拒绝连接；
- 请求超时；
- 用户取消；
- 非法 JSON；
- schema 不匹配；
- 模型返回幻觉路径；
- Resource 或 Host 在请求中重启。

每种情况下必须满足：

1. 不泄漏秘密；
2. 不把不确定建议当成事实；
3. Job 进入可解释状态；
4. 已有规则可继续时继续；
5. 必须由用户决定时在原 Job 请求人工介入；
6. 不残留永久 running 状态或 inference lease。

## 7. 回归门禁

至少执行：

```powershell
npm run typecheck
npm run test
npm run build
npm pack --dry-run
```

并单独报告：

- Resource 定向测试；
- Host/Config/Provider 定向测试；
- 全量离线测试；
- Windows 真实本地 3B 评测；
- N100/Linux 部署与本地模型网络连通评测；
- 未执行或因环境跳过的项目。

不得只报告“全量测试通过”而省略真实 3B 是否执行。

## 8. 发布通过条件

全部满足才可声明 v0.5.1 完成：

1. 三个 Worker task 均有完整输入输出 schema 和运行时校验；
2. 正常 Host 装配真正使用独立 workerProfile；
3. Resource 使用配置的 endpoint/token 调用 Host；
4. 解析、内容判断和命名均至少有一个真实本地 3B 成功闭环；
5. 规则充分时不调用 Worker；
6. Worker 失败、缺失和取消均能安全降级；
7. Worker 不直接执行文件操作；
8. 没有秘密、私人原文或真实配置进入仓库和 npm 包；
9. typecheck、定向测试、全量测试、build 和 pack 检查通过；
10. 当前文档准确描述 v0.5.0 与 v0.5.1 的实际边界；
11. Windows 与目标 N100/Linux 环境结果分别记录，未验证项不得宣称通过。

## 9. 发布阻断条件

出现任一项必须阻止收口：

- Resource 实际仍未调用 Worker，只通过 Fake Provider 测试；
- Worker 请求串到 primary 模型；
- 本地 3B 无法完成三个任务中的任一真实成功闭环却仍宣称支持；
- 模型建议未经事实校验直接改变文件操作；
- Worker 不可用导致原有 Resource 闭环失败；
- 任务取消或进程重启后遗留永久 lease/running 状态；
- Token、密码、绝对路径、私人分享正文或 Provider 原始响应进入日志、Git 或 npm 包；
- 为解决小模型输出问题引入 Tool、Session、Memory、任意循环或主 Agent 耦合；
- 主 Agent Resource Tool、主 WebUI、反馈或自更新混入本版本。
