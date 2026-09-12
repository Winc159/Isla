# Isla v0.2.5 架构基线：启动 Profile 与本地配置

## 1. 版本目标

v0.2.4 已完成可评测项目检索与结构化证据链，但 Isla 的正常启动仍依赖项目目录中的 `.env` 或调用进程预先设置环境变量。对于个人 Agent，这使首次使用、日常切换启动组合和维护运行参数都不够直接。

v0.2.5 只解决一个问题：让用户通过一个位于 Isla 私有数据目录中的 `config.json` 保存一个或多个启动 Profile，并在交互式首次启动时完成 Provider、模型、API Key 和少量运行设置的配置。

本版建立以下闭环：

1. 配置文件不存在或没有 Profile 时，交互式 CLI 进入首次设置；
2. 用户选择 Provider、模型并输入所需凭据和设置；
3. 配置经过完整校验后原子写入 `~/.isla/config.json`；
4. 后续启动按明确规则选择 Profile，并生成一次不可变的 `AppConfig`；
5. `/config` 与 `/profile` 提供安全查看、打开、设置和默认项管理；
6. 环境变量入口继续用于测试、CI、临时运行和兼容迁移，但不与 Profile 隐式拼接；
7. API Key 即使与其他设置同文件保存，也不得进入 Session、Memory、Journal、Snapshot、日志、Tool 输出、错误或 npm 包。

`StoredSession.messages` 继续是唯一对话正文事实源。Profile 是启动配置，不是会话正文，也不参与模型历史投影。

## 2. 范围边界

本版包含：version 1 配置文件；命名 Profile；单文件本地凭据；配置校验和默认值；原子写入与冲突保护；首次启动向导；Profile 启动选择；显式环境变量兼容入口；`/config`、`/profile` 命令；最小 personality preset；日志级别选择；离线测试和迁移文档。

本版不包含：运行中热切换 Provider 或模型；自动重载配置；系统钥匙串；凭据加密；Shell；网络；取消；后台任务；子 Agent；MCP；OpenAI/Local Tool Calling 补齐；远程配置同步；JSON 注释；持久化正文日志；插件化配置系统。

不得升级 Session schema，不得改变 Provider wire contract、Tool Loop、Approval、Permission、Sandbox、Memory、Journal、NDJSON 事件或项目来源语义。

## 3. 核心决策

### 3.0 机器可编排完整路径

Isla 的长期硬约束是：任何面向用户的能力都必须存在一条不依赖人工逐项操作的机器可编排路径。交互式 CLI 可以提高首次使用的友好性，但不能成为唯一入口。

Codex、Isla 或其他受信任自动化 Agent 必须能够在一台新机器上完成完整闭环：准备工作目录和配置、选择 Provider/Profile、启动 Runtime、通过 NDJSON 或等价 API 完成连续对话、驱动 Approval、观察 Tool 生命周期、恢复或创建 Session，并验证最终结果。后续联网、命令执行、取消、后台任务和子 Agent 也必须遵守同一规则。

v0.2.5 的具体门禁是：

- `config.json` 可以由自动化程序在不启动交互向导的情况下生成并校验；
- `--profile`、`--env`、`--config` 可确定性选择启动配置；
- NDJSON 启动不得依赖 TTY、菜单或隐藏的人工确认；
- `/config open` 只是人工便利入口，不能是唯一配置方式；
- 配置、启动和协议错误必须有稳定、可脱敏的机器可读失败语义；
- 自动化路径不能要求 API Key 出现在命令行参数中；
- 新增功能若没有 CLI/NDJSON/API 等机器入口，不得宣布为完成能力。

该规则不要求本版建设 Web UI、远程 HTTP 服务或通用部署平台。当前自动化 Agent 可以直接写入临时或用户指定的 `config.json`，再用 `--profile`/`--config` 启动 NDJSON；未来若增加远程 API，必须保持相同核心契约。

### 3.1 单文件配置

默认路径：

```text
<home>/.isla/config.json
```

可以通过现有环境风格增加一个仅供测试、迁移和特殊部署使用的显式配置路径覆盖，但正常用户不需要设置它。覆盖路径不得由 Profile 自己指定，避免递归配置。

API Key 与 Profile 其他字段保存在同一个文件。这是个人 CLI 当前阶段的简化选择，必须明确告知用户：文件中的 API Key 是本地明文，不等价于 Windows Credential Manager、macOS Keychain 或 Linux Secret Service。

本版不为了潜在的系统钥匙串引入原生依赖，但配置解析和 Runtime 组合不得把 Key 扩散到其他持久化对象。未来迁移到系统凭据存储时应保持 Profile 的用户可见身份和字段语义稳定。

### 3.2 启动快照而非热配置

配置只在启动阶段解析。选中的 Profile 与默认值合并并通过校验后，生成一个不可变 `AppConfig`，后续 Runtime 与 Session 使用该快照。

- 运行期间外部编辑 `config.json` 不改变当前 Runtime；
- `/config open` 只打开文件，不热重载；
- `/config setup` 和 `/profile use` 保存的变化默认在下次启动生效；
- 当前 Header、Session、Provider 和模型不能因配置文件变化而静默改变；
- v0.2.5 不提供 `/model` 或 `/provider`，避免造成当前会话立即切换的误解。

### 3.3 Profile 是完整启动组合

每个 Profile 至少确定：

- Provider；
- 模型；
- Provider 所需的 API Key 或 Base URL；
- Runtime 限制；
- Memory 开关；
- personality preset；
- 日志级别。

Profile 未提供的可选字段使用代码内默认值。配置文件不必展开所有默认值，避免版本升级时旧默认值永久复制到用户文件。

### 3.4 测试控制不进入日常 Profile

以下属于正常运行设置，可以进入 Profile：timeout、model retry、context 预算、Memory 开关、personality 和日志级别。

以下属于测试编排，禁止进入 Profile：真实 smoke 授权、fixture 路径、临时 Session/Memory 目录、Vitest 控制、Mock Provider、测试日志路径和是否展示真实 NDJSON。

真实 Provider 测试继续由显式环境变量授权，避免普通启动意外产生请求和费用。

## 4. 配置契约

### 4.1 建议 TypeScript 类型

```ts
export interface IslaConfigFileV1 {
  readonly version: 1;
  readonly defaultProfile?: string;
  readonly profiles: Readonly<Record<string, StartupProfileV1>>;
}

export type StartupProfileV1 =
  | DeepSeekStartupProfileV1
  | OpenAIStartupProfileV1
  | LocalStartupProfileV1;

export interface ProfileRuntimeSettingsV1 {
  readonly timeoutMs?: number;
  readonly modelRetries?: 0 | 1;
  readonly maxContextTurns?: number;
  readonly maxContextChars?: number;
  readonly contextRetainTurns?: number;
}

export interface ProfileMemorySettingsV1 {
  readonly enabled?: boolean;
  readonly database?: string;
  readonly embeddingProvider?: "openai" | "local";
  readonly embeddingModel?: string;
  readonly embeddingBaseURL?: string;
  readonly embeddingApiKey?: string;
}

export interface ProfileAppearanceSettingsV1 {
  readonly personality?: "default" | "minimal";
  readonly logLevel?: "quiet" | "normal" | "debug";
}

interface StartupProfileBaseV1 {
  readonly model: string;
  readonly runtime?: ProfileRuntimeSettingsV1;
  readonly memory?: ProfileMemorySettingsV1;
  readonly appearance?: ProfileAppearanceSettingsV1;
}

export interface DeepSeekStartupProfileV1 extends StartupProfileBaseV1 {
  readonly provider: "deepseek";
  readonly apiKey: string;
}

export interface OpenAIStartupProfileV1 extends StartupProfileBaseV1 {
  readonly provider: "openai";
  readonly apiKey: string;
}

export interface LocalStartupProfileV1 extends StartupProfileBaseV1 {
  readonly provider: "local";
  readonly baseURL: string;
  readonly apiKey?: string;
}
```

实施时允许为减少重复调整具体类型拆分，但不得使用 `any` 或无约束元数据袋代替封闭字段。

### 4.2 示例

```json
{
  "version": 1,
  "defaultProfile": "deepseek-main",
  "profiles": {
    "deepseek-main": {
      "provider": "deepseek",
      "model": "deepseek-chat",
      "apiKey": "replace-with-your-key",
      "runtime": {
        "timeoutMs": 600000,
        "modelRetries": 0,
        "maxContextTurns": 20,
        "maxContextChars": 60000,
        "contextRetainTurns": 6
      },
      "memory": {
        "enabled": true
      },
      "appearance": {
        "personality": "default",
        "logLevel": "normal"
      }
    }
  }
}
```

文档示例只能使用明显虚构的占位值，不得包含格式近似真实秘密的测试值。

### 4.3 Profile 名称

- 非空；
- 去除首尾空白后保持原显示文本；
- 建议限制为 1–64 个可打印字符；
- 名称必须唯一；
- 禁止 `__proto__`、`prototype`、`constructor` 等可能污染普通对象键的名称，或内部统一使用 `Map`/无原型对象规避；
- `defaultProfile` 必须指向实际存在的 Profile；
- CLI 参数和命令按精确名称选择，不做模糊猜测。

### 4.4 校验

加载时一次性校验完整文件：

- 顶层必须是对象且 `version === 1`；
- `profiles` 必须是对象；
- Provider 必须是 `deepseek | openai | local`；
- model 和云端 API Key 必须是非空字符串；
- Local base URL 必须是合法 URL；
- timeout/context 数值必须为正整数；
- modelRetries 只允许 0 或 1；
- enum 字段必须是已知值；
- embedding 依赖字段沿用现有 `AppConfig` 约束；
- 未知顶层或 Profile 字段给出安全警告，但 v1 默认可以忽略，便于前向兼容；
- 未知 version 必须失败，不能当作 v1 猜测；
- 任一 Profile 无效时不得用半有效对象启动该 Profile。

错误消息可以包含字段路径和 Profile 名称，但不得包含字段值、API Key、完整配置文本或序列化对象。

## 5. 配置读取、写入与冲突

### 5.1 读取结果

配置存储层必须区分：

- `missing`：文件不存在；
- `empty`：合法 v1 文件但没有 Profile；
- `ready`：至少一个有效 Profile；
- `invalid`：文件存在但 JSON 或 schema 无效；
- `unreadable`：权限或 IO 错误。

只有 `missing` 和 `empty` 可以自动进入首次设置。`invalid` 和 `unreadable` 不能被向导静默覆盖。

### 5.2 原子写入

写入顺序：

1. 创建 `~/.isla`；
2. 获取配置专用锁；
3. 若是编辑已有文件，验证读取时的内容 hash 或 mtime 未变化；
4. 将完整候选配置序列化到同目录临时文件；
5. 用同一 parser 重新读取并校验临时文件；
6. 尽可能收紧文件权限；
7. 原子 rename 替换目标；
8. 清理临时文件和锁。

配置写入不得复用 Session 文件名或锁。发生外部修改冲突时 fail closed，不覆盖用户编辑。

### 5.3 删除与恢复

v0.2.5 不提供删除整个配置文件的命令。删除 Profile 时：

- 不能删除不存在的名称；
- 删除默认 Profile 时必须同时选择新的默认项，或在没有剩余 Profile 时清除默认项；
- 删除前需要明确确认；
- 不删除该 Profile 已产生的 Session 或 Memory；
- 配置损坏时只允许用户手动修复、打开文件或显式备份后重建，不能自动丢弃原文件。

## 6. 启动解析

### 6.1 入口

建议支持：

```text
isla
isla --profile <name>
isla --env
isla --config <path>
```

`--config` 只用于测试、迁移或特殊部署，不能与默认文件静默合并。命令行禁止接收 API Key。

### 6.2 选择顺序

普通交互式启动：

1. `--env`：只使用环境变量；
2. 显式 `--profile <name>`：从指定配置文件读取该 Profile；
3. 配置存在且 `defaultProfile` 有效：使用默认 Profile；
4. 配置只有一个 Profile：使用唯一 Profile；
5. 配置有多个 Profile 且无默认项：显示选择器；
6. 配置 missing/empty：进入首次设置；
7. 配置 invalid/unreadable：安全失败并提示 `/config open` 对应的外部修复方法，但不能启动一个尚不存在的 CLI Session。

环境变量和 Profile 不进行字段级混合。这样可以避免残留环境变量暗中覆盖用户看到的 Profile。现有脚本必须显式使用 `--env`，迁移期是否短暂允许“无配置时自动使用完整环境变量”可作为兼容窗口，但必须在实施文档中冻结并测试，不能形成永久模糊优先级。

### 6.3 非交互与 NDJSON

非 TTY 或 `--protocol ndjson`：

- 禁止显示首次设置或 Profile 选择器；
- 必须显式给出 `--profile`、可无歧义解析的默认/唯一 Profile，或 `--env`；
- 缺少配置时输出稳定错误到 stderr，并以非零状态退出；
- stdout 在 NDJSON 模式下仍只输出协议事件；
- 不能把提示词、菜单或配置摘要写入 NDJSON stdout。

## 7. 首次设置向导

向导仅在交互式 TTY 中运行。

顺序：

1. 显示本地明文凭据提示；
2. 输入 Profile 名称，默认可为 `deepseek-main`；
3. 选择 Provider；
4. 选择推荐模型或手动输入模型；
5. 云 Provider 隐藏输入 API Key；Local 输入 Base URL 和可选 Key；
6. 选择 Memory 开关；
7. 选择 personality preset；
8. 选择日志级别；
9. 高级设置默认折叠；用户选择后才编辑 timeout、retry 和 context 参数；
10. 显示脱敏摘要；
11. 明确确认保存；
12. 写入配置并使用刚创建的 Profile 启动。

取消向导不得留下部分文件、临时文件或空 Profile。API Key 不能进入输入历史、屏幕回放或错误对象。

Provider 选择界面必须准确说明当前能力：DeepSeek 支持完整 Tool Loop；OpenAI 和 Local 当前只保证普通对话。不得暗示三者 Tool 能力一致。

## 8. CLI 命令

### 8.1 `/config`

`/config` 与 `/config show` 显示：配置绝对路径、当前 Profile、Provider、模型、Key 是否配置、Memory、personality、日志级别和关键 Runtime 限制。不得显示 Key、Embedding Key、完整 system prompt 或完整配置 JSON。

### 8.2 `/config open`

用系统默认关联程序打开 `config.json`。成功后提示“修改将在下次启动生效”。

- 这是用户明确触发的外部 UI 动作；
- 打开失败只返回安全错误；
- 不调用 shell 拼接路径；
- Windows、macOS、Linux 使用各自明确的打开方式；
- 测试通过注入 opener，不真实启动 GUI。

### 8.3 `/config setup`

进入与首次启动相同的设置组件，用于新增或编辑 Profile。保存后只影响下次启动。当前运行配置保持不变。

### 8.4 `/profile`

- `/profile`：显示当前 Profile；
- `/profile list`：列出名称、Provider、模型和默认标记；
- `/profile use <name>`：设置下次启动的默认 Profile；
- 可选 `/profile remove <name>`：若本版实现，必须满足第 5.3 节确认和默认项约束。

v0.2.5 不增加 `/model` 和 `/provider`。

## 9. Personality 与日志

### 9.1 Personality

Profile 只保存 preset ID，不保存一套新的可演化 persona 事实。

- `default` 使用当前 `DEFAULT_PERSONALITY_PROMPT`；
- `minimal` 使用更短、低修辞的内置提示；
- preset 只影响新建 Session 时形成的 system message；
- 恢复已有 Session 时以 Session 中已保存的 system message 为准；
- Core Memory 的 `persona` 继续由用户记忆管理，不被 Profile 覆盖；
- 本版不提供自定义 personality 正文编辑器。

### 9.2 日志级别

支持 `quiet | normal | debug`：

- quiet：减少非必要状态展示；
- normal：保持当前默认体验；
- debug：保留当前安全的 Provider、模型、耗时和错误分类诊断。

本版不增加持久化日志文件。所有级别均不得输出 API Key、Authorization、完整环境、配置原文、私人消息、Memory 正文或完整 Tool Result。

## 10. 与现有 Session、Memory 和环境变量的关系

- Session 仍按实际 provider/model 查找和创建；
- Profile 名称不写入 Session schema；
- Profile 改名不迁移或删除历史 Session；
- Profile 的 session/memory 路径如果开放配置，必须解析为用户明确指定的路径且不打包；
- 旧 `.env` 用户可通过 `--env` 继续运行；
- `.env.example` 保留用于开发、测试和兼容说明；
- Profile Key 不复制到 `process.env`，除非某个既有库明确只能读取环境变量且设计先获确认；Provider 应接收解析后的值；
- Snapshot 只保留现有 provider/model，不记录 Profile、Key 或配置 hash。

## 11. DSH 参考与取舍

采用：

- Provider/model 属于可替换的部署配置，不属于模型可见历史；
- 凭据解析与 Session、模型消息分离；
- 缺少凭据或能力时明确失败，不静默回退；
- 配置选择结果在一次 Runtime 生命周期内稳定。

调整：

- DSH 使用独立 credentials 服务和本地 credentials 文件；Isla v0.2.5 为个人 CLI 采用单个 `config.json`，减少用户维护面；
- Isla 明确承认本地明文风险，不宣称系统级加密；
- Isla 不复制 DSH 的 App Config、Cordis schema、profiles/bundles 或动态插件组合。

暂缓：

- 系统钥匙串和可插拔 Credential Provider；
- Session 内模型选择；
- 配置热重载、远程同步和多设备合并；
- Provider directory、能力目录和在线模型枚举。

拒绝：

- 把 API Key 写入 Session 或模型历史；
- 用环境变量和 Profile 做不可见的字段级拼接；
- 为配置功能引入 Cordis 或通用依赖注入框架；
- 配置解析失败时自动覆盖用户文件。

## 12. 完成标准

1. missing/empty/ready/invalid/unreadable 配置状态可区分；
2. version 1 schema、Provider 分支、默认值和字段依赖均有离线测试；
3. 配置原子写入，外部修改冲突不会被覆盖；
4. API Key 与 Embedding Key 不进入错误、输出、Session、Memory、Journal、Snapshot 或测试快照；
5. 首次交互式启动可完成 DeepSeek Profile 并立即启动；
6. 向导取消不留下部分配置；
7. 默认、唯一、多 Profile 和显式 Profile 选择行为确定；
8. 非交互和 NDJSON 不出现菜单或提示词污染；
9. `--env` 保持现有配置能力，且不与 Profile 隐式混合；
10. `/config`、`/config open`、`/config setup` 和 `/profile` 行为符合本架构；
11. `/profile use` 只影响下次启动，不改变当前 Session；
12. personality 不与 Core Memory persona 形成隐式覆盖；
13. 日志级别不扩大秘密和私人内容输出；
14. Session v1/v2/v3、Tool、Approval、Sandbox、Memory、CLI 和 NDJSON 无回归；
15. 默认测试完全离线；typecheck、test、build、pack check 和 diff check 全部通过；
16. 未执行 Git add、commit 或 push，未覆盖用户原有修改。
17. 配置和 NDJSON 启动路径可由受信任自动化 Agent 在无 TTY 条件下完整驱动；首次向导不是唯一入口。
