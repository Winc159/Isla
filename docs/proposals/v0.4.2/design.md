# v0.4.2 设计

## 1. 身份模型

统一目录只做投影，不取代现有 ToolRegistry、SkillCatalog 或 McpHost：

```ts
type CapabilityKind = 'builtin-tool' | 'skill' | 'mcp-tool';
interface CapabilityInventoryEntry {
  id: string;
  kind: CapabilityKind;
  origin: string;
  available: boolean;
  modelVisible: boolean;
  userInvocable: boolean;
  permission?: string;
  schemaBytes?: number;
  diagnosticCode?: string;
}
```

`id` 必须稳定且带来源限定；MCP 继续使用 `mcp__<server>__<tool>`。目录不得包含 secret、完整命令、cwd、Tool 参数或 Skill 正文。

## 2. Profile 策略

只支持显式、确定性的 allow/deny：Skill 按名称；MCP 按 Server id 与原始 Tool 名。deny 优先于 allow；未配置保持 4.1 行为。未知名称产生诊断但不阻断无关能力。

## 3. 预算

启动时对最终模型可见集合执行：Tool 总数、Tool schema 总字节、单 Skill 描述长度和 Skill 目录总字符预算。不得静默截断 schema；超限时启动失败或把 optional MCP Server 标记 unavailable。第一版不做语义检索或动态加载 MCP Tool。

## 4. Snapshot

每次请求前从已冻结运行 generation 产生不可变 Snapshot。Snapshot 记录稳定 id、kind、可见性和摘要 hash，不保存 schema 正文或 secret。模型请求、TTY 和 NDJSON 必须来自同一 Snapshot 投影。

## 5. 命令与协议

- `/capabilities`：安全摘要。
- `/capabilities check [id]`：来源、状态、可见性、权限与诊断。
- NDJSON `capabilities_list`：只读等价事实。

配置写入继续由 Profile 文件或现有专用向导负责；模型不能改变能力策略。

## 6. 偏离条件

若实现要求动态注册、插件安装、运行中替换 ToolRegistry 或修改 Session 核心格式，停止并先更新设计。
