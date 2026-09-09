# Isla v0.1 会话持久化

## 目标

v0.1 将当前进程内会话保存为用户级 JSON 文件，使 CLI 重启后可以继续最近一次对话，并支持使用 `/new` 开启独立的新对话。

## 采用

- 会话文件保存在 `~/.isla/sessions/`，不进入项目仓库。
- 每个会话对应一个 JSON 文件，记录格式版本、会话 ID、时间、Provider、模型和完整消息历史。
- 启动时恢复当前 Provider 和模型对应的最近会话；没有匹配会话时创建新会话。
- user 消息进入历史后立即保存；Provider 成功后再保存 assistant 消息。
- `/new` 创建新文件并切换到空白上下文，不删除旧会话。
- `/sessions` 在交互式终端中列出同一 Provider、模型的历史会话，支持方向键、PageUp/PageDown 和 Enter 选择；切换后清屏并回放所选会话历史。
- 会话选择界面使用临时屏幕缓冲区；按 Esc 或选中当前会话时恢复原终端内容，不改变当前上下文。
- CLI 命令通过统一注册表分发。每条命令声明行输入或原始按键输入模式，并返回继续、退出或切换会话结果；CLI 主循环统一应用结果。
- 命令层保持静态注册，不实现动态插件加载、依赖注入容器或通用参数解析框架。
- 文件通过临时文件写入后重命名，避免中途退出留下半个 JSON 文件。
- JSON 保存完整历史；发送给 Provider 时始终保留 system prompt，并只选择最近 `ISLA_MAX_CONTEXT_TURNS` 轮对话。
- `ISLA_MAX_CONTEXT_TURNS` 默认为 20，必须是正整数。一轮从 user 消息开始，包含其后的 assistant 消息；失败后没有 assistant 的 user 消息也算一轮。
- DeepSeek 请求显式设置 `thinking.type=disabled`，普通对话不使用默认 high 思考模式。
- 交互式 CLI 等待期间显示无依赖 spinner；成功或失败后显示单次请求耗时。耗时不写入会话 JSON。
- 交互式 TTY 使用最小 raw 输入编辑器：Enter 发送，Shift+Enter 在终端可区分时换行，Alt+Enter 作为备用换行键；支持多行粘贴、光标移动、Home/End、删除、按 grapheme 编辑中文与 emoji，以及单行输入历史。
- Ctrl+C 不由 Isla 绑定；独立 Esc 或 `/exit` 退出。会话选择取消后恢复原草稿，成功切换或 `/new` 后清空草稿。
- 非 TTY 和管道输入继续使用逐行模式。输入编辑器只向 CLI 返回完整消息，不进入 Runtime、Session 或 Provider。
- 光标所在 token 以 `/` 开头，且 token 位于输入开头或空白、换行之后时，输入区下方展示静态注册表中的匹配命令；唯一匹配项可用 Tab 局部补全。只有整条输入精确等于命令时才执行 CLI 命令，嵌入普通消息的 slash token 仍作为消息内容发送。Enter、Esc 和方向键行为不因提示列表改变。

## 暂缓

- 会话重命名、搜索和删除命令。
- 摘要、基于重要性的选择、精确 token 计算、长期记忆和跨设备同步。
- SQLite、数据库迁移和 Repository 层。
- 加密与操作系统密钥管理。
- 参数自动补全、语法高亮、鼠标、撤销/重做、输入历史搜索和第三方终端输入依赖。

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
