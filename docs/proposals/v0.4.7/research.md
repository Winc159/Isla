# v0.4.7 浏览器能力外部参考

更新时间：2026-09-24

本文只记录设计参考，不复制外部项目架构或源码。Isla 继续使用自身 `ToolRuntime`、Approval、Session、Resident Host 和 Config/Profile 边界。

## 1. 参考项目

### Microsoft Playwright MCP

- 官方仓库：https://github.com/microsoft/playwright-mcp
- 官方 Playwright 文档：https://github.com/microsoft/playwright/blob/main/docs/src/getting-started-mcp.md
- 重点：accessibility snapshot、短期元素 ref、按文本查找、snapshot depth、截图只用于视觉确认、动作/导航/settle 独立超时。

决定：采用 accessibility-first snapshot、`browser_find`、有界 snapshot、动作后 settle；拒绝模型任意 Playwright code/JavaScript。

### DeepSeek Harness / dsh-browser

- Harness：https://github.com/deepseek-ai/deepseek-harness
- 官方浏览器插件参考：https://github.com/justwe-bot/dsh-browser
- 重点：浏览器能力作为插件/能力族注册；snapshot 返回可见文本和交互元素；ref 与 `documentId` 绑定，文档替换后返回 `STALE_REF`；后台 tab 不抢用户焦点；页面显示 Agent 正在控制的固定提示；变更型工具进入 Approval。

决定：采用 `documentId + ref`、tabId、STALE_REF、控制指示器、mutation approval；首版不连接用户日常 Chrome Profile，仍使用 Isla 隔离 Chromium。

### Browser Use / Browser Harness

- Browser Use：https://github.com/browser-use/browser-use
- Browser Harness：https://github.com/browser-use/browser-harness
- 重点：任务分步和最大步数；结构化 ActionResult；视觉按需；人工求助工具；持久浏览器会话；可扩展 domain helper。

决定：采用步骤预算、结构化结果、人工求助、按需截图；暂缓自修改 helper、云浏览器、同步用户 Cookie；拒绝模型直接 CDP。

### OpenHands

- Agent Canvas：https://github.com/OpenHands/docs/blob/main/openhands/usage/agent-canvas/overview.mdx
- 重点：控制面和执行后端分离，可连接本地、容器或远程后端。

决定：维持 Browser Console 与 Browser Runtime 分离；部署方式不进入 Agent/Session 核心。

## 2. 采用、暂缓、拒绝

| 分类 | 决定 |
|---|---|
| accessibility snapshot + ref | 采用 |
| `documentId`/`snapshotId` 防旧 ref | 采用 |
| `browser_find` 局部检索 | 采用 |
| 普通正文分块读取与 cursor | 采用 |
| screenshot 仅按需 | 采用 |
| 每步动作后小型 delta observation | 采用 |
| tab 管理 | 采用最小集合 |
| 人工接管和 secret 专用通道 | 采用 |
| 任意 Playwright code / JS / CDP | 拒绝 |
| CSS/XPath 直接暴露模型 | 拒绝 |
| 自动同步系统 Chrome 密码库 | 拒绝 |
| 自修改 domain helper | 暂缓 |
| 云浏览器和并行浏览器池 | 暂缓 |
| noVNC/视频流 | 暂缓 |

## 3. 对 Isla 的关键修正

1. `browser_observe` 不能枚举任意 DOM；必须基于 accessibility/可见语义树。
2. `ref=e12` 必须绑定 `documentId`，导航、reload、frame replacement 或显著 document change 后失效。
3. 模型读取论坛/帖子/视频页面时优先 `browser_find` 和 `browser_read` 分块，不默认注入整页。
4. 页面文本始终是 untrusted observation，不得改变 System Prompt、权限和 Approval。
5. 截图、DOM 正文、Cookie、Storage、Header、URL query/fragment 不进入 Journal 和普通日志。
6. 所有变更型动作必须区分 read-only、interact、external-side-effect、secret、denied 五级。

## 4. 通用 Agent Loop 管理

动态预算属于通用 Agent Runtime，不属于 Browser 子系统。Browser、文件、Shell、MCP、Session Query 和未来 Tool 都共享相同的 Turn/Step/Tool Result 事实。

参考：

- [DeepSeek Harness agent-loop](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/agent-loop/README.md)：Turn/Step、Tool dispatch、持久 Session log 和取消由核心 loop 统一拥有；并行 Tool 数量与循环步数是不同维度。
- [DeepSeek Harness 无上限循环问题](https://github.com/deepseek-ai/deepseek-harness/discussions/2821)：仅依赖模型自行结束可能导致单 Turn 累积大量 Step/Token；需要内核级硬上限和明确终态。
- [Browser Use Agent 配置](https://github.com/browser-use/browser-use/blob/main/skills/open-source/references/agent.md)：区分 `max_steps`、`max_actions_per_step`、`max_failures`、单步超时和历史保留数量。
- [OpenHands StuckDetector](https://github.com/OpenHands/software-agent-sdk/blob/main/openhands-sdk/openhands/sdk/conversation/stuck_detector.py)：在有限事件窗口内检测重复 action-observation、action-error、交替循环、模型独白和 context error。

采用：通用 Step Budget、失败预算、时间预算、Token/Context 门禁、有限窗口循环检测、可审计 stop reason、动态续租和用户停点。

拒绝：模型单方面声明“仍有进展”即可无限续租；仅为 Browser Tool 编写专用循环控制；仅依靠 context compaction 替代循环熔断。
