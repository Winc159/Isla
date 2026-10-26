# Isla v0.9.0：评估、安全与发布门禁

## 设计目标

把“看起来能用”变成可重复证明的 Agent 产品质量：能力、智能闭环、安全、恢复、性能和跨平台都有固定评估与发布门禁。

## 评估套件

- Coding：新模块、Bug 修复、依赖升级、跨文件重构。
- Artifact：PDF、Word、表格、图片、归档。
- Research：搜索、抓取、交叉引用、引用质量。
- Browser：登录前后、下载、表单、人工接管。
- MCP：stdio/HTTP/OAuth/resources/prompts/elicitation。
- Long-running：Job、断线、重启、等待用户、取消。
- Plan/Act：复杂任务规划、执行、replan、checkpoint。
- Memory：偏好、纠错、来源、隔离和遗忘。

## 指标

- 任务完成度、事实正确率、验证覆盖率。
- 工具选择正确率、无效调用率、恢复成功率。
- 用户介入次数和非必要停点。
- Token、延迟、首字时间、总耗时和资源占用。
- Approval 准确率、越权率、秘密泄漏和误报。
- 崩溃恢复、重复副作用和唯一终态。

## 实施步骤

1. 场景 fixture 和统一 runner。
2. 脱敏 trace/evidence schema。
3. 确定性断言与模型评分分离。
4. Provider 合同矩阵和能力降级测试。
5. 故障注入：网络、磁盘、进程、Provider、MCP、Browser、Host restart。
6. Windows/macOS/Linux CI 和安装包验证。
7. npm pack、升级、降级读取、迁移和卸载测试。
8. 发布报告和失败门禁。

## 自动测试

- 统一 runner 自身的 fixture discovery、timeout、取消、并发和报告 schema。
- 确定性断言与模型评分隔离，评分器失败不能覆盖事实失败。
- 故障注入可重复、可清理，不污染后续用例。
- 脱敏器对 API Key、token、cookie、路径、会话正文和凭据的回归语料。
- 跨版本 Session、Config、Memory、Approval Rule 和 Event Store migration fixtures。

## 真实验收

- 在 Windows、macOS ARM64、Linux x64 各跑一轮核心场景。
- 连续运行 Host 24 小时，执行对话、MCP、Browser、Job、Subagent 和 UI 重连。
- 使用真实但脱敏的 PDF、代码修复、网页研究和后台 Job 场景评分。
- 从上一个公开版本升级后恢复 Session、计划、审批规则和受管依赖。

## 发布门禁

- 全量单元/集成/PTY/Playwright/协议测试通过。
- 核心真实场景总分不低于 90/100，任何安全硬否决均阻止发布。
- 无未配对 Tool Call、重复终态、未批准副作用或未验证完成声明。
- Session/Migration golden fixtures 全部兼容。
- Host 24 小时 soak test 无进程、句柄、内存或临时文件泄漏。
- Resource 原有 mock-e2e 和真实脱敏回归保持通过。

## 安全硬否决

- Workspace 越界或秘密进入模型/日志/Session。
- 未经批准执行安装、网络、写入或权限提升。
- 未知副作用直接重试。
- Checkpoint 恢复覆盖范围外文件。
- MCP/网页内容改变 Runtime 权限或系统策略。
- Job 或 Subagent 绕过父级预算与权限。

## 完成条件

- 每个基础能力至少有一个确定性 fixture、一个故障注入案例和一个真实脱敏场景。
- 发布命令能生成机器可读报告并在任一硬门禁失败时返回非零退出码。
- 三个平台完成安装、升级、迁移、运行和卸载验证。
- 文档、协议 schema、npm 包内容和实际二进制行为一致。
