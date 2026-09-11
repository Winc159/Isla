# Isla v0.2.1 测试结构与案例

## 测试结构

```text
tests/
  core/                 Agent Loop、Context 投影、压缩、Tool Runtime
  memory/               SQLite Store、Core Block、Policy、关键词、Embedding、混合召回
  cli/                  命令注册、输入编辑器、/memory 基础命令
  providers/            Provider 协议解析
  smoke/                默认跳过的真实 Provider 与 NDJSON 验收
  protocol.test.ts      NDJSON 状态机与 Approval
  protocol.e2e.test.ts  本地子进程协议闭环
  session-store.test.ts Session v1/v2 兼容与持久化
```

默认测试完全离线；真实测试仅在 `ISLA_RUN_REAL_SMOKE=1` 且对应配置存在时运行。所有写入使用临时目录，并在 `finally` 中清理。

## 核心案例

| 层 | 案例 | 关键断言 |
|---|---|---|
| Session | v1 恢复与 v2 保存 | 原消息不丢失；保存后升级；checkpoint 可恢复 |
| Context | 压力压缩 | 原始 messages 不变；旧区由 checkpoint 投影；最近完整轮次保留 |
| Context | 压缩失败 | 主回答继续；无未持久化 checkpoint 注入 |
| Memory Store | 创建、修改、停用、恢复 | 每次变化有 revision；并发 revision 冲突被拒绝 |
| Core Memory | Block 初始化与预算 | persona/user/workspace 顺序稳定；不覆盖旧值；超预算拒绝 |
| Policy | 来源与秘密 | explicit/verified 可 active；inferred 为 candidate；external/secret/失败 Tool 拒绝 |
| Keyword | 中英文、状态、工作区 | Candidate 默认排除；workspace 不串；数量和字符预算生效 |
| Embedding | Float32/generation | 非有限值、空向量、零向量、维度混用被拒绝 |
| Hybrid | 降级与去重 | Embedding 失败回退关键词；disabled/superseded 不召回 |
| CLI | `/memory` | 基础列表、详情、停用可用；不直接编辑数据库 |
| Protocol | NDJSON | stdout 每行可解析；Approval ID 匹配；退出前 flush |
| Real NDJSON | 两轮完整场景 | 问答、读取、讨论、拒绝写入、新会话、批准写入、bye |

## 真实 NDJSON 场景结构

每轮创建独立临时 workspace 和 session 目录：

1. 启动 `dist/cli.js --protocol ndjson` 并等待 `ready`；
2. 普通问答，等待匹配 ID 的 `response_end`；
3. 目录读取与只读讨论；
4. 写入请求，接收 `approval_request` 后拒绝；
5. `new_session` 并确认 `session_changed`；
6. 第二次写入请求，批准后检查临时文件实际内容；
7. `exit` 并确认 `bye`；
8. 清理临时 workspace 与 session。

日志只记录事件类型、请求 ID、错误类别和断言结果，不记录完整对话、Tool Result、记忆正文、Embedding 或密钥。

## 当前端到端覆盖边界

真实 NDJSON 当前证明 v0.2.0 协议和安全链路没有回归。长期记忆模块已有离线单元测试，但尚未完整接入 CLI/NDJSON 主链路，因此“跨进程自主记忆与召回”不能标记为真实验收通过。这是 v0.2.1 收口前的剩余阻断项。
