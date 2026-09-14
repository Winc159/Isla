# Isla v0.2.5.1 测试与验收案例

## 1. 测试原则

默认完全离线，所有 config、workspace、Session和Memory位于独立临时目录。不得读取真实 home、`.env`或用户数据。使用 FakeProvider或本地受控HTTP服务。所有入口收集 stdout/stderr和持久化文件并运行秘密哨兵扫描。

P0为完成门禁，P1为应完成项；P0失败不得收口。

## 2. Session恢复等价

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| EQ-001 | P0 | CLI恢复v1 | messages完整，生成v3保存结果 |
| EQ-002 | P0 | NDJSON恢复v1 | 与CLI投影一致 |
| EQ-003 | P0 | CLI/NDJSON恢复v2 checkpoint | 第一次模型请求包含相同checkpoint |
| EQ-004 | P0 | CLI恢复v3 context+journal | checkpoint和旧Turn保留 |
| EQ-005 | P0 | NDJSON恢复v3 context+journal | 不丢Context，不用空Journal覆盖 |
| EQ-006 | P0 | 恢复后新Turn | sequence连续，索引指向正确messages |
| EQ-007 | P0 | 失败Turn后恢复 | 旧失败记录保留，新Turn正常追加 |
| EQ-008 | P0 | 两入口相同输入 | 实际request snapshot hash一致（排除时间/id） |

## 3. 启动快照与workspace

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| WS-001 | P0 | `--workspace`绝对目录 | 精确绑定并显示 |
| WS-002 | P0 | Profile含workspace | 无参数时使用Profile值 |
| WS-003 | P0 | 参数与Profile同时存在 | 显式参数胜出，摘要明确 |
| WS-004 | P0 | 两者缺失 | 使用注入cwd并绝对化 |
| WS-005 | P0 | 路径不存在/不是目录 | 创建资源前失败 |
| WS-006 | P0 | 启动后进程cwd变化 | Tool/Sandbox/Memory仍使用冻结workspace |
| WS-007 | P0 | CLI Header | 显示绑定workspace，不显示Key |
| WS-008 | P0 | NDJSON ready | 可选workspace字段正确，旧解析器兼容 |
| WS-009 | P0 | 文件Tool相对路径 | 只在绑定workspace内解析 |
| WS-010 | P0 | 多个ApplicationContext | workspace互不污染，无全局单例 |

## 4. ApplicationContext生命周期

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| APP-001 | P0 | 正常创建 | 资源按冻结顺序创建 |
| APP-002 | P0 | 中途创建失败 | 已创建资源逆序关闭 |
| APP-003 | P0 | 正常CLI退出 | 所有资源关闭一次 |
| APP-004 | P0 | NDJSON exit/EOF | 与CLI相同关闭语义 |
| APP-005 | P0 | `close()`调用两次 | 幂等，无重复副作用 |
| APP-006 | P0 | close失败且已有主错误 | 主错误保留，debug记录关闭code |
| APP-007 | P0 | 两个并行context | Provider、Memory、SessionStore隔离 |
| APP-008 | P0 | app模块加载 | 不读取stdin、stdout、env或真实home |

## 5. SessionFactory

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| SF-001 | P0 | 无历史Session | 创建含当前personality的新Session |
| SF-002 | P0 | 有历史Session | 恢复已存system message，不追溯改人格 |
| SF-003 | P0 | `/new` | 使用同一factory创建新Session |
| SF-004 | P0 | `/sessions`切换 | 使用同一factory恢复目标Session |
| SF-005 | P0 | NDJSON new_session | 与CLI `/new`配置相同 |
| SF-006 | P0 | CLI与NDJSON | Tool、Sandbox、Memory、context参数一致 |
| SF-007 | P0 | 持久化失败 | 请求失败且不保存伪assistant |
| SF-008 | P0 | Journal存在 | 工厂不得重新初始化为空Journal |

## 6. Tool边界与能力

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| TOOL-001 | P0 | 创建ChatSession | 不隐式创建项目Tool或读取cwd |
| TOOL-002 | P0 | 注入空Tool环境 | 普通对话成功，无Tool定义 |
| TOOL-003 | P0 | 注入项目Tool套装 | Prompt定义与Runtime注册名单一致 |
| TOOL-004 | P0 | 重复Tool名称 | 组合阶段明确失败 |
| TOOL-005 | P0 | Provider声明无Tool Calling | 不向模型发送Tool定义 |
| TOOL-006 | P0 | 能力声明支持但方法缺失 | 创建或调用前fail closed |
| TOOL-007 | P0 | CLI/NDJSON同workspace | Sandbox决策一致 |
| TOOL-008 | P0 | project_search details/citation | v0.2.4证据链无回归 |
| TOOL-009 | P0 | 写入审批拒绝/批准 | 现有Permission和Approval语义不变 |

## 7. Memory host context

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| MEM-001 | P0 | 有Memory召回 | StoredSession.messages不增加伪user消息 |
| MEM-002 | P0 | 模型请求投影 | 历史数据有明确边界和非指令说明 |
| MEM-003 | P0 | 当前用户输入 | 在投影中身份唯一且顺序稳定 |
| MEM-004 | P0 | 恶意Memory文本 | 只能作为历史数据，不能变为system/current user |
| MEM-005 | P0 | Memory检索失败 | 主回答继续；debug产生安全code |
| MEM-006 | P0 | 同一状态重建请求 | Snapshot hash稳定 |
| MEM-007 | P0 | Memory关闭 | 请求中无Memory区块，不留空伪消息 |
| MEM-008 | P0 | checkpoint+Memory同时存在 | 区块顺序固定，当前输入不被覆盖 |

## 8. 诊断与隐私

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| LOG-001 | P0 | quiet派生失败 | 不输出非阻断诊断 |
| LOG-002 | P0 | normal安全警告 | 输出有限用户可理解警告 |
| LOG-003 | P0 | debug Memory/Embedding/checkpoint失败 | stderr含稳定code和component |
| LOG-004 | P0 | NDJSON debug | stdout仍全部为合法NDJSON |
| LOG-005 | P0 | Provider认证/网络失败 | 稳定脱敏分类，不含响应/Key |
| LOG-006 | P0 | Tool失败 | 不输出完整arguments/result正文 |
| LOG-007 | P0 | 所有logLevel秘密扫描 | Key、Authorization、配置、私人消息均未命中 |
| LOG-008 | P1 | 无日志文件配置 | 不创建默认持久日志文件 |

## 9. 入口纯度与未来适配

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| ENTRY-001 | P0 | CLI启动 | 只通过ApplicationContext获取会话和状态 |
| ENTRY-002 | P0 | NDJSON启动 | 不直接new Runtime/Memory/SessionStore/ChatSession |
| ENTRY-003 | P0 | `runCli`接口 | 使用options对象，无长位置参数链 |
| ENTRY-004 | P0 | fake Apple/Web adapter | 不导入CLI模块即可创建会话、发送消息、接收生命周期事件 |
| ENTRY-005 | P0 | 两入口响应 | text/outcome/projectSources语义一致 |
| ENTRY-006 | P0 | Approval | UI入口可提供自己的ApprovalService且不改核心 |
| ENTRY-007 | P0 | 单Agent无TTY | config+workspace+NDJSON完成配置后全部流程 |

## 10. 兼容与回归

- 旧config v1无workspace继续启动；
- `--profile`、默认Profile、唯一Profile和显式`--env`继续工作；
- Session v1/v2/v3读取与保存兼容；
- CLI commands、Memory、Tool、Approval、Sandbox、Journal、Snapshot和projectSources全部回归；
- 旧NDJSON客户端忽略ready新增字段后继续工作；
- npm包不含config、Session、Memory、日志、临时workspace或秘密；
- 默认测试不发送网络请求。

## 11. 可执行验收场景

全链路e2e使用临时Profile、临时workspace、临时Session/Memory和本地受控HTTP Provider：

1. 使用`--config`、`--profile`、`--workspace`和`--protocol ndjson`启动；
2. 断言ready的provider/model/workspace/capabilities；
3. 两轮普通对话；
4. project search并验证tool_start/tool_end和合法来源；
5. 写入Tool触发approval_request，分别覆盖拒绝和批准；
6. new_session并验证session_changed；
7. 重启并验证v3 Context/Journal恢复；
8. exit并验证bye、进程码和资源关闭；
9. 扫描stdout/stderr及全部持久化文件；
10. 删除临时目录。

人工验收只保留终端视觉：Header workspace可读性、向导workspace摘要、隐藏Key输入、`/config open`。核心语义不得依赖人工测试。

## 12. 最终门禁

```text
npm run typecheck
npm test
npm run build
npm run pack:check
git diff --check
```

收口报告记录测试文件/案例通过、跳过、失败数；所有P0状态；秘密扫描；build/pack；是否运行真实Provider；已知限制；Git状态；明确声明未执行Git add、commit或push。
