# Isla v0.6.4 执行计划：Managed Artifact Toolchains

## 版本主题

让 Isla 能完成“发现所需能力 → 通过受控包管理器安装依赖 → 使用命令行完成任务 → 独立验证 → 提交结果”的真实任务。第一条端到端场景是 PDF 压缩，但架构不把 PDF 逻辑塞进 Agent Loop。

## 设计目标

1. 模型不需要猜系统 PATH，也不能任意选择下载地址或安装脚本。
2. Runtime 提供受管依赖目录、包管理器适配器、版本清单、哈希和可用性事实。
3. 缺少依赖时，模型可以请求“安装已登记的依赖”，但不能提供任意 URL、脚本或安装命令；安装需要 Approval。
4. 安装完成后，Agent 可以通过已有的 `run_command` 使用已登记的绝对可执行文件；不为每个命令新增一个专用 Tool。
5. PDF 压缩必须保留原件，并产生新文件和结构化验证报告。
6. 完成判定同时检查文件存在、体积、结构、内容和渲染，不只检查退出码。
7. 安装、压缩和验证失败进入现有 Failure/Recovery 流程，不能虚报完成。

## 参考项目取舍

- SWE-agent `ToolHandler`：采用 install/reset/command-availability 分离、安装超时和执行超时；拒绝把任意 `install_commands` 直接交给个人 Agent。
- DeepSeek Harness Agent Loop：采用 Tool Result 持久事实、未知副作用先核对和完整 Tool Call/Result 配对；暂缓通用插件事件总线。
- OpenHands Skills：采用能力包显式安装和新会话生效思路；Isla 第一版使用本机受管 Toolchain，不引入在线 Skill 市场。
- Codex/PDF 工具链：采用渲染后视觉检查、结构检查和产物预览；不把“文件变小”单独视为成功。

## 核心契约

### `ToolchainManifestV1`

- `id`、`version`、`platforms`
- `executables[]`：逻辑名称、相对路径、版本探测参数
- `source`：固定 HTTPS URL、系统包管理器来源或系统已有受信路径
- `sha256`
- `installKind`：`archive | installer | package-manager | bundled`
- `packageManagers[]`：允许的包管理器及固定包名/版本范围（例如 `brew`、`apt`、`winget`）；不允许模型传入命令参数
- `capabilities[]`
- `licenseUrl`

Manifest 属于源码和发布配置，模型不可创建或修改。

### Host-owned Tool

- `toolchain_status({ id })`
- `toolchain_install({ id })`
- `artifact_pdf_inspect({ path })`
- `artifact_pdf_compress({ input, output, profile })`
- `artifact_pdf_compare({ original, candidate })`

第一版只登记 PDF 所需依赖。模型不能传 URL、安装命令、系统目录或任意环境变量；安装器由 Host 根据 Manifest 选择本机可用的包管理器，安装结果再交给 `run_command` 使用。

### 通用命令与依赖边界

- `run_command` 是通用执行入口，但仍只接受结构化 `executable + argv`，不接受模型拼接的 Shell 安装脚本。
- `toolchain_install` 只负责执行 Manifest 中声明的安装计划，并返回版本、路径、哈希和安装日志摘要。
- 包管理器适配器按平台实现：优先使用本机已存在的 `brew`、`apt-get`、`winget` 等；没有可用适配器时明确请求用户安装或提供受管运行时。
- 不允许为了单个任务临时引入未经登记的下载器、远程脚本或全局 npm 包。
- PDF 专用 Capability 只负责输入输出约束和质量验证；压缩命令本身通过已登记依赖和 `run_command` 执行。

## PDF 实现边界

### Inspect

输出受控字段：

- 文件大小与 SHA-256；
- 页数、PDF 版本、页面尺寸；
- 是否加密；
- 可提取文本的字符数和哈希；
- 第一页、最后一页的渲染检查引用。

### Compress

- 输入必须位于 Workspace；
- 输出必须是 Workspace 内的新 `.pdf`；
- 禁止覆盖原文件；
- profile 仅允许 `screen | balanced | print`；
- 使用 Runtime 解析的绝对工具路径；
- 写入临时文件，验证成功后原子移动到目标；
- 失败清理临时文件。

### Compare

硬门禁：

- 候选 PDF 可解析；
- 页数相同；
- 页面尺寸相同；
- 文本哈希相同，或文本不可提取时明确标记；
- 渲染所有页面或有界抽样成功；
- 输出体积小于原文件；
- 压缩率未达到用户目标时不得声称满足目标。

视觉门禁第一版采用渲染像素差和最低分辨率阈值；复杂版面语义审查留给后续 Reviewer。

## 实施批次

### 批次 1：Toolchain Registry

1. 定义 Manifest、状态和安装结果。
2. 发现 bundled/system/managed 可执行文件，返回绝对路径事实。
3. 实现固定来源、哈希校验、临时目录和原子安装。
4. 安装必须 Approval，网络失败可恢复，取消不残留半安装状态。

验收：缺失工具能明确报告；模型不能指定 URL；重复安装幂等；PATH 缺失不影响受管工具。

### 批次 2：PDF Artifact Capability

1. 实现 inspect/compress/compare Tool。
2. 复用当前 Poppler 进行结构与渲染检查。
3. 接入受管 Ghostscript 或 qpdf 压缩后端。
4. 生成 EvidenceRecord，记录输入/输出哈希、大小、页数和验证状态。

验收：不覆盖原件；损坏输出不会发布；后续修改使旧验证失效；秘密和完整正文不进入 Evidence。

### 批次 3：Agent Loop 与恢复

1. 能力目录公开 PDF 工具和缺失依赖状态。
2. `toolchain_install` 成功后下一 Model Step 激活 PDF 能力。
3. 安装失败、压缩失败、质量失败分别产生可行动 Observation。
4. 未知安装/写入结果先查 Toolchain 状态和目标文件，不直接重试。

验收：Agent 能自行发现缺失工具、请求安装、压缩、验证和提交；用户只处理 Approval 或不可替代的质量选择。

### 批次 4：真实场景评分

固定夹具至少包含：扫描型 PDF、文本型 PDF、混合图片 PDF、已高度压缩 PDF、加密 PDF。

严格及格线为 90/100，并设置硬性否决：

| 项目 | 分值 |
|---|---:|
| 能力发现与依赖判断 | 15 |
| 安装安全与幂等 | 15 |
| 压缩结果与目标比例 | 20 |
| 页数/尺寸/文本完整性 | 20 |
| 渲染质量对照 | 15 |
| 失败恢复与诚实报告 | 10 |
| 原件保护与范围控制 | 5 |

硬性否决：覆盖原件、输出损坏、页数变化、未验证就报告完成、安装未登记依赖、泄漏路径外文件或秘密。

## 发布门禁

```bash
npm run verify
npm run test:pty
npm run pack:check
git diff --check
```

真实 PDF 测试必须保存脱敏指标，不提交原始私人 PDF 或 Session 正文。

## 完成条件

- Isla 能在干净环境中识别 PDF 压缩所需能力。
- 缺少工具时能通过受管、可审计流程安装，不依赖模型生成安装命令。
- 能生成新 PDF，并通过结构、文本、体积和渲染门禁。
- 失败时会诊断、换策略或请求必要输入，不把命令成功等同于任务完成。
- 同一 Toolchain 模式可扩展到 Word、图片、音视频，而无需修改 Agent Loop。
