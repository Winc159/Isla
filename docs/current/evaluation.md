# Isla v0.2.9 当前评估结论

更新时间：2026-09-14

## 验收结果

`real-agent-capability-evaluation-2026-09-14-rerun.log`：3/3 场景通过。

覆盖：普通回答、记忆写入与 recall、项目读取、Approval 拒绝与通过写入、Session 切换、NDJSON、普通规划、明确要求参考 DSH/OpenHands 时的 Web Search，以及多轮交流式修订。

普通规划不强制 Search；用户明确要求外部资料、参考项目或核实时，模型应优先使用 Web Search。当前 Web Search 是通用来源发现能力，不保证覆盖指定搜索平台。

NDJSON 真实评测已授权并通过 3/3：普通完成场景重复运行、Web 规划 Driver、多轮反馈修订。该结果验证的是稳定的一次性 Tool Loop 与协议闭环，不代表 DeepSeek Responses Tool streaming 已可用。

DeepSeek Responses Tool streaming 的真实请求返回 HTTP 400，已作为明确边界处理：默认关闭，只有显式 `streaming: true` 才尝试；生产默认路径不受影响。OpenAI 原生流式适配已通过离线 fixture，未使用真实 OpenAI 凭据进行网络评测。

离线门禁：68 个测试文件通过，302 passed、6 skipped；TypeScript typecheck、build、pack check、`git diff --check` 均通过。

本轮真实评测已按显式 smoke 开关执行；由于当前环境未提供 `DEEPSEEK_API_KEY` 与 `ISLA_MODEL`，DeepSeek Provider 和 NDJSON 真实用例安全跳过，未发起网络请求。凭据就绪后可直接重跑同一脚本，不需要修改实现。

## 解释

旧版 clarification 和“规划必须 Search”的固定验收已移除，不再作为当前门禁。当前版本不声称特定 Provider 的流式性能提升；当原生流式 Tool 协议不兼容时优先保持一次性路径的正确性与稳定性。
