# v0.7.1 Event Session 与 App Server 验收评分

及格线：90/100；事件事实源、cursor 重连或旧协议兼容任一硬性失败则不通过。

| 项目 | 得分 | 证据 |
|---|---:|---|
| Event V1 schema、类型映射与非法记录拒绝 | 20/20 | `tests/core/event-store.test.ts` |
| append 单调序列、并发写排他、cursor 续读 | 25/25 | `tests/core/event-store.test.ts` |
| 尾部半写恢复与幂等读取 | 15/15 | `tests/core/event-store.test.ts` |
| ChatSession/Host 双写与 `/sessions/:id/events` 查询 | 20/20 | 类型检查、Host 路径测试、真实进程构建 |
| 旧 JSON Session 与 Resource 行为兼容 | 20/20 | 全量回归测试与 Resource UI 构建 |
| **总分** | **100/100** | **通过** |

真实对话：最新构建使用 BAILIAN 完成非空响应（275 字符），随后正常退出，进程退出码为 0。
