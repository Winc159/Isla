# Isla v0.5.7 执行计划

## 版本主题

v0.5.7 聚焦 Resource 契约收敛与安全加固。这个版本不扩展新的下载来源、不把 Resource 接入主 Agent，也不引入新的通用框架；目标是让 v0.5.6 已经出现的文件工作台、回收站、密码本和后台任务能力具备一致契约、自动化回归和安全演进基础。

## 当前基线

- 最近代码提交已经进入 v0.5.6 阶段，但 `package.json`、README 和部分文档仍保留 v0.5.1 描述。
- Resource SQLite schema 为 version 5，文件操作、回收站、密码本和百度登录 API 已存在。
- `ResourceEventV1` 声明的公共事件与数据库实际写入的递归解压、分卷、发布和清理事件不完全一致。
- 文件操作缺少活动任务占用检查，可能移动、改名或回收正在下载、检查、解压或发布的路径。
- React Resource 页面仍保留迁移期重复组件，旧内嵌 UI 仍作为 fallback 存在。
- 新增 Resource API 的自动化测试尚未覆盖完整。
- DSH 参考文档存在已经失效的本地链接，需要重新整理为可追溯的采用、暂缓和拒绝结论。

## 实施状态

- 已完成：版本与文档事实基线、Resource 文件/密码/登录 API 回归、事件类型统一、活动任务路径占用检查、文件列表联动与行内继续解压、旧内嵌 UI 和重复 React 组件清理。
- 已验证：默认离线门禁（157 个测试文件、619 项测试通过，7 个真实或可选测试文件按设计跳过）、独立 PTY 验收（10 项通过）、Runtime 构建、Vite 构建、npm 打包白名单和 `git diff --check`。
- 待完成：依赖真实目标机的 Linux/N100 平台验收；它不由 Windows 离线结果替代。

## 设计原则

1. 每一批只解决一个可独立验证的问题，完成后项目仍可运行。
2. 先固定事实和测试，再修改行为；先稳定 React 页面，再删除旧实现。
3. 文件安全边界继续使用 `managedRootId + relativePath`，不开放任意绝对路径。
4. 活动任务占用检查使用现有 Job、Artifact、路径和状态事实，不新增通用锁框架。
5. Resource Job 继续由 Resource Service、SQLite 和 Scheduler 持有，不创建第二套后台任务系统。
6. API Key、授权码、分享码和解压密码不得进入 URL、普通日志、事件正文、测试快照或构建产物。
7. 本版本不改变 Session、模型输入、Approval、Sandbox 或主 Agent Tool 契约。

## 批次 1：版本与文档事实基线

### 目标

消除版本和文档漂移，让后续修改基于唯一、可检索的事实。

### 工作项

- 将 package、README 和当前版本说明统一为 v0.5.7 开发状态。
- 修正 `docs/references.md` 中不存在的 DSH 和旧架构文档链接。
- 在参考记录中保留 DSH 的采用、暂缓和拒绝结论，但不复制其框架、目录结构或源码。
- 检查 README、Roadmap、Resource 文档中的当前能力描述是否与代码一致。

### 验收

- 仓库内不存在互相冲突的当前版本号。
- 所有 Markdown 相对链接指向存在的文件。
- 文档不声称未执行的测试或跨平台验收已经通过。
- `git diff --check` 通过。

## 批次 2：Resource API 回归测试

### 目标

先用测试固定现有 API 行为，不在本批改变正常业务语义。

### 覆盖范围

- `GET /api/v1/resource/local/tree`
- `POST /api/v1/resource/files/rename`
- `POST /api/v1/resource/files/move`
- `POST /api/v1/resource/files/trash`
- `GET /api/v1/resource/files/trash`
- `POST /api/v1/resource/files/restore`
- 密码本 GET、POST、DELETE
- 百度登录 start、complete
- 回收站过期清理和 100 GiB 容量清理

### 关键场景

- 拒绝绝对路径、`..` 越界、符号链接逃逸和 `.isla-trash` 普通访问。
- 目标冲突时不覆盖已有文件。
- 还原冲突时保持回收站条目和文件不变。
- 密码批量导入执行去重、空行过滤和数量/长度限制。
- 密码、授权码和 API Key 不出现在响应错误、事件、日志替身和快照中。
- 百度登录测试使用假 Runner，不发真实网络请求，也不把授权码放入命令行参数。

### 验收

- 新增场景均可通过离线测试重复执行。
- 测试临时目录和 SQLite 数据在测试结束后清理。
- 不依赖真实百度账号、网络、7-Zip 或私人配置。
- `npm run test -- tests/resource` 通过。

## 批次 3：Resource 事件契约统一

### 目标

让类型、持久化事实、API 和前端对事件的理解一致。

### 事件分层

- 公共生命周期事件：消费者可以依赖其名称和最小字段。
- 公共 Resource 处理事件：任务详情和未来 Agent 查询需要稳定理解的归档、分卷、发布结果。
- 内部诊断事件：允许增加，不要求消费者穷举。

### 工作项

- 盘点所有 `appendJobEvent` 写入点和数据库中的事件类型。
- 为公共事件定义稳定 payload；敏感路径只保留安全、必要的相对表示。
- 明确内部事件的兼容规则，前端遇到未知类型时继续以通用记录展示。
- 同步 `contracts.ts`、Resource 文档和事件 API 测试。
- 不为统一类型而引入通用 Event Bus 或事件溯源框架。

### 验收

- 代码中实际产生的公共事件都能通过类型检查。
- 公共事件 payload 有契约测试。
- 未知内部事件不会导致 API 或 React 页面失败。
- 事件中不包含密码、分享码、授权码和 API Key。

## 批次 4：活动任务文件占用检查

### 目标

阻止用户操作破坏进行中的 Resource Job，同时不把文件工作台改造成通用文件锁系统。

### 第一版占用语义

- 只有 `queued`、`running` 和 `waiting_user` 的非终态 Job 可以形成占用。
- 下载目标、已发现 Artifact、当前归档、提取目录、发布目标及其必要父目录可以形成占用。
- `completed`、`failed` 和 `cancelled` Job 不继续占用文件。
- rename、move 和 trash 必须检查源路径及目标路径冲突。
- restore 必须检查恢复目标是否被活动 Job 占用。
- 命中占用时返回稳定错误码、受影响路径和 Job ID；不泄漏 staging 绝对路径或秘密。

### 实现边界

- 优先从现有 Job、Artifact 和确定性派生路径建立占用快照。
- 占用判断必须在执行文件系统变更前完成。
- 不新增跨进程分布式锁、常驻文件句柄或操作系统级锁。
- 如果检查与文件变更之间仍存在本机竞态，依赖原子文件操作的最终失败并规范化错误，不提前建设复杂事务层。

### 验收

- 正在下载、检查、解压和发布的输入或输出不能被改名、移动或回收。
- 非关联文件仍可正常操作。
- Job 进入终态后，占用自动消失且重启结果一致。
- 失败响应可以让前端说明“被哪个任务占用”。
- 单元测试和 HTTP API 测试覆盖允许与拒绝路径。

## 批次 5：文件工作台交互收敛

### 目标

减少相对路径手输，让现有后端能力从文件列表直接触达。

### 工作项

- 点击文件或文件夹后，将相对路径带入重命名、移动和回收操作。
- 只对服务端确认可作为归档候选的文件显示“继续解压”。
- “继续解压”复用现有 managed-file Job，不增加新的解压入口或状态机。
- mutation 成功后刷新相关文件列表、回收站和任务列表，同时保留无关表单与展开状态。
- 占用冲突使用批次 4 的稳定错误信息展示。

### 验收

- 常用文件操作不再要求重复手输完整相对路径。
- 中文文件名、空目录、长路径和刷新后的选中状态有自动化或浏览器验收记录。
- 任务轮询不重置表单、展开日志和资源树。
- 不引入新的全局状态库或组件库。

## 批次 6：迁移期旧实现清理

### 目标

在 React 功能和测试稳定后，结束双实现维护。

### 工作项

- 删除 `resource-ui/src/main.tsx` 中确认未挂载的旧组件和关联状态。
- 对照 API 与浏览器验收清单，确认 React 页面覆盖旧内嵌页面的必要能力。
- 删除 `src/resource/web-ui.ts` fallback 及只为 fallback 存在的分支和测试。
- 保留一个明确的静态资源缺失错误，不在生产环境静默回退到另一套 UI。

### 验收

- Resource 只存在一套正式 Web UI。
- 前端构建产物缺失时给出明确诊断。
- React UI 的设置、下载、整理、文件、密码本、任务决定、事件和资源树路径均完成浏览器验收。
- 删除旧实现后 TypeScript、测试和构建全部通过。

## 批次 7：发布门禁

### 离线门禁

```bash
npm run verify
npm run pack:check
git diff --check
```

### 平台验收

- Windows：安装依赖、doctor、Host、Resource 和 React 页面基本闭环。
- Linux x64/N100：安装、systemd user service、linger、重启恢复和日志检查。
- macOS ARM64 不作为 v0.5.7 阻塞项；保留为后续独立平台验收。

### 完成条件

- 版本、文档、类型和运行行为一致。
- Resource 新增 API 有离线自动化回归。
- 活动任务引用的文件不能被破坏性操作修改。
- Resource 公共事件有稳定契约，未知内部事件可兼容展示。
- Resource 只保留一套正式前端。
- 默认验证不产生网络请求、费用或私人日志。
- npm 发布白名单不包含 `.env`、数据库、评估材料、浏览器数据或 Resource 私人内容。

## 明确暂缓

- Resource 作为主 Agent Tool，以及 Job 完成后的对话通知。
- SSE、WebSocket 或通用 Job 输出流。
- 定时任务、提醒、Subagent、Agent Team 和 Workflow。
- 主 Agent Web UI、远程 SSH 和跨设备文件操作。
- 插件市场、在线安装、热更新和 Agent 自动创建插件。
- 运行期间动态切换 Provider、模型或系统提示词。

## 明确拒绝

- 引入 Cordis、通用服务容器或完整事件溯源框架。
- 为模仿 DSH 改为多包 monorepo 或复制其目录结构、源码和插件体系。
- 让 Resource Worker 获得 Session、Memory、Tool、文件系统权限或开放式 Agent Loop。
- 将 Runtime Core 与 systemd、launchd、Docker 或特定设备绑定。
- 在缺少真实需求和安全设计时开放公网、多用户或任意路径文件操作。

## v0.6.0 重新评估入口

只有 v0.5.7 完成并经过真实长期运行后，才重新评估“Resource 成为主 Agent 可调用的持久背景能力”。届时优先研究窄 Job Bridge：创建、查询、等待、取消和完成通知；继续复用 Resource 自己的 SQLite 生命周期，不把主 Agent Runtime 和 Resource 合并成一个通用调度框架。
