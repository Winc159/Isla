# Resource Worker

Resource 是 Isla 的常驻资源处理服务，负责把百度网盘输入或受管目录中的资源，转换为受管目录中的可用内容。它与 Agent Runtime 解耦：Runtime 只负责提出任务或查询状态，Resource 自己维护队列、数据库、后台 Worker、重启恢复和输出清理。

## 当前能力

- 百度网盘分享文本解析：规则解析先提取分享链接、提取码、解压密码和标题候选；需要时再调用 Resident Host 的 `resource-worker` 结构化推理角色。
- 百度网盘下载及断点恢复：下载、传输、检查和提取阶段分别记录状态，失败任务可从安全阶段重试。
- 受管目录扫描：通过 `managedRoots` 和 folder watch 发现稳定文件，自动创建处理任务。
- 归档识别：不依赖扩展名，读取文件头识别 ZIP、7z、RAR 等归档；媒体文件可继续探测其中的嵌套归档。
- RAR 处理：Linux 有 `unrar` 时优先处理 RAR4/RAR5；没有时回退到 7-Zip。
- 嵌套、分卷和递归归档：最多递归处理 3 层，结果按目录发布，临时中间目录在完成后清理。
- 资源树和事件：每个任务保留 `resource_artifacts` 工件树和 `resource_events` 事件流，可通过 API 或 Web UI 查看处理过程。
- 幂等与恢复：任务 revision、租约、文件 ledger 和数据库迁移用于避免重复处理；Resource 启动时会恢复 queued 任务。

## 处理流程

```text
创建任务/目录扫描
  -> parsing_rules
  -> parsing_model（可选）
  -> preview / waiting_user
  -> queued_download -> downloading -> transferring -> settling
  -> inspecting
  -> 归档/媒体/嵌套/分卷识别
  -> testing_archive -> extracting -> verifying
  -> publishing
  -> completed
```

百度任务的特殊路径：下载结果可能是目录、改名后的媒体文件、外层归档或包含归档的媒体文件。Resource 会先扫描下载目录，再检查文件头和嵌入式归档；确认后才进入提取。目录型下载会保留原始下载树，并把最深层有效内容复制到 `最终内容`。

## 持久化模型

Resource 数据库默认为 `~/.isla/resource.sqlite`，当前 schema version 为 5：

| 表 | 作用 |
| --- | --- |
| `resource_jobs` | 任务主状态、阶段、revision、失败信息、模型快照 |
| `resource_artifacts` | 下载文件、归档、分卷、提取目录及父子关系 |
| `resource_events` | 按 sequence 排序的任务事件日志 |
| `resource_file_ledger` | 目录扫描的稳定性、指纹和关联任务 |
| `resource_leases` | Worker pool 租约和心跳 |
| `resource_idempotency` | 请求幂等响应 |
| `resource_job_secrets` | 任务范围内的分享码和解压密码 |
| `resource_archive_passwords` | 成功过的解压密码统计，不写入普通日志 |
| `resource_trash_entries` | Isla 回收站项目、原始路径、大小和删除时间 |

密码和分享码只用于 Resource 内部重试；API 返回和日志不得回显它们。

## 事件契约

`ResourceEventV1` 通过 `sequence` 保证同一任务内的事件顺序。当前 `contracts.ts` 声明的公共基础事件为：

```text
job.created
job.stage_changed
job.progress
job.waiting_user
job.resumed
job.completed
job.failed
job.cancelled
artifact.discovered
artifact.verified
```

Resource 的递归整理流程还会写入以下内部事件：

```text
job.recovered_stale
resource.inspecting
resource.archives_found
resource.embedded_archives_found
resource.directory_publishing
resource.nested_extract_started
resource.nested_extract_completed
resource.nested_extract_failed
resource.volume_group_detected
resource.volume_group_extracted
resource.recursive_archives_found
resource.recursive_archive_extracted
resource.recursive_archive_failed
resource.published
resource.intermediates_removed
resource.organize_retry_started
```

这些 Resource 处理事件已经纳入 `ResourceEventTypeV1`，并由任务事件 API 和 Web UI 使用。公共消费者仍应把未知事件类型作为可展示但不可穷举的记录处理，以便后续增加内部诊断事件时保持兼容。

## API 入口

Resource 默认只监听 loopback，并使用 runtime token：

- `GET /api/v1/resource/jobs`：任务列表
- `GET /api/v1/resource/jobs/:id`：任务快照
- `GET /api/v1/resource/jobs/:id/events`：处理事件
- `GET /api/v1/resource/jobs/:id/tree`：工件树
- `POST /api/v1/resource/jobs`：创建单个任务
- `POST /api/v1/resource/jobs/batch`：批量创建任务
- `POST /api/v1/resource/jobs/:id/confirm`：提交用户决定
- `POST /api/v1/resource/jobs/:id/retry`：从安全阶段重试
- `POST /api/v1/resource/jobs/:id/repeat`：重新创建已结束任务
- `POST /api/v1/resource/jobs/:id/cancel`：取消任务

`retry` 支持 `mode: "organize"`，用于下载已完成但整理失败的任务，不重复下载。

## 最近提交的演进

| 提交 | 变化 |
| --- | --- |
| `1f5ff43` | 下载完成后先检查内容，再决定是否进入提取；补充运行时配置测试 |
| `e016172` | 百度提取失败可恢复到检查阶段 |
| `9830e2a` | 改善 Web UI 任务进度展示 |
| `3f1b0b0` | 对媒体下载结果做归档探测，并支持改名后的归档 |
| `2b1f601` | 识别媒体文件中嵌入的归档 |
| `0c7f0fe` | 增加递归输出、分卷处理、RAR 工具、事件流和资源树 |

## 运行与排查

Resource 由 `isla resource` 常驻入口启动，通常不直接手工运行。首先检查：

```bash
isla service status
isla service logs
```

如果任务停在 `running`，先查看任务快照、事件和资源树；不要直接删除 staging。Resource 会在启动时恢复排队任务，并定期清理超过 7 天的 staging 目录。只有确认任务已终止且需要重新整理时，才使用带 revision 的 `retry` 请求。

## 边界与未完成项

- Resource 不是通用下载器，当前主要支持百度网盘和本地受管目录。
- 它不应把 root 权限、API Key、分享码或解压密码交给 LLM。
- Resource 公共事件与当前数据库写入类型已经统一；事件 payload 仍以有界诊断数据为主，不作为秘密或原始模型内容通道。
- 内容识别和命名 Worker 仍依赖 Resident Host 的 `resource-worker` Profile；该 Profile 不可用时任务应停在可解释的失败状态，而不是无限重试。
