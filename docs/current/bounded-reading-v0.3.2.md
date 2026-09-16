# Isla v0.3.2：Bounded File Reading

状态：已实现并完成离线门禁收口

日期：2026-09-16

## 1. 目标

把现有 `read_text_file` 从全文读取升级为有界、可分页、带行号的 UTF-8 文本窗口，避免大文件一次进入模型上下文，并为 `search_project → read_text_file → edit_text_file` 提供确定性链路。

## 2. DSH 参考取舍

采用 DSH `read` Tool 的核心行为：

- `offset` 是从 1 开始的首行，默认 1；
- `limit` 是最大返回行数，默认及最大 2000；
- 单行最多返回 2000 字符；
- 一次选中内容最多返回 50 KiB；
- 返回稳定行号、精确总行数和继续读取提示；
- 文件达到 10 MiB 或更大时流式扫描，不整体加载；
- 窗口读取完成后记录整个文件版本，而不是只记录已返回范围。

不采用 DSH 的文件系统 Provider、结构化 UI 卡片、spill store、Cordis、`grep`/`glob` Tool 或配置层。Isla 继续使用现有 Sandbox、`search_project` 和 SHA-256 观察状态。

## 3. Tool 契约

```ts
read_text_file({
  path: string,
  offset?: number,
  limit?: number,
})
```

约束：

- `path` 必须是项目内非敏感相对路径；
- `offset` 和 `limit` 必须是正整数；
- `limit` 不得超过 2000；
- 空文件允许 `offset=1`，返回零行；
- 非空文件的 offset 超过总行数时稳定失败；
- CRLF 的 `\r` 不进入行正文；
- 末尾换行不额外制造空行；
- 达到总字节上限时停止保留更多行，但继续扫描以得到精确总行数和完整 SHA-256。

模型可见输出：

```text
<path>src/example.ts</path>
<type>file</type>
<content>
41: export function example() {
42:   return true

(Showing lines 41-42 of 80. Use offset=43 to continue.)
</content>
```

## 4. 编辑关系

- 任何成功窗口读取都记录整个文件的 SHA-256；
- `edit_text_file` 继续以整个文件摘要检查陈旧状态；
- 不记录已读取行范围，也不要求 `oldText` 位于最近窗口；
- 编辑仍要求文件具有当前 Session 的成功读取、写入或编辑观察。

## 5. 非目标

- 不增加 head/tail 专用模式；
- 不解析 Markdown 段落或编程语言 AST；
- 不按函数名直接读取；
- 不增加正则搜索、glob 或搜索结果 spill；
- 不改变 Session、Journal、Approval 或 Provider 契约。

## 6. 完成信号

- 默认窗口、指定 offset/limit、继续读取 footer 正确；
- 行数、单行和总字节三重上限正确；
- 空文件、CRLF、末尾换行、超范围和参数错误稳定；
- 大文件走流式路径并得到精确总行数；
- 窗口读取后可编辑，外部变化仍返回 `FILE_STALE`；
- typecheck、全量离线测试、build、pack check 与 diff check 通过。
