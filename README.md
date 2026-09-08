# Isla

Isla 是一个使用 TypeScript 开发的个人 Agent Runtime。目前通过 CLI 提供进程内连续对话，支持 OpenAI、DeepSeek 和兼容 OpenAI 接口的本地模型服务。

## 使用

将 `.env.example` 复制为 `.env`，设置 `ISLA_PROVIDER`、`ISLA_MODEL`，以及对应的 API Key 或 `ISLA_BASE_URL`，然后运行：

```bash
npm run dev
```

构建后也可以运行：

```bash
npm run build
npm start
```

输入 `/new` 开启新对话，输入 `/sessions` 通过方向键选择历史会话，输入 `/exit` 或按 `Ctrl+C` 退出。

等待模型返回时，交互式终端会显示生成状态和本次请求耗时。DeepSeek 默认使用非思考模式，以降低普通对话的等待时间。

## 会话保存

对话以 JSON 文件保存在 `~/.isla/sessions/`。Isla 启动时会恢复当前 Provider 和模型对应的最近会话。

`/sessions` 会列出当前 Provider 和模型对应的历史会话。使用上下方向键或 PageUp/PageDown 移动，按 Enter 切换，按 Esc 取消。切换后会清屏并回放所选会话的历史消息。

会话文件保留完整历史，但每次请求默认只向模型发送最近 20 轮对话。可以通过 `ISLA_MAX_CONTEXT_TURNS` 调整轮数。

会话文件包含完整对话内容，属于用户私人数据，不应提交到 Git 仓库或公开分享。
