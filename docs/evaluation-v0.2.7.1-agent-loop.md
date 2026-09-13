# Isla v0.2.7.1 真实评估记录：Agent Loop

日期：2026-09-13  
工作区：`D:\Project\Isla`  
授权：用户明确要求进行真实评估

## 结果摘要

### 真实 Provider smoke

- Provider：DeepSeek
- 模型：使用本机现有 Profile，未在日志或文档中记录密钥
- 场景：两轮独立简单问答
- 结果：通过
- 耗时：约 1.35 秒
- 网络：真实 Provider API
- Tool：未启用 Web Tool
- 隐私：未输出或保存 API Key

### 真实 Agent Loop 评估

- 目标场景：重庆取车后自驾回广州
- 安全 workspace：空临时 workspace，避免模型读取 Isla 项目文件
- 预期：首轮澄清，补充条件后继续原任务
- 结果：未完成
- 原因：Windows 子进程交互 driver 未能稳定收到 `ready` 事件，未形成可判定的 Agent Loop 模型结果
- 是否可据此判定 Agent Loop 失败：否
- 是否可据此判定 Agent Loop 通过：否
- 临时 workspace：已清理
- 临时评估脚本：已清理

追加复测（2026-09-13）：

- 复用现有 NDJSON Driver 后成功收到 `ready` 和 `response_start`；握手问题已排除；
- 首轮返回 `error`，code=`PROMPT_FAILED`，耗时约 4–6 秒；
- 说明真实 Provider 已收到请求，但当前模型输出未通过 Agent Loop decision envelope 解析（公共错误已脱敏，未记录原始模型文本）；
- fenced JSON 和带前后解释的 JSON 兼容解析已加入，复测仍失败；
- 当前不能宣称真实 Agent Loop 通过，下一步应增加受控 decision response 调试投影或采用 Provider 原生结构化输出能力。

追加复测（2026-09-13）：

- 使用现有 NDJSON Driver、显式 `ISLA_TIMEOUT_MS=600000` 和空临时 workspace；
- 首轮复杂旅行请求成功返回 `needs_user`；
- 首轮 Tool 调用数为 0，未生成 D1–D5 或伪精确里程/时长；
- 补充 5 天、预算、人数、驾驶员和偏好后，原任务成功继续；
- 测试通过，耗时约 18.5 秒；
- 同时修复 NDJSON `response_end` 未透传 `outcome` 的协议问题；
- 该结果证明“澄清门控与跨回合延续”真实可用，但尚未证明真实 Web 多轮查证和完整 synthesize 交付。

## 安全边界

真实 Agent Loop 评估未使用项目工作区作为模型可读 workspace。没有执行写入、登录、订票、支付或其他外部副作用。真实 Provider smoke 只验证模型问答链路，不代表 Web Tool 或完整 Agent Loop 已完成真实验收。

## 后续建议

为真实 Agent Loop 增加一个正式的、可诊断的 smoke driver：

1. 使用显式空 workspace 和临时 Session directory；
2. 将子进程启动错误、退出码和 `ready` 等待超时结构化输出；
3. 不依赖 `npm` 脚本吞并环境变量；
4. 首轮仅验证 clarify 和零 Tool；
5. 第二轮再验证 execute/synthesize；
6. 成功或失败后自动清理所有临时资源。

在该 driver 稳定前，不执行真实 Web Tool 多轮旅行查证，也不把本次结果写成完整 v0.2.7.1 真实验收通过。
