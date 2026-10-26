# Isla v0.7.0：Runtime Kernel

## 设计目标

建立长期稳定的 Service、Scope、Effect 与 Agent 生命周期，使 Provider、Tool、MCP、Browser、Job 和 UI 协议不再依赖单一组合根手工装配。v0.7.0 只迁移生命周期，不改变现有 CLI、Host、Session 或 Tool 的外部行为。

允许对主 Agent Runtime 做重构级改造；Resource Service 内部保持冻结，只迁移其 Host 侧 Bridge 生命周期。

## 核心契约

- `ServiceKey<T>`：稳定服务身份，避免业务模块依赖具体实现。
- `ServiceDescriptor<T>`：声明 required/optional dependencies、scope 和 start。
- `ServiceRegistry`：拓扑启动、服务查询、重复 key 拒绝、失败回滚和逆序关闭。
- `RuntimeScope`：Host/Session/Agent/Turn/Task 的父子所有权。
- `Effect`：订阅、进程、连接、临时资源的统一清理句柄；注册后由 Scope 所有。
- `AgentRegistry`：后续在同一内核上管理 Agent create/resume/list/dispose。

## 实施步骤

1. 定义 typed service key、descriptor、registry、scope 和 effect。
2. 完成依赖拓扑、循环依赖、缺失依赖、启动失败回滚和幂等关闭测试。
3. 给现有 Application 建兼容装配层，不改变构造 API。
4. 逐个迁移 Provider、MCP、Browser、SessionFactory；每迁移一个服务保持全量测试通过。
5. 增加 AgentRegistry 与 ownership 测试。
6. 更新架构和开发文档，禁止新增无生命周期所有者的常驻资源。

## 迁移批次

1. Kernel 契约与纯单元测试。
2. `Application` 成为 Host Scope 的所有者，兼容原同步 `close()`，内部提供可等待的 `dispose()`。
3. Provider Registry 和 Config Snapshot 迁移为服务。
4. MCP Host、Browser Runtime、Memory 和 Session Store 迁移为 Effect。
5. SessionFactory 只从 Service Context 取依赖，不再自行创建常驻资源。
6. 新增 Agent Registry；旧 `ChatSession` 通过 Adapter 注册为 Agent Handle。
7. Host shutdown 做 drain、cancel、flush、reverse-dispose。

Resource 限制：只把 `ResourceBridgeClient` 注册为 optional Host Service；不修改 Resource 进程、数据库、Scheduler 或 API。

## 验收目标

- 服务只能在依赖满足后启动。
- required dependency 缺失和循环依赖在启动前失败。
- 任一服务启动失败时，已启动服务按逆序清理。
- 父 Scope 关闭会等待并逆序关闭全部子 Scope 和 Effect。
- Effect 清理最多执行一次；多个清理失败可汇总但不阻止剩余清理。
- Host shutdown 后没有遗留 MCP 子进程、浏览器上下文、定时器或 Session 写句柄。
- 每个由 SessionFactory 创建的 ChatSession 都注册成 Agent Handle；Turn 结束或 Host shutdown 会 drain 并释放该 Handle。
- 现有 CLI、Host、Resource、协议和 Session 测试保持兼容。
- `npm run verify`、Host shutdown 故障注入和 Resource mock-e2e 全部通过。

## 自动测试

- Service 依赖拓扑、缺失依赖、循环和重复 key。
- 启动失败回滚、逆序关闭、幂等关闭和多错误聚合。
- Host/Session/Agent/Turn/Task 父子 Scope 所有权。
- MCP 子进程、Browser context、Session handle 和 timer fake resource 泄漏检查。
- Application 兼容 API 与 shutdown 次序。

## 真实验收

- 启动 Resident Host，进行普通对话、MCP 调用和 Browser 会话后关闭，确认资源全部释放。
- 在 MCP、Memory、Browser 各注入一次启动失败，Host 给出明确降级或失败结果且不残留资源。
- Resource Service 运行和 Bridge Job 回归保持原行为。
