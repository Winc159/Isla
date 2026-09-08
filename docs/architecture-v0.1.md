# Isla v0.1 会话持久化

## 目标

v0.1 将当前进程内会话保存为用户级 JSON 文件，使 CLI 重启后可以继续最近一次对话，并支持使用 `/new` 开启独立的新对话。

## 采用

- 会话文件保存在 `~/.isla/sessions/`，不进入项目仓库。
- 每个会话对应一个 JSON 文件，记录格式版本、会话 ID、时间、Provider、模型和完整消息历史。
- 启动时恢复当前 Provider 和模型对应的最近会话；没有匹配会话时创建新会话。
- user 消息进入历史后立即保存；Provider 成功后再保存 assistant 消息。
- `/new` 创建新文件并切换到空白上下文，不删除旧会话。
- 文件通过临时文件写入后重命名，避免中途退出留下半个 JSON 文件。
- JSON 保存完整历史；发送给 Provider 时始终保留 system prompt，并只选择最近 `ISLA_MAX_CONTEXT_TURNS` 轮对话。
- `ISLA_MAX_CONTEXT_TURNS` 默认为 20，必须是正整数。一轮从 user 消息开始，包含其后的 assistant 消息；失败后没有 assistant 的 user 消息也算一轮。
- DeepSeek 请求显式设置 `thinking.type=disabled`，普通对话不使用默认 high 思考模式。
- 交互式 CLI 等待期间显示无依赖 spinner；成功或失败后显示单次请求耗时。耗时不写入会话 JSON。

## 暂缓

- 会话列表、选择旧会话、重命名、搜索和删除命令。
- 摘要、基于重要性的选择、精确 token 计算、长期记忆和跨设备同步。
- SQLite、数据库迁移和 Repository 层。
- 加密与操作系统密钥管理。

## JSON 格式

```json
{
  "version": 1,
  "id": "2026-09-08T12-00-00.000Z-uuid",
  "createdAt": "2026-09-08T12:00:00.000Z",
  "updatedAt": "2026-09-08T12:05:00.000Z",
  "provider": "deepseek",
  "model": "deepseek-chat",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

会话文件包含私人对话内容，不属于诊断日志，不记录 API Key、Authorization Header 或完整环境变量。
