# v0.4.3 设计

## 1. 预算顺序

请求装配固定按以下顺序：保留 system/当前任务/最近完整回合 → 裁剪大型 Tool Result → 应用已有有效 checkpoint → 必要时创建新 checkpoint → 若仍超限则稳定失败。不得从消息中间截断 Tool 配对。

## 2. Tool Result Pruning

仅裁剪超过阈值、可通过稳定来源重新获取的旧 Observation。保留 toolCallId、工具名、结果状态、原始大小、摘要和重新获取提示。当前回合结果不裁剪；错误、安全拒绝和写操作证据默认保留。

## 3. Checkpoint

Checkpoint 覆盖一段连续、已关闭的回合，记录 source boundary、输入 hash、摘要正文、生成模型和时间。原始消息继续保存在 Session；checkpoint 只是模型历史投影，不删除事实。

压缩失败不得污染 Session 或替换上一有效 checkpoint。模型生成摘要必须经过结构和边界验证；不得把未受信任 Tool 内容提升为指令。

## 4. 触发

默认仅在下一请求预计超预算时同步触发；手工 `/context compact` 可显式触发。首版不后台运行。

## 5. 偏离条件

若需要删除原始历史、跨 Session 压缩、改变 Provider 消息契约或新增 Job 系统，先停止并重新设计。
