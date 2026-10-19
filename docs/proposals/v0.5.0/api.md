# v0.5.0 API 与 Schema

## 1. 约定

- 路径版本：`/api/v1`；
- JSON 字段使用 camelCase；
- 时间为 UTC ISO 8601；
- ID 为服务端生成的不透明字符串；
- 写请求支持 `Idempotency-Key`；
- 错误响应不包含密钥、密码、Cookie、绝对秘密路径或原始 Provider body；
- Resource Web 使用同源 API；Resource Service 到 Isla 使用内部 Bearer Token；
- 浏览器不能调用 Isla Structured Inference API。

统一错误：

```ts
interface ApiErrorV1 {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
    readonly requestId?: string;
    readonly details?: Record<string, unknown>;
  };
}
```

`details` 只能包含稳定、脱敏、可供 UI 决策的字段。

## 2. Isla Structured Inference API

### `POST /api/v1/inference/structured`

```ts
interface StructuredInferenceRequestV1 {
  readonly requestId: string;
  readonly role: "resource-worker";
  readonly task:
    | "resource.parse-share-text"
    | "resource.identify-content"
    | "resource.suggest-title";
  readonly schema:
    | "resource.parse-result.v1"
    | "resource.content-result.v1"
    | "resource.title-result.v1";
  readonly input: Record<string, unknown>;
  readonly timeoutMs?: number;
}
```

服务端根据 `task + schema` 查找预注册 Prompt 和 JSON Schema。客户端不能上传任意 system prompt、Provider、API Key、Tool schema 或文件路径。

成功：

```ts
interface StructuredInferenceSuccessV1<T> {
  readonly requestId: string;
  readonly status: "succeeded";
  readonly output: T;
  readonly model: {
    readonly role: "resource-worker";
    readonly profile: string;
    readonly provider: string;
    readonly model: string;
    readonly configRevision: string;
  };
  readonly usage?: {
    readonly input?: number;
    readonly output?: number;
    readonly total?: number;
  };
}
```

解析输入：

```ts
interface ResourceParseInputV1 {
  readonly rawText: string;
  readonly ruleResult: {
    readonly shareUrls: readonly string[];
    readonly shareCodeCandidates: readonly string[];
    readonly archivePasswordCandidates: readonly string[];
    readonly titleCandidates: readonly string[];
  };
}
```

解析输出：

```ts
interface ResourceParseResultV1 {
  readonly source: "baidu";
  readonly shareUrl: string;
  readonly shareCode?: string;
  readonly archivePasswords: readonly string[];
  readonly title?: string;
  readonly category: "video" | "audio" | "book" | "software" | "archive" | "unknown";
  readonly year?: number;
  readonly season?: number;
  readonly confidence: number;
  readonly needsReview: boolean;
  readonly reviewReasons: readonly string[];
}
```

约束：

- `rawText`、数组数量和字符串长度必须有上限；
- URL 必须由规则层重新校验，不信任模型复制结果；
- 密码去重后保留原始顺序；
- `confidence` 限制在 0..1；
- 输出无效时允许一次格式修复请求，仍无效返回错误；
- 同一个 `requestId` 幂等，不重复计费调用。

错误码：

| Code | Retryable | 含义 |
|---|---:|---|
| `ROLE_NOT_CONFIGURED` | false | `resource-worker` 未绑定 Profile |
| `PROFILE_UNAVAILABLE` | false | Profile 缺失或无效 |
| `MODEL_UNAVAILABLE` | true | 模型连接不可用 |
| `INFERENCE_BUSY` | true | Worker 并发已满 |
| `INFERENCE_TIMEOUT` | true | 超时 |
| `INFERENCE_CANCELLED` | false | 调用方取消 |
| `MODEL_RESPONSE_INVALID` | true | 模型输出无法解析 |
| `SCHEMA_VALIDATION_FAILED` | false | 修复后仍不符合 schema |
| `TASK_SCHEMA_MISMATCH` | false | task 与 schema 不匹配 |
| `REQUEST_TOO_LARGE` | false | 输入超出预算 |

## 3. Resource API

API 明确区分两个工具：下载任务使用 `tool: "baidu-download"`，本地解压整理任务使用 `tool: "archive-organizer"`。Worker 为可选增强，任何 API 不得以配置 Worker 作为前置条件。

### `GET /api/v1/resource/health`

返回服务、数据库、Isla 连接、百度登录状态、7zz/unrar 可用性和队列深度的脱敏摘要。

### `GET /api/v1/resource/config/public`

只返回 UI 可见配置：受管根 ID/label、并发上限、扫描状态和默认目标。不得返回绝对敏感路径、Token 或账号信息。

### `POST /api/v1/resource/jobs`

```ts
interface CreateResourceJobRequestV1 {
  readonly tool: "baidu-download" | "archive-organizer";
  readonly input: {
    readonly kind: "share-text" | "baidu-path" | "managed-folder";
    readonly text?: string;
    readonly path?: string;
    readonly managedRootId?: string;
    readonly relativePath?: string;
  };
  readonly destinationRootId: string;
  readonly startMode?: "after-preview" | "automatic";
}
```

`baidu-path` 只接受已授权 bdpan 应用目录中的绝对远程路径，例如 `/apps/bdpan/file.zip`；它不是本地文件路径。`automatic` 模式直接进入下载队列。

### `GET /api/v1/resource/baidu/tree?path=/`

按需列出当前百度目录，供 WebUI 的上一级、目录展开和文件多选使用。只允许 `/`、`/apps/bdpan` 及其子路径，不返回 Token。

### `GET /api/v1/resource/local/tree?rootId=<id>&path=.`

只列出指定受管根内的子目录，返回相对路径，不返回配置中的绝对根路径；`..` 和绝对路径会被拒绝。

### `POST /api/v1/resource/jobs/:id/repeat`

从终态任务复制原始输入并创建新 Job。原 Job 和审计记录不变。

### `DELETE /api/v1/resource/jobs/:id`

删除 completed、failed 或 cancelled 的任务记录。不会删除下载或整理后的文件；非终态任务返回 `JOB_NOT_TERMINAL`。

### `POST /api/v1/resource/jobs/batch`

接收与百度下载单任务相同的 `share-text` 请求。服务按空行和分享链接边界拆分输入，每个识别出的资源创建独立 Job；返回 `jobs` 数组。WebUI 提交 `startMode: "automatic"`，单一明确链接直接进入下载池；API 调用方仍可使用 `after-preview`。若文本没有可识别链接，仍创建一个可修正 Job，而不是丢弃用户输入；修正成功后自动模式从同一 Job 继续。

默认 `after-preview`。只有规则和 Worker 均达到策略阈值且无覆盖/登录风险时，`automatic` 才能跳过预览确认。

响应：

```ts
interface CreateResourceJobResponseV1 {
  readonly job: ResourceJobSnapshotV1;
}
```

### `GET /api/v1/resource/jobs`

查询参数：`status`、`stage`、`cursor`、`limit`。默认按更新时间倒序，分页稳定。

### `GET /api/v1/resource/jobs/:jobId`

返回 Job 快照、阶段、进度、脱敏解析结果、Artifacts、待确认项和最近事件。

### `POST /api/v1/resource/jobs/:jobId/confirm`

```ts
interface ConfirmResourceJobRequestV1 {
  readonly decisionId: string;
  readonly revision: number;
  readonly action: "approve" | "reject" | "provide_values" | "replace_input" | "choose_destination";
  readonly values?: Record<string, unknown>;
}
```

规则无法识别分享链接、链接含空格/汉字、分享码或密码存在歧义时，Job 不直接失败，而是进入 `waiting_user`。WebUI 展示原输入、脱敏诊断和可编辑文本；提交 `replace_input` 后使用同一个 Job 从 `parsing_rules` 重新解析，并通过 revision/decisionId 防止过期页面覆盖新状态。

可恢复错误使用结构化 Decision：`provide_archive_password` 和 `provide_share_code` 接受 `provide_values`，但提交值不进入响应、事件或普通 Job JSON；`handle_login`、`handle_captcha`、`handle_risk_control` 与 `resolve_volume_group` 由用户完成外部处理后提交 `approve`。`reject` 会取消任务。未知损坏不伪装成人工可恢复错误。

使用 revision 防止页面过期确认。密码等秘密值只进入加密/受限本地存储和任务内存，不回显到事件。

### `POST /api/v1/resource/jobs/:jobId/cancel`

请求取消。返回 `accepted` 和当前阶段。取消必须传播至下载、推理、7zz/unrar；无法立即终止时状态为 `cancelling`。

### `POST /api/v1/resource/jobs/:jobId/retry`

只能从稳定错误指定的安全恢复点重试。请求包含当前 revision，不允许任意指定内部 Stage。

### `GET /api/v1/resource/jobs/:jobId/artifacts`

返回相对路径、类型、大小、校验状态和来源关系。不得允许通过路径参数读取任意文件。

### `GET /api/v1/resource/jobs/:jobId/events`

SSE。支持 `Last-Event-ID`，断线后先读 Job 快照再续订。

### `POST /api/v1/resource/scans`

注册或更新一个长期整理目录，并立即触发一次 reconciliation。请求只接受 `managedRootId`、受管根内的 `relativePath` 与 `destinationRootId`，重复请求合并为同一 watch。watch 持久化到 SQLite；后续按 `scanning.intervalMs` 周期扫描。手工扫描立即处理当前文件，周期扫描要求连续稳定观察后才排队。

## 4. Job Schema

```ts
interface ResourceJobSnapshotV1 {
  readonly version: 1;
  readonly id: string;
  readonly revision: number;
  readonly source: "baidu" | "managed-folder";
  readonly status: "queued" | "running" | "waiting_user" | "cancelling" | "completed" | "failed" | "cancelled";
  readonly stage: ResourceStageV1;
  readonly destinationRootId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly progress: {
    readonly ratio?: number;
    readonly completedBytes?: number;
    readonly totalBytes?: number;
    readonly currentItem?: string;
  };
  readonly modelSnapshot?: {
    readonly role: "resource-worker";
    readonly profile: string;
    readonly provider: string;
    readonly model: string;
    readonly configRevision: string;
  };
  readonly pendingDecision?: ResourceDecisionV1;
  readonly failure?: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
    readonly resumeStage?: ResourceStageV1;
  };
}
```

```ts
type ResourceStageV1 =
  | "created"
  | "parsing_rules"
  | "parsing_model"
  | "preview"
  | "queued_download"
  | "transferring"
  | "downloading"
  | "settling"
  | "inspecting"
  | "grouping_volumes"
  | "testing_archive"
  | "extracting"
  | "verifying"
  | "publishing"
  | "completed";
```

## 5. Event Schema

```ts
interface ResourceEventV1 {
  readonly version: 1;
  readonly id: string;
  readonly jobId: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly type:
    | "job.created"
    | "job.stage_changed"
    | "job.progress"
    | "job.waiting_user"
    | "job.resumed"
    | "job.completed"
    | "job.failed"
    | "job.cancelled"
    | "artifact.discovered"
    | "artifact.verified";
  readonly data: Record<string, unknown>;
}
```

进度事件可以合并或限频；Stage、Decision 和终态事件必须持久化且不可丢失。

## 6. Resource Tool（后置）

独立闭环通过后，Isla 才增加：

- `resource_create_job`
- `resource_get_job`
- `resource_list_jobs`
- `resource_cancel_job`
- `resource_confirm_job`

Tool 只调用 Resource API，不访问 Resource SQLite、下载器、账号凭据或文件系统。创建、取消和确认使用现有 Approval/Permission 规则。
