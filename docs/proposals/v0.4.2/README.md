# v0.4.2：Capability Composition and Exposure

状态：核心实现与自动化验收通过，已收口

前置基线：v0.4.1 核心功能验收通过。

## 目标

把现有内建 Tool、Skill 和 MCP Tool 投影成统一、只读、可诊断的能力目录，并由 Profile 明确决定模型最终看到哪些能力。解决能力来源不透明、MCP 大目录占用上下文、不同 Surface 状态不一致的问题。

## 完成范围

1. 统一 `CapabilityInventoryEntry` 与请求级不可变 `CapabilitySnapshot`。
2. Profile 支持 Skill allow/deny 和 MCP Server 工具 allow/deny。
3. 对模型可见 Tool 数、schema 字节和 Skill 目录描述设置预算。
4. 增加 `/capabilities` 与 NDJSON 只读查询。
5. Session/Journal 保存足以重建模型实际能力集合的稳定身份与摘要。

## 非目标

不做通用插件管理器、动态安装、热重载、Tool 搜索引擎、Subagent、Shell、远程 MCP 或 Cordis 式事件系统。

## 用户路径

```text
Profile 配置能力策略 → 启动 Isla → /capabilities check
→ 冻结 CapabilitySnapshot → 模型只看到允许且预算内的能力
```

文档入口：[设计](design.md) · [实施](implementation.md) · [测试](testing.md) · [验收](evaluation.md)
