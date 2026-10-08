# v0.4.8：Capability Catalog and Dynamic Tool Routing

状态：设计草案，等待确认后实施

前置基线：v0.4.2 已建立统一 Capability Snapshot；v0.4.7 已证明 Browser、MCP、Context 与通用 Agent Loop 会共同扩大模型可见 Tool Schema。

> Luna 执行入口：先阅读本文件，再按 [`design.md`](design.md)、[`implementation.md`](implementation.md) 和 [`testing.md`](testing.md) 分批实施。每个 Batch 到达停点后再进入下一批，不得一次性重写 Tool Runtime。

## 目标

让 Isla 在不推翻现有 `ToolCapability`、`ToolRegistry`、`ToolRuntime`、Approval 和 Agent Loop 的前提下：

1. 用轻量 Manifest 描述 Host 当前能够提供的 Capability。
2. 在每个 Model Step 前，根据用户意图、Task State、已激活状态和 Profile 策略选择真正需要暴露的 Capability。
3. 允许模型通过最小发现工具补充搜索和激活能力。
4. 只把当前 Step 所需 Tool Schema 发给 Provider。
5. 将选择、拒绝、激活和实际 Snapshot 记录为可重建事实。

```text
Capability Provider
        ↓
Capability Catalog
        ↓
Runtime Resolver + Policy Filter
        ↓
Task Activation State
        ↓
每个 Model Step 的 Capability Snapshot
        ↓
Provider Tool Schema
```

## 首版范围

- 内置 Capability Manifest 与 Provider。
- 已配置 MCP Server 的目录投影。
- Runtime 确定性预选。
- `capability_search`、`capability_activate`、`capability_status`。
- Task 级激活状态与逐 Model Step Snapshot。
- Profile、Provider tool-calling、平台、配置、权限和预算过滤。
- Journal、TTY 与 NDJSON 的安全诊断。
- Tool 数、schema bytes 和估算 token 指标。

## 非目标

- 在线插件市场。
- 运行时下载或安装 npm 包。
- 网页或 Tool Result 驱动插件安装。
- 任意动态代码加载。
- Capability 热更新。
- 跨设备插件同步。
- 模型修改 Profile、Permission 或 Approval。
- 首版按任务启动/关闭 MCP 子进程。
- 依赖尚未标准化的 MCP 动态 Tool Search。
- Embedding、向量数据库或独立路由模型。

## 用户路径

```text
用户：帮我打开 GitHub 看项目
→ Runtime 预选 builtin.browser
→ 当前 Step 只注入 Browser 与常驻控制工具
→ 模型调用 Browser Tool
```

```text
用户请求无法被 Runtime 明确路由
→ 模型调用 capability_search("操作 GitHub 网页")
→ Runtime 返回有界 Capability 摘要
→ 模型调用 capability_activate("builtin.browser")
→ 下一 Model Step 重新生成 Snapshot 并获得 Browser Tools
```

## 关键约束

- Catalog 中“可发现”不等于“允许激活”，激活也不等于跳过 Tool 调用时的 Approval。
- Capability 激活不创建新 Session、不重置 Loop Budget、不清空失败计数。
- 网页、MCP Tool Result、Skill 内容和模型文字都不能修改 Capability Policy。
- Journal 保存完整 Capability ID；Provider Tool 名可以是兼容现有协议的稳定公开名。
- 任一请求实际发送的消息和 Tool Schema 必须能由 Session 与 Journal 重建。

文档入口：[设计](design.md) · [实施](implementation.md) · [测试](testing.md) · [验收](evaluation.md)
