# Isla 当前架构决策

每项决策均记录背景、选择、代价和重新评估条件。历史设计过程见对应 proposal。

## D1 Config/Profile 是正常配置事实源

- 背景：Provider、模型、Base URL、凭据和能力策略需要可解释、可切换且不依赖 shell 状态。
- 决策：正常启动读取 `~/.isla/config.json` 或显式 `--config`；`.env` 只用于 `--env`、开发、CI 或迁移兼容。
- 理由：避免猜测环境变量含义，并让配置诊断与修改有唯一事实源。
- 代价：本地配置文件包含明文凭据，需要按私人文件保护；修改通常下次启动生效。
- 重新评估：引入系统凭据库或多用户配置服务时。

## D2 Provider 表示协议而不是主机

- 背景：同一 OpenAI-compatible 协议可连接云端或局域网模型服务。
- 决策：Provider 负责请求/响应协议和能力声明；模型、IP、端口与 Base URL 属于 Profile。
- 理由：避免为每台主机或模型复制 Provider。
- 代价：模型族的细微差异需要窄能力策略或配置表达。
- 重新评估：目标服务无法由现有协议适配表达时。

## D3 部署方式不进入 Runtime Core

- 背景：Isla 需要在 Windows 开发机、macOS ARM64 和 Linux x64 上运行。
- 决策：Node、容器、systemd、launchd 和 Resident Host 都是托管/入口层，复用 Application 与 SessionFactory。
- 理由：保持核心可测试并避免设备绑定。
- 代价：平台安装和进程管理仍需独立验收。
- 重新评估：部署环境需要改变核心资源或安全模型时。

## D4 Session 必须重建实际模型输入

- 背景：调试、恢复和审计要求知道模型看到了什么。
- 决策：用户输入在 Provider 调用前进入历史；Context、Tool 结果、Task State 和请求快照可重建投影；只有有效回答进入 assistant 历史。
- 理由：失败、取消或空回答不能污染事实历史。
- 代价：Session schema、压缩与迁移更严格。
- 重新评估：引入不可重放的实时多模态输入时。

## D5 原始 Session 与模型 Context 分离

- 背景：长会话不能无限发送，但不可丢失事实。
- 决策：原始消息持久保存；预算压力只裁剪请求投影，并生成可追溯 checkpoint。
- 理由：兼顾可恢复性和上下文预算。
- 代价：投影、Journal 和 Token 估算增加复杂度。
- 重新评估：存储规模或隐私保留策略要求删除原始消息时。

## D6 Capability Catalog 由 Host 持有

- 背景：内建 Tool、Skill、MCP 和 Browser 需要统一发现，但不能把所有 schema 永久暴露给模型。
- 决策：Host/SessionFactory 构建 Catalog；Runtime 根据当前任务选择和激活能力。
- 理由：目录生命周期、Profile 和外部进程归属明确。
- 代价：入口必须共享同一装配路径，动态热重载暂不支持。
- 重新评估：出现跨 Host 分布式目录或可信在线插件系统时。

## D7 Tool Schema 按 Model Step 暴露

- 背景：静态大工具集增加 token 成本和误调用风险，模型又可能在执行中发现新需求。
- 决策：每个 Model Step 生成不可变 Snapshot；激活在下一步生效。
- 理由：工具集合可解释、可记录，并允许受控动态发现。
- 代价：能力激活通常多一次模型往返。
- 重新评估：Provider 支持等价且可审计的原生动态工具协议时。

## D8 激活不能绕过安全控制

- 背景：发现能力、允许模型看见 schema 和批准真实执行是不同权限。
- 决策：Capability availability 先受 Profile/Policy 限制；调用继续经过 Sandbox、Approval、MCP policy 和 Tool Runtime。网页不可信内容不能激活非只读能力。
- 理由：避免把路由层变成提权路径。
- 代价：同一能力会经过多层明确检查。
- 重新评估：只有在新的安全模型能给出至少同等隔离与审计时。

## D9 MCP 是外部能力协议，不是信任边界

- 背景：第三方 Server 的 schema、说明和结果可被污染或失控。
- 决策：首版仅支持 Profile 配置的本地 stdio Server；内容视为不可信，并受命名、预算、权限、取消和关闭约束。
- 理由：以最小协议面验证互操作，避免自动安装和远程授权复杂度。
- 代价：暂不支持远程 transport、OAuth、resources 和 prompts。
- 重新评估：出现必须使用远程 MCP 的真实需求并完成认证设计时。

## D10 Browser 保留人工控制与凭据隔离

- 背景：登录、验证码和敏感表单不能安全地完全交给模型。
- 决策：Browser Console 只监听 loopback；用户可接管；凭据由 Runtime 按精确 Origin 批准并填充，明文不进入模型上下文。
- 理由：把人类控制和秘密边界放在 Runtime，而非网页提示词中。
- 代价：无头主机需要端口转发和人工步骤。
- 重新评估：可信硬件凭据代理或更强隔离环境可用时。

## D11 原始真实评估日志不进入仓库

- 背景：真实日志可能包含账号、会话、查询、模型原文和凭据残片。
- 决策：原始材料写入 `.isla-local/evaluations/`，仓库只保留脱敏结论；专项脚本放 `.isla-local/evaluation-scripts/`。
- 理由：降低 `git add .`、npm 打包和公开仓库泄漏风险。
- 代价：公开证据不能逐字复现私人会话。
- 重新评估：建立经过审查、自动脱敏且可证明安全的公开数据集时。

## D12 运行期间不切换 Provider 或模型

- 背景：切换会改变能力、上下文限制、Session 恢复和错误语义。
- 决策：启动时固定 Provider 和模型；配置修改下次启动生效。
- 理由：保持单次运行的契约稳定。
- 代价：切换需要重启，不能在任务中自动路由模型。
- 重新评估：有明确的多模型任务需求并完成 Session/Capability 迁移设计时。
