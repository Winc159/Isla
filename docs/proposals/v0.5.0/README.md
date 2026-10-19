# v0.5.0：Personal Agent Workspace and Resource Toolbox

状态：设计冻结，等待按实施计划开发

前置基线：v0.4.9 已完成当前架构与文档收口；v0.4.x 已具备 Config/Profile、Provider、Session、Tool Runtime、Approval、Capability Catalog、Resident Host、Browser 与 Memory。

> Luna 执行入口：先完整阅读本目录，再按 [`implementation.md`](implementation.md) 逐批实施，并以 [`testing.md`](testing.md) 的 P0 与双平台真实验收为发布门禁。所有 Batch 同属 v0.5.0，不拆成多个功能版本。

## 版本主题

v0.5.0 将 Isla 从 CLI Agent Runtime 推进为个人 Agent 工作台的第一版，并使用两个边界独立的 Resource 工具验证三个现实需求：

1. Web UI 与长期任务进度展示；
2. Primary/Worker 多模型角色；
3. 可独立维护、以后可被主 Agent 调用的工具箱服务。

工具箱固定拆成：

- `百度下载`：粘贴分享信息、规则解析、下载目录选择、并发队列与下载进度；
- `文件解压/整理`：输入目录选择、文件检测、分卷、解压、命名、整理和输出目录选择。

两者可以串联，也必须能各自单独运行。Worker 不可用、未配置或请求失败时，确定性规则与脚本仍需完成最大可能的解析、下载、识别和解压。

Resource 第一版先提供独立复制粘贴页面，不依赖主 Agent 对话。后续在同一 v0.5.0 范围内，可把页面纳入 Isla Web 工具箱，并增加由主 Agent 调用 Resource API 的 Tool；这两项不阻塞首个资源闭环。

## 唯一发布验收路径

用户在 Resource Web 页面粘贴包含分享链接、分享码、解压码和说明的混合文本，系统能够并发处理多个任务，并最终在用户选择的受管目录中产出完整、经过验证的解压内容。

首版真实样本必须同时覆盖：

- 普通带密码压缩包；
- 改扩展名的 RAR/ZIP/7z；
- MP4 尾部拼接 RAR；
- 多分卷压缩包；
- RAR5；
- 多个密码候选；
- 至少两个任务同时下载；
- Windows 开发机和 N100 Linux 最终部署机。

## 冻结决策

- Isla Host 与 Resource Service 是两个独立进程，互不阻塞。
- Resource Service 自己拥有 Web 页面、SQLite、任务状态、队列、下载、检测、解压和目录巡检。
- Worker 模型由 Isla Config/Profile 管理，可显式更换；活动请求和活动 Job 使用创建时解析出的模型快照。
- Resource 通过 Isla 的结构化推理 API 使用 Worker，不创建 ChatSession，不获得 Tool。
- 第一版只实现百度网盘下载；不建设通用下载器接口，只在 schema 中保留 `source: "baidu"` 和未来来源占位说明。
- 下载、检测、切割、测试、解压和移动由确定性代码完成，模型不得直接操作文件。
- Resource 管理一个或多个显式配置的受管根目录；任务输出目标只能从这些目录中选择。
- 周期扫描是发现新文件的事实源，`fs.watch` 只作为低延迟唤醒提示。
- 第一版为单用户、私人局域网应用，不建设多用户权限系统和公网 SaaS。
- v0.5.0 不实现通用动态插件、在线安装、热更新或完整多 Agent 编排。

## 文档入口

- [`design.md`](design.md)：总体架构、进程、模型角色、目录管理和安全边界；
- [`api.md`](api.md)：Isla Structured Inference 与 Resource HTTP API；
- [`state-machine.md`](state-machine.md)：Job、Stage、并发、恢复和目录巡检状态机；
- [`implementation.md`](implementation.md)：源码落点、Batch、停点与迁移；
- [`testing.md`](testing.md)：自动测试和 Windows/N100 Linux 真实验收。

## 非目标

- 其他网盘或下载平台；
- 通用 `Downloader` 插件层；
- 自动模型路由、自动成本优化或运行中迁移请求；
- 多 Agent 自主委派、共享上下文和自动创建 Agent；
- 多用户、组织权限、云同步或公网暴露；
- 模型直接执行 shell、下载、解压、删除或移动；
- 绕过登录、验证码、限速、配额或平台风控；
- 在 v0.5.0 内重构所有现有源码为 monorepo。

## 重新评估条件

- 第二个真实下载来源出现后，再提取 Downloader 接口；
- 第二个独立工具箱接入后，再评估通用插件加载协议；
- Worker 需要自己的 Session、Tool 或长期任务规划后，再升级为完整 Agent；
- Resource 需要跨主机扩容后，再评估分布式 Job、消息队列和对象存储。
