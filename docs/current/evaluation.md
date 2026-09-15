# Isla v0.3.0 当前评估结论

更新时间：2026-09-15

## 当前状态

v0.3.0 Batch A（Bailian 普通文本、Profile 解析、向导默认值）已通过离线验证；Batch B1（模型目录客户端）已通过离线 fixture。Batch B2 的 CLI/NDJSON 入口与缓存、Batch C Tool Calling 尚未实现，也未进行真实百炼评估。当前 package 版本仍为 v0.2.9。

本次设计阶段只核实了百炼官方接口：

- 百炼是同时托管 Qwen 与第三方模型的平台，Provider 应按平台命名；
- OpenAI-compatible Chat Completions 可作为最低迁移成本的文本和 Function Calling 路径；
- `GET /api/v1/models` 可返回分页模型目录、模型作者、推理服务商、capabilities、features、上下文和价格信息；
- 地域、API Key、Base URL 与模型可用范围相关，不能静默混用；
- 不同模型族的 Tool Calling 参数与历史回传可能存在差异，不能由通用模型目录字段替代协议验证。

## 继承的已验证基线

v0.2.9 最近记录的离线结果为 68 个测试文件通过、302 passed、6 skipped；typecheck、build、pack check 与 `git diff --check` 通过。真实 DeepSeek Provider smoke 1/1、NDJSON/Agent Loop 3/3，共 4/4 通过。

这些结果只证明 v0.2.9，不证明 Bailian Provider、模型目录或 Qwen Tool Calling 已实现。

## 尚未允许的声明

在对应 Batch 和门禁通过前，不得声称：

- Isla 可以通过百炼完成对话；
- Isla 可以查询或缓存百炼模型目录；
- 任一百炼模型支持 Isla Tool Loop；
- 百炼原生 streaming 或 streaming Tool Calls 可用；
- 所有百炼模型共享相同 Tool、thinking 或 history 协议；
- 每个模型都具有固定免费额度。

## 下一评估停点

1. Batch A 离线文本 Provider；
2. 用户完成本地配置并明确授权后的真实文本 smoke；
3. Batch B 官方模型目录查询；
4. 用户选择目标 Qwen 模型后的 Batch C Tool Calling fixture 与真实回归。

真实评估不得保存 API Key、Authorization、Workspace ID、完整 Provider payload、完整模型目录或私人会话正文。
