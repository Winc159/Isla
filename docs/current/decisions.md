# Isla v0.3.0 当前设计取舍

状态：设计已确认，待实施。

- Provider 对外 ID 使用 `bailian`，不使用 `qwen` 或含义过宽的 `ali`。
- Provider 表示平台与协议适配；Qwen、DeepSeek、GLM、Kimi 等是模型或模型族，不为每个模型新增 Provider。
- v0.3.0 首条生产协议使用百炼 OpenAI-compatible Chat Completions；Responses 与 DashScope 原生生成接口暂缓。
- Profile config 是正常用户启动的唯一配置事实源；`--env` 只保留为开发、CI 和迁移兼容入口，不与 Profile 隐式字段级合并。
- API Key、Base URL 和 model 由完整 Profile 明确提供；不硬编码地域、Workspace ID 或共享 endpoint，不静默跨地域/Provider 回退。
- 接入官方 `GET /api/v1/models`，但模型目录不是普通启动硬依赖；刷新由用户、首次选择或显式自动化触发。
- 模型目录只读，不自动修改 Profile、不动态切换当前 Session 模型。
- 可缓存最近一次成功的非敏感目录投影；失败时保留旧缓存并标记 stale。
- 官方目录 metadata 用于发现和筛选，不自动证明 Isla Tool Calling 或 streaming 已可用；能力声明仍需官方协议规则、离线 fixture 和真实验证。
- Batch A 只声明普通文本；Batch C 只为已验证模型/模型族打开 one-shot Tool Calling。
- 模型兼容差异按现实需求增加窄策略，不预建每模型类、通用能力注册中心或多层 Provider 抽象。
- 普通启动期间 provider/model 继续固定，不增加动态模型路由或自动额度轮换。
- 不假定每个模型固定拥有 1M 免费额度；没有可靠额度 API 前只展示官方目录提供的价格和能力事实。
- Streaming 延后到 Batch D，文本和 Tool streaming 必须分别验证；不切片 one-shot 回答制造假流式。
- 需要真实配置时必须给用户可复制模板，明确字段和文件位置；不得要求用户在对话中粘贴 API Key。
- 默认测试完全离线；真实百炼请求必须具备显式开关、本地有效配置和用户授权。
- 不新增 Shell、MCP、并行 Tool、子 Agent、后台任务、多模态或平台内置 Agent 工具。

v0.2.9 的 Session 可重建、有效 assistant 才提交、provisional delta 不持久化、能力声明真实保守、唯一终态、取消和安全边界全部继续有效。
