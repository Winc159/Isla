# v0.4.3 实施步骤

## Batch A：预算测量

建立 Provider-neutral 估算接口和请求预算报告；没有可靠 tokenizer 时使用保守字符预算。停点：测量不改变请求。

## Batch B：Tool Result Pruner

实现纯投影 pruner，保证 Tool 配对、最近回合和不可裁剪证据。停点：fixture 覆盖边界和确定性。

## Batch C：Checkpoint Store

扩展 Session 兼容格式保存 checkpoint 元数据和摘要；旧 Session 可读。停点：失败生成不写入，恢复结果一致。

## Batch D：自动/手工压缩

接入 RequestContextBuilder，增加 `/context`、`/context compact` 和 NDJSON 状态。停点：超预算只发生一次受控压缩尝试，无循环。

## Batch E：长会话评估

构造含搜索、MCP 和写操作的长会话，验证压缩前后任务、来源、审批和 Tool 配对；运行全量发布门禁。
