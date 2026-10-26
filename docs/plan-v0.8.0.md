# Isla v0.8.0：主 Agent Web UI

## 设计目标

提供与 CLI 等价的本地主 Agent Web UI，完全通过 App Server 协议工作，不直接读取 Session、Memory、配置文件或 Resource 数据库。

## 页面与功能

- Session 列表、搜索、创建、归档和恢复。
- 实时对话、断线续传、停止、steer 和 follow-up。
- Approval/User Question 队列与历史。
- Plan/Act/Review 模式、计划步骤和验证状态。
- Tool 时间线、命令输出 cursor、Artifact 预览和差异。
- Job 视图：主 Agent Job 与 Resource Job 只读投影。
- Memory 查看、来源、修订和删除。
- MCP 管理、健康状态和 OAuth 流程入口。
- Provider/Profile、权限规则、执行环境和诊断设置。

## 实施步骤

1. 在独立 `agent-ui/` 建 React/Vite/TypeScript 应用；不复用或修改 `resource-ui/`。
2. 生成 App Server TypeScript Client 和事件状态机。
3. 实现 Session/Turn 核心页面和重连。
4. 实现审批、问题、Plan、Tool、Artifact。
5. 实现 Job、Memory、MCP、Settings、Diagnostics。
6. 增加无障碍、键盘导航、响应式和错误恢复。
7. Host 只提供构建静态资源和 loopback 鉴权。

## 状态边界

- 服务端状态由 query/cache 管理；实时事件按 cursor reducer 合并。
- 编辑器草稿和 UI 展开状态本地保存；秘密、Tool 原始敏感输出和凭据不持久化到浏览器。
- 同一 Approval 只能被一个客户端成功响应；其他客户端收到 resolved 事件。

## 自动测试

- reducer 对乱序、重复、断线补发事件的幂等测试。
- Playwright 覆盖会话、流式、审批、计划、取消、重连和错误页。
- XSS、Markdown、Tool 输出、URL、下载和 secret redaction。
- 键盘操作、ARIA 和最低视口。
- App Server 版本不兼容与升级提示。

## 真实验收

- 仅用 Web UI 完成代码修改任务和 PDF 安装/压缩任务。
- 浏览器刷新后恢复当前 Session、Turn 和等待中的 Approval。
- CLI 与 Web 同时观察同一 Turn，事件一致且不会重复执行。
- Resource UI 保持独立可用，样式和构建互不影响。

## 完成条件

- Web UI 可独立完成 CLI 已支持的全部主 Agent 交互。
- 刷新、断线和多客户端不会丢事件或重复副作用。
- Approval、问题、Plan、Artifact 和 Job 都有明确等待与终态展示。
- 安全、无障碍和 Playwright 门禁通过；Resource UI 零回归。
