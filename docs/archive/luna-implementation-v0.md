# Luna：Isla v0 执行清单

本文件是下一执行者 Luna 的实现任务书。开始前必须完整读取根目录 `AGENTS.md`、`docs/architecture-v0.md` 和本文件。

## 0. 执行边界

- 目标是实现设计文档定义的 v0，不扩展范围。
- 不实现流式、工具、持久化、记忆、Web、Docker 或动态插件。
- 不自行执行 `git add`、`git commit`、`git push` 或发布 npm。
- 不使用真实 API Key 运行自动测试。
- `ISLA_DEBUG=1` 仅启用不含密钥和会话内容的 stderr 诊断，不增加日志文件或日志框架。
- 每完成一个阶段都运行当前可用的 `npm run check` 和 `npm run build`。
- 如果官方 SDK 的当前类型与设计示例冲突，保持架构职责不变，做最小类型适配并记录到设计文档。
- 如果一个实现决定会新增三个以上非计划文件或改变核心契约，先停止并向用户说明。

## 1. 阶段 A：项目脚手架

创建：

```text
package.json
package-lock.json
tsconfig.json
vitest.config.ts
.gitignore
.env.example
LICENSE
src/
tests/
```

要求：

- 包名先使用 `@winc159/isla`；只在 npm 明确拒绝时再向用户确认替代名。
- `private` 在实现阶段设为 `true`，防止误发布；正式公开发布前再明确移除。
- `type` 为 `module`。
- `bin.isla` 指向 `dist/cli.js`。
- `files` 只包含 `dist`、README 和 LICENSE 所需内容。
- Node engines 为 `>=24`。
- 生产依赖只加入 `openai`。
- 开发依赖只加入 `typescript`、`tsx`、`vitest`、`msw`、`@types/node`。
- `.gitignore` 至少排除 `.env`、`node_modules`、`dist`、coverage、`.vitest` 和日志文件。

验收：

```text
npm install
npm run typecheck
```

## 2. 阶段 B：核心类型与插件协议

实现：

```text
src/core/types.ts
src/core/plugin.ts
```

要求：

- 使用 `readonly` 表达请求不可被 Provider 修改。
- 不导入任何厂商 SDK 类型。
- PluginContext 只公开 `registerProvider`。
- 不创建通用 Registry、Container 或 Service 类型。

同时创建 FakeProvider 测试支撑：

```text
tests/support/fake-provider.ts
```

FakeProvider 支持：

- 保存收到的请求。
- 按顺序返回预设回答。
- 按测试要求抛出预设错误。

## 3. 阶段 C：Runtime 注册

实现：

```text
src/core/runtime.ts
tests/core/runtime.test.ts
```

测试先覆盖：

- 安装插件。
- 注册并取得 Provider。
- 重复插件名失败。
- 重复 Provider ID 失败。
- 未注册 Provider 时创建 Session 失败。

实现保持同步 setup；v0 不需要异步插件生命周期。

## 4. 阶段 D：ChatSession

实现：

```text
src/core/session.ts
tests/core/session.test.ts
```

必须使用“提交 user → 从当前历史构造请求 → 调用 Provider → 成功后提交 assistant”的顺序。

覆盖：

- 可选 system prompt。
- 首轮消息顺序。
- 两轮上下文顺序。
- Provider 抛错时保留 user 消息，不增加 assistant 消息。
- 后续请求包含失败请求的 user 消息。
- 返回统一 ModelResponse。

不要增加 Session 持久化、公开可变 messages 或并发锁。

## 5. 阶段 E：配置

实现：

```text
src/config.ts
tests/config.test.ts
```

定义一个明确的 discriminated union，使三种 Provider 配置在 TypeScript 中可收窄：

```ts
type AppConfig = OpenAIConfig | DeepSeekConfig | LocalConfig;
```

共同字段包括 model、systemPrompt、timeoutMs；每个分支只包含自己需要的 Key 或 Base URL。

配置函数接收一个普通键值对象，默认调用方传 `process.env`。测试传入独立对象，不直接反复修改全局环境。

## 6. 阶段 F：OpenAIProvider

实现：

```text
src/providers/openai.ts
tests/providers/openai.test.ts
```

要求：

- 工厂函数返回 RuntimePlugin。
- 使用 OpenAI Responses API。
- 使用完整 messages，不使用服务端 conversation 或 previous response ID。
- Client 配置 `maxRetries: 0` 与 timeout。
- 空 `output_text` 视为失败。
- 只返回统一 ModelResponse。

测试通过 MSW 拦截 HTTP，不 mock Provider 自己的方法，也不访问公网。

## 7. 阶段 G：DeepSeekProvider

实现：

```text
src/providers/deepseek.ts
tests/providers/deepseek.test.ts
```

要求：

- OpenAI SDK 设置 `baseURL: "https://api.deepseek.com"`。
- 使用 Chat Completions。
- 不加入 thinking、reasoning 或工具参数。
- Client 配置 `maxRetries: 0` 与 timeout。
- 缺少文本 choice 时失败。

## 8. 阶段 H：LocalProvider

实现：

```text
src/providers/local.ts
tests/providers/local.test.ts
```

要求：

- 使用用户配置的 Base URL。
- 使用 Chat Completions 的共同最小字段：model、messages、stream false。
- API Key 可选。
- 不识别 Ollama、LM Studio 或 MLX-LM 品牌。
- 不增加 health check、模型列表查询或自动启动。

## 9. 阶段 I：组装与 CLI

实现：

```text
src/main.ts
src/cli.ts
tests/cli.test.ts
```

`main.ts` 负责根据 AppConfig 选择并创建唯一 Provider 插件；`cli.ts` 负责交互入口。

CLI 测试必须使用内存输入输出，不启动子进程、不访问网络。

CLI 生产入口包含 Node shebang：

```text
#!/usr/bin/env node
```

构建后确认 shebang 保留，并确认 `npm link` 后可以执行 `isla`。

## 10. 阶段 J：真实 Smoke Test

建立独立 smoke 测试目录。测试只有在用户显式运行 `npm run test:smoke` 时执行。

规则：

- 没有对应 Key 或 Base URL 时，明确 skip，而不是失败。
- 每个 Provider 只发送一个非常短的请求。
- 不断言具体自然语言内容，只断言存在非空文本。
- 不加入默认 `check` 与 GitHub CI。

未获得用户 API Key 时不要执行该命令。

## 11. 阶段 K：CI 与包检查

实现：

```text
.github/workflows/ci.yml
```

矩阵：Ubuntu、Windows、macOS；Node 24。

执行：

```text
npm ci
npm run check
npm run build
npm run pack:check
```

不配置 secrets，不发布 npm，不上传包含用户输入的 artifact。

## 12. 最终验证顺序

Luna 完成全部实现后执行：

```text
npm ci
npm run check
npm run build
npm run pack:check
```

然后检查：

1. `dist/cli.js` 存在且保留 shebang。
2. npm dry-run 包中没有 `.env`、tests、docs/bugs 私人内容或源码调试文件。
3. 三类 Provider 测试均被 MSW 截获，没有未处理网络请求。
4. 两轮上下文测试明确验证消息顺序。
5. Provider 失败后的下一轮包含上次 user 消息，且不存在对应的伪 assistant 消息。
6. Git diff 只包含计划文件，不存在额外框架或功能。

真实 API 手工验收顺序：

```text
OpenAI → DeepSeek → Local
```

本地模型尚未准备好时，Local 真实 smoke 可以保留为未执行，但模拟契约测试必须通过。

## 13. 完成汇报格式

向用户汇报：

- 已实现的闭环。
- 创建的核心模块。
- 自动测试数量与结果。
- 构建与 npm pack 结果。
- 哪些真实 API 已验证、哪些因缺少 Key 或模型服务未运行而未验证。
- 仍属于 v0 范围外的内容。
- 不主动提交或推送 Git。
